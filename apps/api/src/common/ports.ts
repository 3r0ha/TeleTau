// Порты — обратные зависимости между модулями (инверсия зависимостей, ADR 0014).
// Граф модулей ацикличен: identity → moderation → org → consent → admin. Когда нижнему модулю нужно что-то
// от верхнего, он объявляет потребность здесь, а верхний модуль её реализует и отдаёт по токену DI.
// Так нет циклов импорта, и модуль не читает чужие таблицы.
import type { Schema } from "@teletau/contracts";
import type { Db } from "../db/database.js";
import type { Principal } from "./auth.js";

export interface AdultProfileView {
  email: string;
  fullName?: string;
  position?: string;
}

/** Реализует identity: аккаунты, ПДн взрослых (схема pii), роли и сессии. */
export interface AccountsPort {
  /** Новый детский аккаунт без ПДн (роль student). */
  createChildAccount(db: Db, init: { nicknameKey?: string; nickname?: string }): Promise<string>;
  /** Ники детских аккаунтов (у кого ник ещё не выбран — нет в ответе). */
  nicknames(accountIds: readonly string[]): Promise<Map<string, string>>;
  /** ПДн взрослых — только для модератора и самого взрослого. */
  adultProfiles(accountIds: readonly string[]): Promise<Map<string, AdultProfileView>>;
  /** ФИО и должность заявителя — только в pii.adult_profiles. */
  setTeacherProfile(db: Db, accountId: string, profile: { fullName: string; position: string }): Promise<void>;
  grantTeacherRole(db: Db, accountId: string): Promise<void>;
  /**
   * Отзывает все сессии аккаунта в транзакции `db` (отзыв согласия родителем, выпуск карточки на место, блокировка)
   * и закрывает выдачу сессий по его заявкам на вход по коду класса: забрать сессию повторным опросом после
   * этого нельзя. Снимает и входы в обход карточки: привязки Telegram, а при перевыпуске карточки — вход по почте
   * детского аккаунта. Возвращает отозванные семейства: их стоп-лист вызывающий обновляет через blockSessions после
   * фиксации транзакции.
   */
  revokeAllSessions(db: Db, accountId: string, reason: "consent_revoked" | "account_blocked" | "card_reissued"): Promise<string[]>;
  /** Стоп-лист Valkey для отозванных семейств: access-токены перестают работать сразу. Valkey недоступен — 503. */
  blockSessions(familyIds: readonly string[]): Promise<void>;
  /**
   * Возрастной диапазон аккаунта без возраста по годам (ADR 0022): у взрослого — `adult`, у ребёнка — по режиму
   * интерфейса (самостоятельный ученик выбрал диапазон сам, ученику класса режим выставлен по номеру класса).
   * Нет режима или аккаунта — undefined. Для групп лиги (competition); `db` — читать в транзакции вызывающего.
   */
  ageBand(db: Db, accountId: string): Promise<Schema<"AgeBand"> | undefined>;
  /** Цель дня, выбранная учеником (1–3 соты), или undefined — по умолчанию (progress, ADR 0022). */
  dailyGoalTarget(db: Db, accountId: string): Promise<number | undefined>;
  /**
   * Тип и роли аккаунта по id — группа голосующего (child / teacher / adult) для голоса в боте по привязке чата
   * (ADR 0024): как снимок в access-токене, только без сессии. `db` — читать в транзакции вызывающего. Нет аккаунта
   * или он не действует (заблокирован, удалён) — undefined.
   */
  voterView(db: Db, accountId: string): Promise<Pick<Principal, "kind" | "roles"> | undefined>;
  /** Действующие аккаунты учеников и взрослых из списка (без сотрудников) — для рассылки бота. */
  activeAccounts(accountIds: readonly string[]): Promise<Set<string>>;
  /**
   * Для кабинета министерства (ADR 0023): действующие аккаунты «Учусь сам» (ADR 0022) — идентификаторы только для
   * подсчётов, в ответы API они не попадают — и число подтверждённых учителей (роль teacher).
   */
  republicAccounts(): Promise<{ selfLearnerIds: string[]; teachersVerified: number }>;
}
export const ACCOUNTS_PORT = Symbol("ACCOUNTS_PORT");

/** Реализует org: проверка «учитель класса» и места для модуля consent. */
export interface ClassAccessPort {
  /** Место класса, если принципал — учитель этого класса; иначе ApiError 403/404. */
  requireTeacherSeat(principal: Principal, classId: string, seatNumber: number): Promise<{ seatId: string; accountId?: string }>;
  isClassTeacher(principal: Principal, classId: string): Promise<boolean>;
  /** Номер места и ученик по идентификатору места (для ответа о бумажном согласии); `db` — читать в транзакции. */
  seatInfo(seatId: string, db?: Db): Promise<{ classId: string; seatNumber: number; accountId?: string } | undefined>;
  /**
   * Блокировка места до конца транзакции `db`. Её берут вход ученика на место (QR, выдача сессии по заявке
   * кода класса) и отзыв доступа к месту (отзыв согласия, выпуск карточки): они не пересекаются, поэтому сессия,
   * выданная до отзыва, им же и завершается, а после отзыва не выдаётся.
   */
  lockSeat(db: Db, seatId: string): Promise<void>;
}
export const CLASS_ACCESS_PORT = Symbol("CLASS_ACCESS_PORT");

/** Реализует moderation: школа из одобренной заявки учителя (для создания класса в org). */
export interface TeacherSchoolPort {
  approvedSchoolId(accountId: string): Promise<string | undefined>;
}
export const TEACHER_SCHOOL_PORT = Symbol("TEACHER_SCHOOL_PORT");
