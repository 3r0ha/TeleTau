import { randomInt } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { ufaDate } from "@teletau/domain-rules";
import { and, eq, gte, inArray, isNull, lt, lte, ne, or } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Principal } from "../../common/auth.js";
import { ApiError, conflict, forbidden, notFound, unauthorized, unavailable, unprocessable } from "../../common/problem.js";
import { ACCOUNTS_PORT, type AccountsPort } from "../../common/ports.js";
import { uuidv7 } from "../../common/uuidv7.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import type { Db } from "../../db/database.js";
import { RateLimiter, type Limit } from "../../infra/rate-limiter.js";
import { DB, VALKEY } from "../../infra/tokens.js";
import { ConsensusService } from "../consensus/index.js";
import { ProgressService } from "../progress/index.js";
import { verifyInitData } from "./init-data.js";
import { outsideQuietHours, ufaHour } from "./reminders.js";
import { telegramDialogs, telegramLinks } from "./telegram.schema.js";

type LinkRow = typeof telegramLinks.$inferSelect;
type DialogRow = typeof telegramDialogs.$inferSelect;

/** Вход по привязке (POST /auth/telegram): 10 попыток в час на чат — выдача сессий не превращается в перебор. */
export const TELEGRAM_LOGIN: Limit = { max: 10, windowMs: 3600_000 };
/** Выпуск кода привязки: 1 в минуту на аккаунт — код один, свежий и без очереди. */
export const LINK_CODE_ISSUE: Limit = { max: 1, windowMs: 60_000 };
/** Погашение кодов ботом: 10 в час на чат — брут-форс 8-значного кода бесполезен. */
export const LINK_CODE_REDEEM: Limit = { max: 10, windowMs: 3600_000 };
/** Жизнь одноразового кода привязки, секунды. */
export const LINK_CODE_TTL_SECONDS = 600;
/** Алфавит кода без похожих символов (0/O, 1/I): 32 знака — 5 бит на символ. */
const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Префиксы ключей Valkey: код → аккаунт и аккаунт → действующий код (для гашения прежнего). */
const LINK_CODE_KEY = "tg-link-code:";
const LINK_CODE_ACCOUNT_KEY = "tg-link-code-account:";

/**
 * Выпуск кода атомарно: прежний код аккаунта гасится, новый становится единственным действующим. KEYS: префикс
 * кодов, ключ «аккаунт → код». ARGV: TTL, новый код, id аккаунта. Возвращает прежний код (для тестов).
 */
const ISSUE_CODE = `local old = redis.call("GET", KEYS[2])
if old and old ~= ARGV[2] then redis.call("DEL", KEYS[1] .. old) end
redis.call("SET", KEYS[1] .. ARGV[2], ARGV[3], "EX", tonumber(ARGV[1]))
redis.call("SET", KEYS[2], ARGV[2], "EX", tonumber(ARGV[1]))
return old or ""`;

const remindersOf = (row: Pick<LinkRow, "remindersEnabled" | "reminderHour">): Schema<"TelegramReminders"> => ({
  enabled: row.remindersEnabled,
  hour: row.reminderHour,
});

const chatOf = (row: LinkRow): Schema<"TelegramChat"> => ({ chatId: String(row.chatId), reminders: remindersOf(row) });

