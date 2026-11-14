// pnpm --filter @teletau/api demo:seed — демо-мир показа (docs/demo/M2.md). Обычно его вызывает `pnpm demo:reset`
// после пересоздания базы. Работает только в демо-режиме (AUTH_DEMO_OTP и AUTH_DEMO_STAFF=1, не production) и только
// на чистой базе: голоса неизменяемы (правило 9, триггер на judgments), поэтому повтор — через `pnpm demo:reset`.
//
// Аргументы: --out <каталог> (по умолчанию .demo в корне репозитория) — world.json и картинки карточек учеников;
// --e2e-worlds <n> — ещё n маленьких миров для повторов сквозного теста (e2e/run.mjs).
import "reflect-metadata";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Redis } from "ioredis";
import QRCode from "qrcode";
import { createApp } from "../bootstrap.js";
import { loadConfig } from "../config/config.js";
import { VALKEY } from "../infra/tokens.js";
import { buildPlan } from "./plan.js";
import { DemoWorldBuilder, DemoWorldExists, type WorldSummary } from "./world.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const log = (msg: string) => console.log(`demo:seed: ${msg}`);

function fail(msg: string): never {
  console.error(`demo:seed: ${msg}`);
  process.exit(1);
}

const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10;
  const h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};

const TIERS: Record<string, string> = { clover: "Клевер", buckwheat: "Гречиха", sweetclover: "Донник", fireweed: "Кипрей", linden: "Липа" };

function print(worlds: WorldSummary[], files: Map<number, string>, web: string, consoleUrl: string): void {
  const w = worlds[0]!;
  const card = files.get(1)!;
  const lines = [
    "",
    "Демо-мир M2 готов. Сценарий — docs/demo/M2.md.",
    "",
    `  Учитель (ноутбук): ${web}/teacher/login → «Электронная почта» ${w.teacher.email} → код ${w.teacher.code}`,
    `    ${w.class.title}, ${w.class.school}: ${w.class.seats} ${plural(w.class.seats, "место", "места", "мест")}; вкладка «Прогресс» и раздел «Помогите языку»`,
    `  Ученик (телефон): №${String(w.student.seat).padStart(2, "0")} · ${w.student.nickname} — ${web} → «У меня есть карточка или код»,`,
    `    затем «Сканировать карточку» (картинка на экране ноутбука) или «Загрузить фото карточки»: ${card}`,
    `    серия ${w.expect.streakBefore} ${plural(w.expect.streakBefore, "день", "дня", "дней")}, заморозок в запасе ${w.expect.freezes}, пройдено уроков ${w.expect.lessonsBefore}` +
      (w.expect.leagueUp ? `, после урока — «Новая лига — ${TIERS[w.expect.leagueUp]}!»` : ""),
    `  Урок показа: «${w.lesson.titleRu}»; дуэль: «${w.duel.sourceRu}» — ${w.duel.variants.join(" / ")}`,
    ...(w.class.joinCode ? [`  Код класса ${w.class.title}: ${w.class.joinCode} — постоянный («Ввести код класса» → код → ник → учитель «Заявки на вход» → «Принять»)`] : []),
    `  После урока в классе занимались ${w.expect.activeAfter} из ${w.expect.seatsTotal}.`,
    ...(w.assignment ? [`  Задание классу: «${w.assignment.titleRu}» до ${w.assignment.dueOn} — сделали ${w.assignment.done} из ${w.assignment.total}; демо-ученик выполнит его уроком показа`] : []),
    ...(w.republic
      ? [
          `  Республика: ${w.republic.districts} районов, ${w.republic.schools} школ, ${w.republic.classes} классов, ${w.republic.students} учеников и ${w.republic.selfLearners} «Учусь сам», уроков ${w.republic.lessons}`,
        ]
      : []),
    ...(w.kzPairs ? [`  Казахско-башкирский словарь: ${w.kzPairs} пар ba-kz (казахский исходник → башкирский вариант) — ${web}/dictionary`] : []),
    `  Консоль (${consoleUrl}/login, код 0000 + TOTP из apps/api/data/README.md): министерство — ministry@demo.teletau.local («Республика»),`,
    `    Фонд — fund@demo.teletau.local («Словарь для Фонда»), модератор — moderator@demo.teletau.local`,
  ];
  for (const x of worlds.slice(1)) lines.push(`  Мир e2e ${x.index}: ${x.teacher.email}, ${x.class.title}, ученик №${String(x.student.seat).padStart(2, "0")} · ${x.student.nickname} (${files.get(x.index)})`);
  console.log(lines.join("\n"));
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: "string" }, "e2e-worlds": { type: "string" } } });
  const outDir = resolve(values.out ?? join(ROOT, ".demo"));
  const extraWorlds = Number(values["e2e-worlds"] ?? 0);
  if (!Number.isInteger(extraWorlds) || extraWorlds < 0 || extraWorlds > 2) fail("--e2e-worlds — от 0 до 2 (запасных пар дуэлей две)");

  process.env["NEST_LOG_LEVEL"] ??= "warn";
  const config = loadConfig(process.env);
  if (config.NODE_ENV === "production") fail("в production демо-мира нет");
  if (!config.AUTH_DEMO_STAFF) fail("нужен демо-режим сотрудников: AUTH_DEMO_STAFF=1 в .env (модератор одобряет демо-учителей)");
  if (!config.AUTH_DEMO_OTP) fail("нужен демо-код входа: AUTH_DEMO_OTP=0000 в .env");

  const started = Date.now();
  const app = await createApp(config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const valkey = app.get<Redis>(VALKEY);
  if (valkey.status !== "ready") await new Promise((r) => valkey.once("ready", r));
  try {
    const now = new Date();
    const plan = buildPlan(now, { extraWorlds });
    const builder = new DemoWorldBuilder(app, config, plan, log);
    await builder.ensureFresh();
    const worlds = await builder.build(extraWorlds);

    mkdirSync(outDir, { recursive: true });
    const files = new Map<number, string>();
    for (const w of worlds) {
      const file = join(outDir, w.index === 1 ? "student-card.png" : `student-card-${w.index}.png`);
      // Как карточка из PDF (ADR 0016): в QR только полезная нагрузка TT1.…; веб распознаёт её с камеры и с фото.
      await QRCode.toFile(file, w.student.card, { errorCorrectionLevel: "M", margin: 4, width: 640 });
      files.set(w.index, relative(ROOT, file));
    }
    writeFileSync(join(outDir, "world.json"), `${JSON.stringify({ createdAt: now.toISOString(), worlds }, null, 2)}\n`);
    print(worlds, files, config.PUBLIC_WEB_URL, config.PUBLIC_CONSOLE_URL);
    log(`готово за ${((Date.now() - started) / 1000).toFixed(1)} с; данные мира — ${relative(ROOT, join(outDir, "world.json"))}`);
  } catch (e) {
    if (e instanceof DemoWorldExists) fail(`${e.message} Полный сброс: остановите pnpm dev и выполните pnpm demo:reset.`);
    throw e;
  } finally {
    await app.close();
  }
}

await main();