/** chat_id из пути: контракт уже проверил шаблон ^[1-9][0-9]{0,15}$ — здесь только перевод в число без потери точности. */
function chatIdOf(raw: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound("chat_not_linked");
  return id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** dialogId из пути: чужой формат — тот же 404 dialog_not_found (существование диалогов не раскрываем). */
function uuidOf(raw: string): string {
  if (!UUID_RE.test(raw)) throw notFound("dialog_not_found");
  return raw.toLowerCase();
}

/**
 * Модуль telegram (ADR 0020): привязка личного чата с ботом к аккаунту по подписи initData Mini App или одноразовому
 * коду с сайта (Valkey), вход по привязке (для identity) и напоминания о
 * серии по согласию. Хранит только chat_id и id аккаунта (telegram.schema.ts). Серию берёт у progress через его
 * публичный сервис — чужие таблицы не читает (правило 4). Служебные операции бота (роль service) проверяет
 * AccessControl до обработчика.
 *
 * Ежедневное задание (ADR 0024): FSM-диалоги в таблице telegram_dialogs — одна выданная дуэль на аккаунт, одна
 * учтённая в сутки по Уфе. Голос — через публичный ConsensusService.recordVote (контекст telegram), мёд — как в вебе.
 */
@Injectable()
export class TelegramService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(VALKEY) private readonly valkey: Redis,
    private readonly limiter: RateLimiter,
    private readonly progress: ProgressService,
    private readonly consensus: ConsensusService,
    @Inject(ACCOUNTS_PORT) private readonly accounts: AccountsPort,
  ) {}

  /** POST /telegram/link: подпись initData → user.id → привязка к вызывающему. Сама строка нигде не сохраняется. */
  async link(principal: Principal, body: Schema<"TelegramLinkRequest">, now: Date = new Date()): Promise<Schema<"TelegramLink">> {
    const botToken = this.config.TELEGRAM_BOT_TOKEN;
    if (!botToken) throw unavailable("telegram_unavailable");
    const check = verifyInitData(body.initData, botToken, now);
    if (!check.ok) throw unprocessable(check.reason === "expired" ? "init_data_expired" : "init_data_invalid");
    const row = await this.bind(check.userId, principal.accountId, now);
    return { reminders: remindersOf(row) };
  }

  /**
   * POST /auth/telegram (вход по привязке, вызывается из identity): подпись initData → user.id → лимит на чат →
   * аккаунт привязки. Статус аккаунта и сессия — у identity (таблица accounts — его). Сама строка не сохраняется.
   */
  async accountIdOfInitData(body: Schema<"TelegramLoginRequest">, now: Date = new Date()): Promise<string> {
    const botToken = this.config.TELEGRAM_BOT_TOKEN;
    if (!botToken) throw unavailable("telegram_unavailable");
    const check = verifyInitData(body.initData, botToken, now);
    if (!check.ok) throw unauthorized(check.reason === "expired" ? "init_data_expired" : "init_data_invalid");
    await this.limiter.consume(`tg-login:chat:${check.userId}`, TELEGRAM_LOGIN);
    const [row] = await this.db
      .select({ accountId: telegramLinks.accountId })
      .from(telegramLinks)
      .where(eq(telegramLinks.chatId, check.userId));
    if (!row) throw notFound("chat_not_linked");
    return row.accountId;
  }

  /**
   * POST /me/telegram/link-code: одноразовый код на 10 минут в Valkey. Новый код гасит прежний аккаунта
   * (скрипт ISSUE_CODE — атомарно). Не чаще 1 в минуту. Сотрудникам код не положен — 403.
   */
  async issueLinkCode(principal: Principal, now: Date = new Date()): Promise<Schema<"TelegramLinkCode">> {
    if (principal.kind === "staff") throw forbidden("telegram_login_forbidden");
    await this.limiter.consume(`tg-link-code:issue:${principal.accountId}`, LINK_CODE_ISSUE);
    const code = this.generateLinkCode();
    await this.kv(() =>
      this.valkey.eval(ISSUE_CODE, 2, LINK_CODE_KEY, `${LINK_CODE_ACCOUNT_KEY}${principal.accountId}`, String(LINK_CODE_TTL_SECONDS), code, principal.accountId) as Promise<string>,
    );
    return { code, expiresAt: new Date(now.getTime() + LINK_CODE_TTL_SECONDS * 1000).toISOString() };
  }

  /**
   * POST /telegram/bot/chats/link-code/redeem (бот, /start <код>): код расходуется атомарно (GETDEL — только один
   * запрос из параллельных), привязка — общий путь с /telegram/link: чат переходит к аккаунту кода, активные дуэли
   * прежнего владельца отменяются. Нет/истёк/использован — 404 code_not_found; брут-форс — 10 в час на чат.
   */
  async redeemLinkCode(body: Schema<"TelegramLinkCodeRedeemRequest">, now: Date = new Date()): Promise<Schema<"TelegramChat">> {
    const chatId = chatIdOf(body.chatId);
    await this.limiter.consume(`tg-link-code:redeem:${chatId}`, LINK_CODE_REDEEM);
    const accountId = await this.kv(() => this.valkey.getdel(`${LINK_CODE_KEY}${body.code}`));
    if (!accountId) throw notFound("code_not_found");
    // «Аккаунт → код» больше не нужен: код израсходован, следующий выпуск его не увидит.
    await this.kv(() => this.valkey.del(`${LINK_CODE_ACCOUNT_KEY}${accountId}`).catch(() => undefined));
    const row = await this.bind(chatId, accountId, now);
    return chatOf(row);
  }

  /**
   * Общий путь привязки (Mini App и код с сайта): upsert «чат → аккаунт» (повторная привязка переносит чат) и
   * закрытие выданных этому чату диалогов прежнего аккаунта — голос не уйдёт от прошлого владельца (ADR 0024).
   */
  private async bind(chatId: number, accountId: string, now: Date): Promise<LinkRow> {
    const [row] = await this.db
      .insert(telegramLinks)
      .values({ chatId, accountId, linkedAt: now })
      .onConflictDoUpdate({ target: telegramLinks.chatId, set: { accountId, linkedAt: now, updatedAt: now } })
      .returning();
    await this.db
      .update(telegramDialogs)
      .set({ status: "cancelled", cancelledAt: now })
      .where(and(eq(telegramDialogs.chatId, chatId), eq(telegramDialogs.status, "issued"), ne(telegramDialogs.accountId, accountId)));
    return row!;
  }

  /** Код привязки: 8 символов алфавита без похожих. */
  private generateLinkCode(): string {
    let code = "";
    for (let i = 0; i < 8; i++) code += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
    return code;
  }

  /** Valkey недоступен — 503: без него ни код не выдать, ни погасить (как вызовы кода входа). */
  private async kv<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch {
      throw unavailable();
    }
  }

  /** GET /telegram/bot/chats/{chatId} (бот). */
  async chat(chatId: string): Promise<Schema<"TelegramChat">> {
    const [row] = await this.db.select().from(telegramLinks).where(eq(telegramLinks.chatId, chatIdOf(chatId)));
    if (!row) throw notFound("chat_not_linked");
    return chatOf(row);
  }

  /** PUT /telegram/bot/chats/{chatId}/reminders (бот): согласие на напоминания и час. */
  async setReminders(chatId: string, body: Schema<"TelegramRemindersUpdate">): Promise<Schema<"TelegramChat">> {
    const [row] = await this.db
      .update(telegramLinks)
      .set({ remindersEnabled: body.enabled, ...(body.hour !== undefined ? { reminderHour: body.hour } : {}) })
      .where(eq(telegramLinks.chatId, chatIdOf(chatId)))
      .returning();
    if (!row) throw notFound("chat_not_linked");
    return chatOf(row);
  }

  /** DELETE /telegram/bot/chats/{chatId} (бот): /unlink или бот заблокирован. Повтор — то же 204. */
  async unlink(chatId: string): Promise<void> {
    const id = Number(chatId);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    // Диалоги чата удаляются вместе с привязкой: данных о чате не остаётся (голоса в журнале — у аккаунта, не чата).
    await this.db.transaction(async (tx) => {
      await tx.delete(telegramDialogs).where(eq(telegramDialogs.chatId, id));
      await tx.delete(telegramLinks).where(eq(telegramLinks.chatId, id));
    });
  }

  /**
   * POST /telegram/bot/chats/{chatId}/daily-duel (бот): выдача идемпотентна — активный диалог возвращается тем же
   * (перезапуск бота и повторные /daily ничего не теряют и не перевыддают). Вариант отклонён носителем с момента
   * выдачи — диалог закрывается и выдаётся свежая дуэль. Ответ на эти сутки по Уфе уже учтён — `done`; нерешённых
   * дуэлей нет — `empty`.
   */
  async dailyDuel(chatId: string, now: Date = new Date()): Promise<Schema<"TelegramDailyDuel">> {
    const id = chatIdOf(chatId);
    const [link] = await this.db.select().from(telegramLinks).where(eq(telegramLinks.chatId, id));
    if (!link) throw notFound("chat_not_linked");

    // Активный диалог один на аккаунт (частичный уникальный индекс).
    const [active] = await this.db
      .select()
      .from(telegramDialogs)
      .where(and(eq(telegramDialogs.accountId, link.accountId), eq(telegramDialogs.status, "issued")));
    if (active) {
      const card = await this.consensus.duelForDialog(active.itemId, [active.variantAId, active.variantBId]);
      if (card) return issuedOf(active, card);
      await this.db
        .update(telegramDialogs)
        .set({ status: "cancelled", cancelledAt: now })
        .where(and(eq(telegramDialogs.dialogId, active.dialogId), eq(telegramDialogs.status, "issued")));
    }

    // Одна учтённая дуэль в сутки по Уфе: сутки ответа считаем по моменту ответа. Окно 48 часов достовернее любых
    // часовых поясов накрывает границу суток (23:59 → 00:01), сами сутки — в JS по Уфе.
    const day = ufaDate(now);
    const recent = await this.db
      .select({ answeredAt: telegramDialogs.answeredAt })
      .from(telegramDialogs)
      .where(and(eq(telegramDialogs.accountId, link.accountId), eq(telegramDialogs.status, "answered"), gte(telegramDialogs.answeredAt, new Date(now.getTime() - 48 * 3_600_000))));
    if (recent.some((r) => r.answeredAt !== null && ufaDate(r.answeredAt) === day)) return { state: "done" };

    const voter = await this.accounts.voterView(this.db, link.accountId);
    if (!voter) return { state: "empty" };
    const card = await this.consensus.pickDailyDuel({ accountId: link.accountId, ...voter });
    if (!card) return { state: "empty" };

    const [row] = await this.db
      .insert(telegramDialogs)
      .values({
        chatId: id,
        accountId: link.accountId,
        itemId: card.itemId,
        variantAId: card.a.variantId,
        variantBId: card.b.variantId,
        judgmentId: uuidv7(),
        day,
      })
      .onConflictDoNothing()
      .returning();
    if (row) return issuedOf(row, card);
    // Гонка двух чатов одного аккаунта: диалог уже вставлен параллельным вызовом — отвечаем его строкой.
    const [raced] = await this.db
      .select()
      .from(telegramDialogs)
      .where(and(eq(telegramDialogs.accountId, link.accountId), eq(telegramDialogs.status, "issued")));
    if (raced) {
      const racedCard = await this.consensus.duelForDialog(raced.itemId, [raced.variantAId, raced.variantBId]);
      if (racedCard) return issuedOf(raced, racedCard);
    }
    return { state: "done" };
  }

  /**
   * POST /telegram/bot/dialogs/{dialogId}/answer (бот): голос — в журнал judgments через ConsensusService (контекст
   * telegram, группа — по типу и ролям аккаунта из привязки), мёд — как в вебе. Строка диалога блокируется на
   * транзакцию: два нажатия подряд дают один голос и один ответ. Повтор той же кнопки — replay; другой выбор по
   * отвеченному диалогу — 409 already_voted; отменённый — 409 dialog_closed. За исходник уже голосовали (веб, урок) —
   * диалог закрывается и отдаётся 409 already_voted.
   */
  async answerDialog(dialogId: string, body: Schema<"TelegramDailyAnswerRequest">, now: Date = new Date()): Promise<Schema<"TelegramDailyAnswer">> {
    const id = uuidOf(dialogId);
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx.select().from(telegramDialogs).where(eq(telegramDialogs.dialogId, id)).for("update");
        if (!row) throw notFound("dialog_not_found");
        if (row.status === "cancelled") throw conflict("dialog_closed");
        if (row.status === "answered") {
          if (row.choice === body.choice) return { replay: true, status: row.itemStatus as Schema<"ItemStatus"> };
          throw conflict("already_voted");
        }

        const voter = await this.accounts.voterView(tx, row.accountId);
        if (!voter) throw forbidden();
        // Время от выдачи до ответа: считает API, в запросе только choice. Журнал хранит 0…3600000 — обрезаем.
        const latencyMs = Math.min(3_600_000, Math.max(0, now.getTime() - row.createdAt.getTime()));
        const receipt = await this.consensus.recordVote(tx, {
          judgmentId: row.judgmentId,
          voter: { accountId: row.accountId, ...voter },
          itemId: row.itemId,
          shown: [row.variantAId, row.variantBId],
          choice: body.choice,
          context: "telegram",
          latencyMs,
          at: now,
        });
        await tx
          .update(telegramDialogs)
          .set({ status: "answered", choice: body.choice, itemStatus: receipt.status, answeredAt: now })
          .where(eq(telegramDialogs.dialogId, row.dialogId));
        return { replay: receipt.replay, status: receipt.status };
      });
    } catch (e) {
      // За этот исходник уже голосовали другим путём (веб/урок) между выдачей и нажатием: транзакция откатилась,
      // диалог закрываем отдельным UPDATE — кнопка больше не отвечает, свежую дуэль бот выдаст по /daily.
      if (e instanceof ApiError && e.code === "already_voted") {
        await this.db
          .update(telegramDialogs)
          .set({ status: "cancelled", cancelledAt: now })
          .where(and(eq(telegramDialogs.dialogId, id), eq(telegramDialogs.status, "issued")));
      }
      throw e;
    }
  }

  /** POST /telegram/bot/chats/{chatId}/daily-duel/cancel (бот): закрывает активный диалог аккаунта. Повтор — false. */
  async cancelDaily(chatId: string, now: Date = new Date()): Promise<Schema<"TelegramDailyCancel">> {
    const id = chatIdOf(chatId);
    const [link] = await this.db.select().from(telegramLinks).where(eq(telegramLinks.chatId, id));
    if (!link) throw notFound("chat_not_linked");
    const cancelled = await this.db
      .update(telegramDialogs)
      .set({ status: "cancelled", cancelledAt: now })
      .where(and(eq(telegramDialogs.accountId, link.accountId), eq(telegramDialogs.status, "issued")))
      .returning({ dialogId: telegramDialogs.dialogId });
    return { cancelled: cancelled.length > 0 };
  }

  /**
   * POST /telegram/bot/reminders/claim (бот): чаты, которым пора напомнить, — и сразу отметка «напомнили сегодня».
   * Отметка — условным UPDATE: два параллельных вызова не выдадут один чат дважды за сутки.
   */
  async claimReminders(now: Date = new Date()): Promise<Schema<"TelegramReminderBatch">> {
    const day = ufaDate(now);
    const hour = ufaHour(now);
    if (!outsideQuietHours(hour)) return { day, items: [] };
    const notYetToday = or(isNull(telegramLinks.lastRemindedOn), lt(telegramLinks.lastRemindedOn, day));
    const candidates = await this.db
      .select({ chatId: telegramLinks.chatId, accountId: telegramLinks.accountId })
      .from(telegramLinks)
      .where(and(eq(telegramLinks.remindersEnabled, true), lte(telegramLinks.reminderHour, hour), notYetToday));
    if (candidates.length === 0) return { day, items: [] };

    const atRisk = await this.progress.streaksAtRisk([...new Set(candidates.map((c) => c.accountId))], now);
    const due = candidates.filter((c) => atRisk.has(c.accountId)).map((c) => c.chatId);
    if (due.length === 0) return { day, items: [] };
    const claimed = await this.db
      .update(telegramLinks)
      .set({ lastRemindedOn: day })
      .where(and(inArray(telegramLinks.chatId, due), eq(telegramLinks.remindersEnabled, true), notYetToday))
      .returning({ chatId: telegramLinks.chatId });
    return { day, items: claimed.map((c) => ({ chatId: String(c.chatId) })).sort((a, b) => a.chatId.localeCompare(b.chatId)) };
  }
}

/** Выданный диалог для бота: стороны — в сохранённом порядке показа (choice ответа относительно него). */
function issuedOf(row: Pick<DialogRow, "dialogId" | "itemId">, card: { sourceRu: string; a: { variantId: string; text: string }; b: { variantId: string; text: string } }): Schema<"TelegramDailyDuel"> {
  return {
    state: "issued",
    dialogId: row.dialogId,
    itemId: row.itemId,
    sourceRu: card.sourceRu,
    a: card.a,
    b: card.b,
  };
}
