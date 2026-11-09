// Демо-мир (docs/plans/M2.md §1, «Сборка»; сценарий показа — docs/demo/M2.md). Строится через публичный API:
// учётные записи, классы и вход учеников — запросами к настоящему приложению (Fastify inject, без сети); уроки, голоса
// и лига — публичными сервисами модулей с подменёнными часами (параметры now / at). В чужие таблицы сид не пишет
// (CLAUDE.md, правило 4). Детских ПДн нет: ученик — номер места и ник из словаря (ADR 0009).
//
// Дуэли. Демо-ученик голосует в уроке показа за пару «показа», учитель — за неё же на странице «Помогите языку»,
// и голос учителя даёт «Принят» при любых выборах обоих: до показа у пары голоса детей поровну за оба варианта (баланс
// ведёт сид), взрослые — только «Оба подходят», учителей нет (duel-v0: 3 ± 1 ≥ 2). Пара показа — единственная, за которую
// демо-ученик ещё не голосовал из тех, где голосование идёт, — её и выберет сервер (сначала voting). Ещё две такие же
// «запасные» пары нужны повторам сквозного теста (--e2e-worlds), они же — «ждут» в «Моём вкладе» демо-ученика.
import { randomInt, randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Schema } from "@teletau/contracts";
import {
  dayToDate,
  duelV0,
  ufaDate,
  ufaDayNumber,
  type DuelChoice,
  type DuelVote,
  type LeagueTier,
  type Verdict,
} from "@teletau/domain-rules";
import { generate } from "otplib";
import type { Principal } from "../common/auth.js";
import { uuidv7 } from "../common/uuidv7.js";
import type { AppConfig } from "../config/config.js";
import type { Db } from "../db/database.js";
import { DB } from "../infra/tokens.js";
import { AssignmentsService } from "../modules/assignments/index.js";
import { CompetitionService } from "../modules/competition/index.js";
import { ConsensusService, type Voter } from "../modules/consensus/index.js";
import { ContentService, type LessonContent } from "../modules/content/index.js";
import { CorpusService, type DuelItem } from "../modules/corpus/index.js";
import { DEMO_STAFF } from "../modules/identity/index.js";
import { LearningService, LESSONS_BEFORE_DUELS } from "../modules/learning/index.js";
import { ClassesService } from "../modules/org/index.js";
import { ProgressService } from "../modules/progress/index.js";
import { answerSheet, correctAnswer, mistakenAnswer, type AnswerSheetRow } from "./answers.js";
import {
  DEMO_STUDENT_DAYS,
  DEMO_STUDENT_NICKNAME_ID,
  DEMO_STUDENT_SEAT,
  mulberry32,
  randInt,
  type DemoPlan,
  type KidSpec,
  type Rng,
} from "./plan.js";
import {
  buildRegionPlan,
  REGION_SCHOOLS,
  REGION_SELF,
  regionKidKey,
  regionNickname,
} from "./region.js";

type Me = Schema<"Me">;
type AuthSession = Schema<"AuthSession">;
type RunExercise = Schema<"RunExercise">;
type DuelExercise = Schema<"DuelExercise">;

/** Учётные записи демо-мира (e-mail взрослых — служебный домен демо, как у сотрудников консоли). */
export const DEMO_TEACHER = {
  email: "teacher@demo.teletau.local",
  fullName: "Учитель Демонстрационный",
  position: "Учитель башкирского языка",
  school: 1,
} as const;
export const DEMO_TEACHER_2 = {
  email: "teacher2@demo.teletau.local",
  fullName: "Учитель Второй Школы",
  position: "Учитель башкирского языка",
  school: 2,
} as const;
export const DEMO_UNIT = "01-ufa";
/** Урок показа (шаг 2): текущий узел демо-ученика. */
export const DEMO_LESSON = "u01-moya-shkola";

/** Пары дуэлей по ролям (внешние id из content/corpus/duels): показа, запасные и принятая заранее. */
const PREFERRED = {
  demo: "u01-d-zdravstvuyte",
  spares: ["u01-d-do-svidaniya", "u01-d-spasibo"],
  early: ["u01-d-dobroy-nochi"],
};

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randomIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const device = (): Schema<"DeviceInfo"> => ({ installId: randomUUID(), platform: "web" });
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const isDuel = (e: RunExercise): e is DuelExercise => e.type === "duel";

export interface DemoKid {
  key: string;
  spec?: KidSpec;
  seat: number;
  nickname: string;
  card: string;
  principal: Principal;
  classId: string;
  rng: Rng;
  skill: number;
  voted: Set<string>;
  helpEmpty: boolean;
}

interface DemoAdult {
  principal: Principal;
  voted: Set<string>;
}

interface DemoTeacher {
  principal: Principal;
  /** Access-токен с ролью teacher (после одобрения заявки): операции классов в сиде — без лишних входов по коду. */
  token: string;
  email: string;
  fullName: string;
  schoolName: string;
}

export interface WorldSummary {
  index: number;
  teacher: { email: string; fullName: string; code: string };
  /** joinCode — постоянный код класса (AUTH_DEMO_CLASS_CODE), если он задан: «000-000». */
  class: { id: string; title: string; school: string; seats: number; joinCode?: string };
  student: { seat: number; nickname: string; card: string };
  lesson: { id: string; titleRu: string; answers: AnswerSheetRow[] };
  duel: { itemId: string; externalId: string; sourceRu: string; variants: [string, string] };
  expect: {
    streakBefore: number;
    freezes: number;
    lessonsBefore: number;
    leagueUp: LeagueTier | null;
    /** Сколько учеников класса занимались на неделе после урока показа. */
    activeAfter: number;
    seatsTotal: number;
  };
  /** Активное задание учителя классу (ADR 0021): урок показа до ближайшей пятницы. */
  assignment?: { titleRu: string; dueOn: string; done: number; total: number };
  /** Республика для кабинета министерства (region.ts, ADR 0023) — только у основного мира. */
  republic?: {
    districts: number;
    schools: number;
    classes: number;
    students: number;
    selfLearners: number;
    lessons: number;
  };
}

/** Итог республики демо-мира (для world.json и вывода сида). */
type RepublicSummary = NonNullable<WorldSummary["republic"]>;

/** Тонкий клиент к приложению в процессе: тот же разбор, проверки доступа и лимиты, что у настоящих запросов. */
class Http {
  constructor(private readonly app: NestFastifyApplication) {}

  async call<T>(
    method: "GET" | "POST" | "PATCH",
    url: string,
    o: { token?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: T }> {
    const res = await this.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url: `/api/v1${url}`,
        remoteAddress: randomIp(),
        headers: {
          ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
          ...(o.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(o.body !== undefined ? { payload: JSON.stringify(o.body) } : {}),
      });
    const json = String(res.headers["content-type"] ?? "").includes("json");
    return { status: res.statusCode, body: (json ? res.json() : res.body) as T };
  }

  async expect<T>(
    status: number,
    method: "GET" | "POST" | "PATCH",
    url: string,
    o: { token?: string; body?: unknown } = {},
  ): Promise<T> {
    const res = await this.call<T>(method, url, o);
    if (res.status !== status)
      throw new Error(
        `сид: ${method} ${url} — ожидался ${status}, получен ${res.status}: ${JSON.stringify(res.body).slice(0, 400)}`,
      );
    return res.body;
  }
}

const principalOf = (me: Me): Principal => ({
  accountId: me.id,
  kind: me.kind,
  roles: me.roles,
  sessionId: "demo-seed",
  deviceId: "demo-seed",
});

export class DemoWorldBuilder {
  private readonly http: Http;
  private readonly db: Db;
  private readonly learning: LearningService;
  private readonly progress: ProgressService;
  private readonly competition: CompetitionService;
  private readonly consensus: ConsensusService;
  private readonly corpus: CorpusService;
  private readonly content: ContentService;
  private readonly classes: ClassesService;
  private readonly assignments: AssignmentsService;
  private readonly rng: Rng;
  private readonly lessons = new Map<string, LessonContent>();
  private readonly kids = new Map<string, DemoKid>();
  private readonly adults: DemoAdult[] = [];
  /** Баланс голосов детей за пары показа и запасные: +1 за variants[0], −1 за variants[1] (both и skip — 0). */
  private readonly balance = new Map<string, number>();
  private items = new Map<string, DuelItem>();
  private roles!: {
    demo: DuelItem;
    spares: [DuelItem, DuelItem];
    early: DuelItem[];
    late: DuelItem[];
    truth: Map<string, 0 | 1>;
  };
  private moderatorToken = "";
  private teacher!: DemoTeacher;
  private teacher2!: DemoTeacher;
  private classIds = new Map<
    string,
    { id: string; title: string; school: string; seats: number; joinCode?: string }
  >();
  private readonly extra: {
    index: number;
    teacher: DemoTeacher;
    kid: DemoKid;
    classInfo: { id: string; title: string; school: string; seats: number; joinCode?: string };
  }[] = [];
  private abandoned = 0;
  private lessonsRun = 0;
  private republic: RepublicSummary | undefined;

  constructor(
    private readonly app: NestFastifyApplication,
    private readonly config: AppConfig,
    private readonly plan: DemoPlan,
    private readonly log: (msg: string) => void,
  ) {
    this.http = new Http(app);
    this.db = app.get<Db>(DB);
    this.learning = app.get(LearningService);
    this.progress = app.get(ProgressService);
    this.competition = app.get(CompetitionService);
    this.consensus = app.get(ConsensusService);
    this.corpus = app.get(CorpusService);
    this.content = app.get(ContentService);
    this.classes = app.get(ClassesService);
    this.assignments = app.get(AssignmentsService);
    this.rng = mulberry32(0x6d69_7232);
  }

  private get code(): string {
    return this.config.AUTH_DEMO_OTP!;
  }

  // ── проверки до сида ──

  /** Мир строится только на чистой базе: демо-учителя ещё нет, голосов в корпусе нет. Иначе — понятная ошибка. */
  async ensureFresh(): Promise<void> {
    const session = await this.loginAdult(DEMO_TEACHER.email);
    if (session.account.teacherStatus !== "none" || session.account.classes.length > 0) {
      throw new DemoWorldExists("Демо-мир уже создан (демо-учитель есть в базе).");
    }
    const duels = await this.corpus.allDuels();
    for (const d of duels) {
      if (((await this.consensus.recompute(d.itemId))?.votes.length ?? 0) > 0)
        throw new DemoWorldExists("В корпусе уже есть голоса: демо-мир строится на чистой базе.");
    }
  }

  // ── учётные записи (через HTTP, как настоящие клиенты) ──

  private async loginAdult(email: string): Promise<AuthSession & { device: Schema<"DeviceInfo"> }> {
    const ch = await this.http.expect<Schema<"OtpChallenge">>(202, "POST", "/auth/otp/request", {
      body: { email },
    });
    const d = device();
    const s = await this.http.expect<AuthSession>(200, "POST", "/auth/otp/verify", {
      body: { challengeId: ch.challengeId, code: this.code, device: d },
    });
    return { ...s, device: d };
  }

  private async acceptConsents(token: string): Promise<void> {
    const docs = await this.http.expect<Schema<"LegalDocumentList">>(
      200,
      "GET",
      "/legal-documents/current",
    );
    const documentIds = docs.items
      .filter((d) => ["terms", "privacy", "consent_adult"].includes(d.kind))
      .map((d) => d.id);
    await this.http.expect(201, "POST", "/consents", { token, body: { documentIds } });
  }

  /** Демо-модератор: e-mail → демо-код → TOTP из репозитория (apps/api/data/README.md); код окна ±1 шаг. */
  private async loginModerator(): Promise<string> {
    const staff =
      DEMO_STAFF.find((s) => s.roles.includes("moderator") && !s.roles.includes("admin")) ??
      DEMO_STAFF[0]!;
    for (let round = 0; round < 2; round++) {
      for (const offset of [0, 30, -30]) {
        const ch = await this.http.expect<Schema<"OtpChallenge">>(
          202,
          "POST",
          "/auth/otp/request",
          { body: { email: staff.email } },
        );
        const totp = await generate({
          secret: staff.totpSecret,
          epoch: Math.floor(Date.now() / 1000) + offset,
        });
        const res = await this.http.call<AuthSession>("POST", "/auth/otp/verify", {
          body: { challengeId: ch.challengeId, code: this.code, totp, device: device() },
        });
        if (res.status === 200) return res.body.accessToken;
      }
      await pause(31_000 - ((Date.now() / 1000) % 30) * 1000);
    }
    throw new Error("сид: демо-модератор не вошёл (коды TOTP окна заняты)");
  }

  /** Подтверждённый учитель: вход → условия → заявка в демо-школу → одобрение модератором → обновление токена. */
  private async verifiedTeacher(who: {
    email: string;
    fullName: string;
    position: string;
    school: number | Schema<"School">;
  }): Promise<DemoTeacher> {
    const s = await this.loginAdult(who.email);
    await this.acceptConsents(s.accessToken);
    let school: Schema<"School"> | undefined;
    if (typeof who.school === "number") {
      const name = `Демо-школа № ${who.school}`;
      const page = await this.http.expect<Schema<"SchoolPage">>(
        200,
        "GET",
        `/schools?q=${encodeURIComponent(name)}`,
        { token: s.accessToken },
      );
      school = page.items.find((x) => x.isDemo && x.shortNameRu === name);
      if (!school)
        throw new Error(
          `сид: нет «${name}» — справочник не загружен (pnpm --filter @teletau/api org:import)`,
        );
    } else school = who.school;
    const v = await this.http.expect<Schema<"TeacherVerification">>(
      201,
      "POST",
      "/teacher/verification",
      {
        token: s.accessToken,
        body: { schoolId: school.id, fullName: who.fullName, position: who.position },
      },
    );
    if (!this.moderatorToken) this.moderatorToken = await this.loginModerator();
    await this.http.expect(200, "POST", `/moderation/teacher-verifications/${v.id}/approve`, {
      token: this.moderatorToken,
    });
    const r = await this.http.expect<AuthSession>(200, "POST", "/auth/refresh", {
      body: { refreshToken: s.refreshToken, deviceInstallId: s.device.installId },
    });
    if (!r.account.roles.includes("teacher"))
      throw new Error(`сид: ${who.email} не получил роль teacher`);
    return {
      principal: principalOf(r.account),
      token: r.accessToken,
      email: who.email,
      fullName: who.fullName,
      schoolName: school.shortNameRu,
    };
  }

  /** Класс с карточками и учениками: вход по QR-карточке и ник из словаря — как у настоящего ученика. */
  private async classWithKids(
    teacher: DemoTeacher,
    cls: { key: string; grade: number; letter: string; seats: number },
    kids: { key: string; seat: number; nicknameId: string; spec?: KidSpec; skill: number }[],
  ): Promise<DemoKid[]> {
    const token = await this.teacherToken(teacher);
    const created = await this.http.expect<Schema<"ClassDetail">>(201, "POST", "/classes", {
      token,
      body: { grade: cls.grade, letter: cls.letter, program: "native" },
    });
    this.classIds.set(cls.key, {
      id: created.id,
      title: created.title,
      school: teacher.schoolName,
      seats: cls.seats,
    });
    const issued = await this.http.expect<Schema<"SeatIssueResult">>(
      201,
      "POST",
      `/classes/${created.id}/seats`,
      { token, body: { count: cls.seats } },
    );
    const cards = await this.classes.printJobCards(
      teacher.principal,
      created.id,
      issued.printJob.id,
    );
    const out: DemoKid[] = [];
    for (const k of kids) {
      const card = cards.find((c) => c.seatNumber === k.seat);
      if (!card) throw new Error(`сид: нет карточки места ${k.seat}`);
      const s = await this.http.expect<AuthSession>(200, "POST", "/auth/qr", {
        body: { payload: card.payload, device: device() },
      });
      const me = await this.http.expect<Me>(200, "PATCH", "/me", {
        token: s.accessToken,
        body: { nicknameId: k.nicknameId },
      });
      const kid: DemoKid = {
        key: k.key,
        ...(k.spec ? { spec: k.spec } : {}),
        seat: k.seat,
        nickname: me.nickname ?? "",
        card: card.payload,
        principal: principalOf(me),
        classId: created.id,
        rng: mulberry32(0x1000 + out.length * 7919 + cls.grade * 131 + cls.letter.charCodeAt(0)),
        skill: k.skill,
        voted: new Set(),
        helpEmpty: false,
      };
      this.kids.set(k.key, kid);
      out.push(kid);
    }
    return out;
  }

  /** Токен учителя для операций классов (лимит запросов кода входа — 5 на адрес за 10 минут, ведущему нужен свой). */
  private async teacherToken(teacher: DemoTeacher): Promise<string> {
    return teacher.token;
  }

  private async adult(i: number): Promise<DemoAdult> {
    while (this.adults.length <= i) {
      const n = this.adults.length + 1;
      const s = await this.loginAdult(`adult${n}@demo.teletau.local`);
      await this.acceptConsents(s.accessToken);
      this.adults.push({ principal: principalOf(s.account), voted: new Set() });
    }
    return this.adults[i]!;
  }

  // ── сборка мира ──

  async build(extraWorlds: number): Promise<WorldSummary[]> {
    await this.loadDuels();
    this.teacher = await this.verifiedTeacher(DEMO_TEACHER);
    this.teacher2 = await this.verifiedTeacher(DEMO_TEACHER_2);
    const specs = this.plan.kids;
    const of = (classKey: string) => specs.filter((k) => k.classKey === classKey);
    const fiveB = of("5b").map((k) => ({
      key: k.key,
      seat: k.seat,
      nicknameId: k.nicknameId,
      spec: k,
      skill: k.seat === DEMO_STUDENT_SEAT ? 0.9 : k.skill,
    }));
    if (fiveB.find((k) => k.seat === DEMO_STUDENT_SEAT)?.nicknameId !== DEMO_STUDENT_NICKNAME_ID)
      throw new Error("сид: у демо-ученика не тот ник");
    await this.classWithKids(this.teacher, { key: "5b", grade: 5, letter: "Б", seats: 24 }, fiveB);
    // Постоянный код класса (стенд показа): выдан сразу — новый ученик входит по нему без «Показать код класса».
    if (this.config.AUTH_DEMO_CLASS_CODE) {
      const info = this.classIds.get("5b")!;
      const code = await this.http.expect<Schema<"JoinCode">>(
        201,
        "POST",
        `/classes/${info.id}/join-code`,
        { token: this.teacher.token },
      );
      if (!code.permanent)
        throw new Error("сид: код класса не постоянный — проверьте AUTH_DEMO_CLASS_CODE");
      this.classIds.set("5b", { ...info, joinCode: code.display });
    }
    await this.classWithKids(
      this.teacher2,
      { key: "6a", grade: 6, letter: "А", seats: of("6a").length },
      of("6a").map((k) => ({
        key: k.key,
        seat: k.seat,
        nicknameId: k.nicknameId,
        spec: k,
        skill: k.skill,
      })),
    );
    await this.demoAssignment();
    for (let w = 0; w < extraWorlds; w++) {
      const index = w + 2;
      const teacher = await this.verifiedTeacher({
        email: `teacher${index + 1}@demo.teletau.local`,
        fullName: `Учитель Проверочный ${"АБВГДЕЖ"[w]}`,
        position: "Учитель башкирского языка",
        school: 3,
      });
      const letter = "ВГДЕЖ"[w]!;
      const [kid] = await this.classWithKids(
        teacher,
        { key: `e2e-${index}`, grade: 5, letter, seats: 1 },
        [{ key: `e2e-${index}`, seat: 1, nicknameId: `a0${w + 1}.n00`, skill: 0.9 }],
      );
      this.extra.push({ index, teacher, kid: kid!, classInfo: this.classIds.get(`e2e-${index}`)! });
    }
    this.log(
      `учётные записи: 2 учителя, ${this.kids.size} учеников${extraWorlds ? `, миров для e2e: ${extraWorlds}` : ""}`,
    );

    // Республика идёт параллельно истории 5 «Б» и 6 «А»: у неё свои учётные записи, классы и группы лиги
    // (7–10, 15–17, взрослые — region.ts), поэтому порядок внутри каждой части и итог не зависят друг от друга.
    const republic = this.region().then(
      () => undefined,
      (e: unknown) => e,
    );
    const started = Date.now();
    for (const e of this.plan.events) {
      switch (e.type) {
        case "lessonDay":
          await this.lessonDay(this.kids.get(e.kid)!, e.at, e.graded);
          break;
        case "demoStudent":
          await this.demoStudentDay(e.index, e.at);
          break;
        case "leaguePoints": {
          const kid = this.kids.get(e.kid)!;
          await this.db.transaction((tx) =>
            this.competition.addLeaguePoints(tx, {
              accountId: kid.principal.accountId,
              ageGroup: "child",
              points: e.points,
              at: e.at,
            }),
          );
          break;
        }
        case "accept":
          await this.acceptDuels(e.which, e.at);
          break;
        case "extraStudent":
          await this.extraStudent(e.world, e.at);
          break;
      }
    }
    this.log(
      `история: ${this.lessonsRun} уроков, брошенных забегов ${this.abandoned}, ${((Date.now() - started) / 1000).toFixed(1)} с`,
    );
    const failed = await republic;
    if (failed) throw failed;
    await this.finalizeDuels();
    return this.summaries();
  }

  /**
   * Республика (region.ts, ADR 0023): учителя школ нескольких районов справочника — вход, заявка, одобрение
   * модератором; классы и ученики — через API, как настоящие; «Учусь сам» — POST /auth/self. Уроки — публичным
   * ProgressService.recordLessonCompletion в момент из плана (как его вызывает learning), без самих забегов: так
   * сид остаётся быстрым, а кабинет министерства, прогресс класса у учителя и квест улья видят те же числа.
   * Справочник загружен не целиком (только демо-записи) — республика пропускается.
   */
  private async region(): Promise<void> {
    const started = Date.now();
    const token = this.teacher.token;
    const districts = await this.http.expect<Schema<"DistrictList">>(200, "GET", "/districts", {
      token,
    });
    const byOktmo = new Map(districts.items.map((d) => [d.oktmo, d]));
    if (!REGION_SCHOOLS.every((x) => byOktmo.has(x.oktmo))) {
      this.log(
        "республика пропущена: в справочнике нет районов РБ (pnpm --filter @teletau/api org:import)",
      );
      return;
    }
    const kids = new Map<
      string,
      { principal: Principal; rng: Rng; skill: number; kind: "child" | "adult" }
    >();
    let n = 0;
    let classes = 0;
    for (const spec of REGION_SCHOOLS) {
      const district = byOktmo.get(spec.oktmo)!;
      const page = await this.http.expect<Schema<"SchoolPage">>(
        200,
        "GET",
        `/schools?district=${district.id}&limit=20`,
        { token },
      );
      const school = page.items[Math.min(spec.pick, page.items.length - 1)];
      if (!school) throw new Error(`сид: в районе ${district.nameRu} нет школ`);
      const t = await this.verifiedTeacher({
        ...spec.teacher,
        position: "Учитель башкирского языка",
        school,
      });
      for (const [ci, cls] of spec.classes.entries()) {
        const list = Array.from({ length: cls.seats }, (_, i) => ({
          key: regionKidKey(spec.key, ci, i + 1),
          seat: i + 1,
          nicknameId: regionNickname(n++),
          skill: 0.55 + ((n * 37) % 40) / 100,
        }));
        for (const kid of await this.classWithKids(
          t,
          { key: `${spec.key}-${ci + 1}`, grade: cls.grade, letter: cls.letter, seats: cls.seats },
          list,
        )) {
          kids.set(kid.key, {
            principal: kid.principal,
            rng: kid.rng,
            skill: kid.skill,
            kind: "child",
          });
        }
        classes++;
      }
    }
    for (const [i, spec] of REGION_SELF.entries()) {
      const s = await this.http.expect<AuthSession>(201, "POST", "/auth/self", {
        body: { device: device(), nicknameId: spec.nicknameId, ageBand: spec.ageBand },
      });
      kids.set(spec.key, {
        principal: principalOf(s.account),
        rng: mulberry32(0x5e1f + i * 977),
        skill: 0.7,
        kind: spec.ageBand === "adult" ? "adult" : "child",
      });
    }

    // Уроки — узлы тропы по порядку (кроме «Помоги языку»): у каждого ученика свой указатель.
    const nodes = (await this.learning.course(this.demoKid.principal)).units
      .flatMap((u) => u.nodes)
      .filter((x) => x.kind !== "help_language");
    const next = new Map<string, number>();
    const perDay = new Map<string, number>();
    let lessons = 0;
    for (const e of buildRegionPlan(this.plan.calendar)) {
      const kid = kids.get(e.kid)!;
      const i = next.get(e.kid) ?? 0;
      next.set(e.kid, i + 1);
      const node = nodes[i % nodes.length]!;
      const lesson = await this.lesson(node.id);
      const graded = lesson.exercises.filter((x) => x.type !== "duel");
      const first: Verdict[] = graded.map(() =>
        kid.rng() < kid.skill ? "correct" : kid.rng() < 0.5 ? "almost" : "wrong",
      );
      const dayKey = `${e.kid}:${node.id}:${ufaDate(e.at)}`;
      const completionToday = (perDay.get(dayKey) ?? 0) + 1;
      perDay.set(dayKey, completionToday);
      await this.db.transaction((tx) =>
        this.progress.recordLessonCompletion(tx, {
          accountId: kid.principal.accountId,
          accountKind: kid.kind,
          runId: uuidv7(e.at.getTime()),
          lessonId: node.id,
          kind: node.kind === "place_test" ? "place_test" : "lesson",
          firstAttempts: [
            ...first,
            ...lesson.exercises.filter((x) => x.type === "duel").map((): Verdict => "recorded"),
          ],
          accuracy: graded.length ? first.filter((v) => v !== "wrong").length / graded.length : 1,
          newWords: lesson.newWords.length,
          completionToday,
          completedAt: e.at,
        }),
      );
      lessons++;
    }
    const districtCount = new Set(REGION_SCHOOLS.map((x) => x.oktmo)).size;
    const students = [...kids.values()].length - REGION_SELF.length;
    this.republic = {
      districts: districtCount,
      schools: REGION_SCHOOLS.length,
      classes,
      students,
      selfLearners: REGION_SELF.length,
      lessons,
    };
    this.log(
      `республика: ${districtCount} районов, ${REGION_SCHOOLS.length} школ, ${classes} классов, ${students} учеников и ${REGION_SELF.length} «Учусь сам», уроков ${lessons}, ${((Date.now() - started) / 1000).toFixed(1)} с`,
    );
  }

  /**
   * Задание учителя 5 «Б» (ADR 0021): урок показа до ближайшей пятницы, выдано три дня назад. Одноклассники, прошедшие
   * урок после выдачи (история сида), — «сделали»; демо-ученик выполнит его на показе — карточка на тропе и +1 у учителя.
   */
  private async demoAssignment(): Promise<void> {
    const now = this.plan.calendar.now;
    const today = ufaDayNumber(now);
    const weekday = (today + 3) % 7; // день 0 (1970-01-01) — четверг; пн = 0
    const friday = today + ((4 - weekday + 7) % 7 || 7);
    const given = new Date(`${dayToDate(today - 3)}T04:00:00Z`); // 09:00 по Уфе
    await this.assignments.create(
      this.teacher.principal,
      this.classIds.get("5b")!.id,
      { kind: "lesson", lessonId: DEMO_LESSON, dueOn: dayToDate(friday) },
      undefined,
      given,
    );
  }

  /**
   * Роли пар. Пары показа, запасные и «поздние» (за них голосует демо-ученик) — из юнита 1. Пары других открытых юнитов
   * (до них доходят одноклассники) тоже принимаются «поздно»: на странице учителя «Помогите языку» голосование идёт
   * только у пары показа и запасных, и пара показа — первая.
   */
  private async loadDuels(): Promise<void> {
    const course = (await this.corpus.allDuels()).sort((x, y) =>
      x.externalId < y.externalId ? -1 : 1,
    );
    this.items = new Map(course.map((d) => [d.itemId, d]));
    const all = course.filter((d) => d.unitId === DEMO_UNIT);
    const otherUnits = course.filter((d) => d.unitId !== DEMO_UNIT);
    const byExt = new Map(all.map((d) => [d.externalId, d]));
    const take = (ext: string) => {
      const d = byExt.get(ext);
      if (d) byExt.delete(ext);
      return d;
    };
    const next = () => {
      const first = byExt.values().next().value as DuelItem | undefined;
      if (first) byExt.delete(first.externalId);
      return first;
    };
    const demo = take(PREFERRED.demo) ?? next();
    const spares = [take(PREFERRED.spares[0]!) ?? next(), take(PREFERRED.spares[1]!) ?? next()];
    // Голосов у демо-ученика до показа — столько, сколько дуэлей в его пяти днях (в первых двух уроках ученика дуэлей
    // нет — LESSONS_BEFORE_DUELS); кроме запасных — «поздние» пары.
    let slots = 0;
    const passed = new Set<string>();
    for (const id of DEMO_STUDENT_DAYS) {
      const l = await this.lesson(id);
      if (l.kind === "help_language") slots += l.exerciseCount;
      else if (passed.size >= LESSONS_BEFORE_DUELS)
        slots += l.exercises.filter((x) => x.type === "duel").length;
      if (l.kind !== "help_language") passed.add(id);
    }
    const lateCount = slots - 2;
    const rest = [...byExt.values()].filter((d) => !PREFERRED.early.includes(d.externalId));
    const late = rest.slice(0, lateCount);
    const early = [...byExt.values()].filter((d) => !late.includes(d));
    if (late.length === lateCount) late.push(...otherUnits);
    if (!demo || spares.some((s) => !s) || late.length < lateCount || early.length < 1) {
      throw new Error(
        `сид: в пуле юнита ${DEMO_UNIT} ${all.length} дуэлей — нужно не меньше ${slots + 2} (загрузите corpus:import)`,
      );
    }
    const truth = new Map<string, 0 | 1>(
      course.map((d, i) => [d.itemId, (i % 3 === 1 ? 1 : 0) as 0 | 1]),
    );
    this.roles = { demo, spares: spares as [DuelItem, DuelItem], early, late, truth };
  }

  private async lesson(id: string): Promise<LessonContent> {
    let l = this.lessons.get(id);
    if (!l) {
      l = await this.content.lesson(id);
      if (!l) throw new Error(`сид: нет узла ${id} в курсе (загрузите content:import)`);
      this.lessons.set(id, l);
    }
    return l;
  }

  private get reserved(): Set<string> {
    return new Set([this.roles.demo.itemId, ...this.roles.spares.map((s) => s.itemId)]);
  }

  // ── уроки ──

  /** День занятий: «Помоги языку», если узел открыт и в нём есть пары, затем `graded` уроков (текущий или повтор). */
  private async lessonDay(kid: DemoKid, at: Date, graded: number): Promise<void> {
    let t = at;
    const trail = await this.learning.course(kid.principal);
    const nodes = trail.units.flatMap((u) => u.nodes);
    const help = nodes.find((n) => n.kind === "help_language" && n.state === "open");
    if (help && !kid.helpEmpty) {
      const r = await this.runLesson(kid, help.id, t);
      if (r) t = plus(r.end, randInt(kid.rng, 2, 8) * 60_000);
    }
    const today = new Set<string>();
    for (let i = 0; i < graded; i++) {
      const fresh = (await this.learning.course(kid.principal)).units.flatMap((u) => u.nodes);
      const current = fresh.find((n) => n.state === "current" && !today.has(n.id));
      const done = fresh.filter(
        (n) => n.state === "done" && n.kind !== "help_language" && !today.has(n.id),
      );
      const node = current ?? done[Math.floor(kid.rng() * done.length)];
      if (!node) break;
      today.add(node.id);
      const r = await this.runLesson(kid, node.id, t);
      if (r) t = plus(r.end, randInt(kid.rng, 2, 10) * 60_000);
    }
  }

  /**
   * Забег урока от начала до итога: ответы по умению ученика (неверные — повторяются в конце, как в вебе), голоса
   * в дуэлях. `accept` — какие пары дуэлей годятся (иначе забег брошен, как «Уже уходишь?», и начат новый).
   * Пустой забег «Помоги языку» (пары кончились) не завершается — веб показывает «Все пары уже оценены».
   */
  private async runLesson(
    kid: DemoKid,
    lessonId: string,
    start: Date,
    opts: {
      accept?: (itemIds: string[]) => boolean;
      choose?: (view: DuelExercise) => DuelChoice;
      tries?: number;
    } = {},
  ): Promise<{ end: Date; summary: Schema<"LessonRunSummary"> } | undefined> {
    const lesson = await this.lesson(lessonId);
    let at = start;
    for (let attempt = 0; attempt < (opts.tries ?? 1); attempt++, at = plus(at, 60_000)) {
      const run = await this.learning.startRun(
        kid.principal,
        lessonId,
        { runId: uuidv7(at.getTime()) },
        at,
      );
      if (run.exercises.length === 0) {
        if (lesson.kind === "help_language") kid.helpEmpty = true;
        return undefined;
      }
      const duelIds = run.exercises.filter(isDuel).map((e) => e.itemId);
      if (opts.accept && !opts.accept(duelIds)) {
        this.abandoned++;
        continue;
      }
      let t = at;
      const retry: RunExercise[] = [];
      const attemptAt = () => (t = plus(t, randInt(kid.rng, 9, 32) * 1000));
      for (const ex of run.exercises) {
        // «Новое слово» — без ответа: ученик посмотрел и пошёл дальше (сид не просит карточек, но и не падает на них).
        if (ex.type === "word_intro") continue;
        const when = attemptAt();
        if (isDuel(ex)) {
          const choice = opts.choose ? opts.choose(ex) : this.kidChoice(kid, ex);
          await this.learning.submitAttempt(
            kid.principal,
            run.runId,
            {
              attemptId: uuidv7(when.getTime()),
              exerciseId: ex.id,
              answer: { type: "duel", choice },
            },
            when,
          );
          this.noteVote(kid, ex.itemId, ex, choice);
          continue;
        }
        const right = kid.rng() < kid.skill;
        const answer = right
          ? correctAnswer(ex, lesson)
          : mistakenAnswer(ex, lesson, kid.rng() < 0.5 ? "almost" : "wrong");
        const res = await this.learning.submitAttempt(
          kid.principal,
          run.runId,
          {
            attemptId: uuidv7(when.getTime()),
            exerciseId: ex.id,
            answer,
            latencyMs: randInt(kid.rng, 3000, 15000),
          },
          when,
        );
        if (res.verdict === "wrong") retry.push(ex);
      }
      for (const ex of retry) {
        const when = attemptAt();
        await this.learning.submitAttempt(
          kid.principal,
          run.runId,
          {
            attemptId: uuidv7(when.getTime()),
            exerciseId: ex.id,
            answer: correctAnswer(ex, lesson),
          },
          when,
        );
      }
      const end = attemptAt();
      const summary = await this.learning.complete(kid.principal, run.runId, end);
      this.lessonsRun++;
      return { end, summary };
    }
    throw new Error(
      `сид: ${kid.key} — за ${opts.tries ?? 1} попыток в уроке ${lessonId} не выпала нужная пара`,
    );
  }

  /** Голос ребёнка: пары показа и запасные — по балансу (поровну за оба варианта), остальные — чаще за «верный». */
  private kidChoice(kid: DemoKid, view: DuelExercise): DuelChoice {
    const item = this.items.get(view.itemId)!;
    if (this.reserved.has(item.itemId))
      return this.toShown(view, (this.balance.get(item.itemId) ?? 0) <= 0 ? 0 : 1);
    const truth = this.roles.truth.get(item.itemId) ?? 0;
    const r = kid.rng();
    if (r < 0.74) return this.toShown(view, truth);
    if (r < 0.92) return this.toShown(view, truth === 0 ? 1 : 0);
    return r < 0.97 ? "both" : "skip";
  }

  /** Сторона показа (a/b) для варианта в каноническом порядке исходника. */
  private toShown(view: DuelExercise, canon: 0 | 1): DuelChoice {
    const item = this.items.get(view.itemId)!;
    const aIsFirst = view.a === item.variants[0].text;
    return (canon === 0) === aIsFirst ? "a" : "b";
  }

  private noteVote(kid: DemoKid, itemId: string, view: DuelExercise, choice: DuelChoice): void {
    kid.voted.add(itemId);
    if (!this.reserved.has(itemId) || choice === "both" || choice === "skip") return;
    const item = this.items.get(itemId)!;
    const shownText = choice === "a" ? view.a : view.b;
    const delta = shownText === item.variants[0].text ? 1 : -1;
    this.balance.set(itemId, (this.balance.get(itemId) ?? 0) + delta);
  }

  /** День истории демо-ученика: без пары показа (она — для урока на показе), остальные пары — по одной. */
  private async demoStudentDay(index: number, at: Date): Promise<void> {
    const kid = this.demoKid;
    const lessonId = DEMO_STUDENT_DAYS[index]!;
    const demoItem = this.roles.demo.itemId;
    await this.runLesson(kid, lessonId, at, {
      tries: 40,
      accept: (ids) => !ids.includes(demoItem),
      choose: (view) =>
        this.reserved.has(view.itemId)
          ? this.kidChoice(kid, view)
          : this.toShown(view, this.roles.truth.get(view.itemId) ?? 0),
    });
  }

  private get demoKid(): DemoKid {
    return this.kids.get(`5b-${String(DEMO_STUDENT_SEAT).padStart(2, "0")}`)!;
  }

  /**
   * Ученик мира e2e: два урока (в первых двух уроках дуэлей нет — LESSONS_BEFORE_DUELS), затем их повторы, где в дуэлях —
   * «Не знаю» за все пары показа, кроме своей; своя остаётся единственной.
   */
  private async extraStudent(world: number, at: Date): Promise<void> {
    const w = this.extra.find((x) => x.index === world)!;
    const mine = this.worldDuel(world).itemId;
    const others = [...this.reserved].filter((id) => id !== mine);
    let t = at;
    for (const lessonId of ["u01-privet", "u01-kak-tebya-zovut"]) {
      const r = await this.runLesson(w.kid, lessonId, t);
      t = plus(r!.end, 4 * 60_000);
    }
    for (const lessonId of ["u01-privet", "u01-kak-tebya-zovut"].slice(0, others.length)) {
      const r = await this.runLesson(w.kid, lessonId, t, {
        tries: 40,
        accept: (ids) =>
          ids.length > 0 && ids.every((id) => others.includes(id) && !w.kid.voted.has(id)),
        choose: () => "skip",
      });
      t = plus(r!.end, 4 * 60_000);
    }
  }

  /** Пара мира: 1 — показа, 2 и 3 — запасные. */
  private worldDuel(index: number): DuelItem {
    return index === 1 ? this.roles.demo : this.roles.spares[index - 2]!;
  }

  // ── дуэли: учитель другой школы и взрослые ──

  /** Голос взрослого или учителя вне урока (как POST /corpus/judgments) в момент `at`. */
  private async adultVote(
    voter: Principal,
    item: DuelItem,
    pick: 0 | 1 | "both",
    at: Date,
  ): Promise<void> {
    const swap = randomInt(2) === 1;
    const shown: [string, string] = swap
      ? [item.variants[1].id, item.variants[0].id]
      : [item.variants[0].id, item.variants[1].id];
    const choice: DuelChoice =
      pick === "both" ? "both" : shown[0] === item.variants[pick].id ? "a" : "b";
    const v: Voter = { accountId: voter.accountId, kind: voter.kind, roles: voter.roles };
    await this.db.transaction((tx) =>
      this.consensus.recordVote(tx, {
        judgmentId: uuidv7(at.getTime()),
        voter: v,
        itemId: item.itemId,
        shown,
        choice,
        context: "corpus",
        at,
      }),
    );
  }

  /** Учитель второй школы и двое взрослых за «верный» вариант; не принято (дети против) — ещё взрослые. */
  private async acceptDuels(which: "early" | "late", at: Date): Promise<void> {
    const list = which === "early" ? this.roles.early : this.roles.late;
    let t = at;
    for (const item of list) {
      const truth = this.roles.truth.get(item.itemId) ?? 0;
      await this.adultVote(this.teacher2.principal, item, truth, (t = plus(t, 40_000)));
      for (let i = 0; i < 6; i++) {
        if (i >= 2 && (await this.consensus.recompute(item.itemId))?.outcome.status === "accepted")
          break;
        const a = await this.adult(i);
        await this.adultVote(a.principal, item, truth, (t = plus(t, 40_000)));
        a.voted.add(item.itemId);
      }
      const state = await this.consensus.recompute(item.itemId);
      if (state?.outcome.status !== "accepted")
        throw new Error(`сид: пара ${item.externalId} не принята (${state?.outcome.status})`);
    }
  }

  /**
   * Перед показом (последние полчаса до запуска): поровну голосов детей за оба варианта у пар показа и запасных,
   * двое взрослых с «Оба подходят» у пары показа и порядок на странице учителя: пара показа — первая (больше всего
   * голосов), запасные — за ней по порядку миров e2e. Взрослые здесь голосуют только «Оба подходят»: голос взрослого
   * за вариант весит 2 и при равенстве голосов детей сразу дал бы «Принят» (решение v0 закрепляется).
   */
  private async finalizeDuels(): Promise<void> {
    let t = new Date(this.plan.calendar.now.getTime() - 30 * 60_000);
    for (const item of [this.roles.demo, ...this.roles.spares]) {
      const bal = this.balance.get(item.itemId) ?? 0;
      if (bal === 0) continue;
      const side: 0 | 1 = bal > 0 ? 1 : 0;
      await this.childVote(item, side, t);
      t = plus(t, 3 * 60_000);
    }
    t = new Date(this.plan.calendar.now.getTime() - 12 * 60_000);
    for (let i = 0; i < 2; i++) await this.adultBoth(this.roles.demo, (t = plus(t, 30_000)));
    const order = async () => {
      const totals = new Map<string, number>();
      for (const item of [this.roles.demo, ...this.roles.spares]) {
        const tally = await this.consensus.recompute(item.itemId);
        totals.set(
          item.itemId,
          Object.values(tally?.votesByGroup ?? {}).reduce((n, g) => n + g.total, 0),
        );
      }
      // Как ConsensusService.listDuels: больше голосов — выше, при равенстве — по внешнему id.
      const before = (x: DuelItem, y: DuelItem) =>
        totals.get(x.itemId)! > totals.get(y.itemId)! ||
        (totals.get(x.itemId) === totals.get(y.itemId) && x.externalId < y.externalId);
      return { before };
    };
    for (
      let i = 0;
      i < 30 && !(await order()).before(this.roles.spares[0], this.roles.spares[1]);
      i++
    )
      await this.adultBoth(this.roles.spares[0], (t = plus(t, 30_000)));
    for (let i = 0; i < 30 && !(await order()).before(this.roles.demo, this.roles.spares[0]); i++)
      await this.adultBoth(this.roles.demo, (t = plus(t, 30_000)));
  }

  /**
   * Голос ребёнка за `side` в паре `item` (выравнивание перед показом): урок с одной дуэлью у ученика, ещё не голосовавшего
   * за пару и прошедшего хотя бы LESSONS_BEFORE_DUELS уроков (раньше дуэлей в уроке нет; ученики без истории не подходят).
   * Сначала — ученики 6 «А», затем занимавшиеся на этой неделе в 5 «Б» (участие класса на показе не меняется).
   */
  private async childVote(item: DuelItem, side: 0 | 1, at: Date): Promise<void> {
    const rank = (k: DemoKid) =>
      k.spec!.classKey === "6a" ? (k.spec!.cohort === "idle" ? 0 : 1) : 2;
    const extraKeys = new Set(this.extra.map((w) => w.kid.key));
    const candidates = [...this.kids.values()]
      .filter(
        (k) =>
          k.spec &&
          (k.spec.classKey === "6a" || k.spec.activeNow) &&
          k !== this.demoKid &&
          !extraKeys.has(k.key) &&
          !k.voted.has(item.itemId),
      )
      .sort((x, y) => rank(x) - rank(y));
    for (const kid of candidates) {
      const nodes = (await this.learning.course(kid.principal)).units.flatMap((u) => u.nodes);
      // В первых двух уроках ученика дуэлей нет (LESSONS_BEFORE_DUELS): такой ученик голос в уроке не отдаст.
      const passed = nodes.filter((n) => n.kind !== "help_language" && (n.completions ?? 0) > 0).length;
      if (passed < LESSONS_BEFORE_DUELS) continue;
      const withDuel: string[] = [];
      for (const n of nodes) {
        if (n.kind !== "lesson" || (n.state !== "done" && n.state !== "current")) continue;
        if ((await this.lesson(n.id)).exercises.some((e) => e.type === "duel")) withDuel.push(n.id);
      }
      for (const lessonId of withDuel) {
        try {
          await this.runLesson(kid, lessonId, at, {
            tries: 15,
            accept: (ids) => ids.length === 1 && ids[0] === item.itemId,
            choose: (view) => this.toShown(view, side),
          });
          return;
        } catch {
          // в этом уроке пара не выпала — следующий урок или ученик
        }
      }
    }
    throw new Error(`сид: не нашлось ученика для голоса в паре ${item.externalId}`);
  }

  /** Взрослый, ещё не голосовавший за пару, — «Оба подходят»: голосов больше, перевеса и большинства взрослых нет. */
  private async adultBoth(item: DuelItem, at: Date): Promise<void> {
    for (let i = 0; i < 40; i++) {
      const a = await this.adult(i);
      if (a.voted.has(item.itemId)) continue;
      await this.adultVote(a.principal, item, "both", at);
      a.voted.add(item.itemId);
      return;
    }
    throw new Error(`сид: не хватило взрослых для пары ${item.externalId}`);
  }

  // ── проверка и итог ──

  /** Голоса пары с голосом ученика `s` и учителя `t` по duel-v0 — «Принят» при любых выборах? */
  private async acceptsAnyTeacherVote(item: DuelItem): Promise<boolean> {
    const tally = await this.consensus.recompute(item.itemId);
    if (!tally || tally.outcome.status !== "voting" || tally.votesByGroup.teacher.total > 0)
      return false;
    const base: DuelVote[] = tally.votes.map((v) => ({
      voter: v.accountId,
      group: v.group,
      choice: v.choice,
    }));
    for (const s of ["a", "b", "both", "skip"] as const) {
      for (const t of ["a", "b"] as const) {
        const out = duelV0({
          votes: [
            ...base,
            { voter: "student", group: "child", choice: s },
            { voter: "teacher", group: "teacher", choice: t },
          ],
        });
        if (out.status !== "accepted" || out.main !== t) return false;
      }
    }
    return true;
  }

  private async summaries(): Promise<WorldSummary[]> {
    const now = this.plan.calendar.now;
    const lesson = await this.lesson(DEMO_LESSON);
    const answers = answerSheet(lesson);
    const out: WorldSummary[] = [];
    const worlds = [
      { index: 1, teacher: this.teacher, kid: this.demoKid, classInfo: this.classIds.get("5b")! },
      ...this.extra.map((w) => ({
        index: w.index,
        teacher: w.teacher,
        kid: w.kid,
        classInfo: w.classInfo,
      })),
    ];
    for (const w of worlds) {
      const duel = this.worldDuel(w.index);
      const voter: Voter = {
        accountId: w.kid.principal.accountId,
        kind: "child",
        roles: w.kid.principal.roles,
      };
      const trail = await this.learning.course(w.kid.principal);
      const current = trail.units.flatMap((u) => u.nodes).find((n) => n.state === "current");
      const progress = await this.progress.myProgress(w.kid.principal, now);
      const picks = await this.consensus.pickDuels(voter, DEMO_UNIT, 1);
      const problems: string[] = [];
      if (current?.id !== DEMO_LESSON)
        problems.push(`текущий узел ${current?.id ?? "—"} вместо ${DEMO_LESSON}`);
      if (progress.streak.extendedToday) problems.push("ученик уже занимался сегодня");
      if (picks[0]?.itemId !== duel.itemId)
        problems.push(`сервер выберет пару ${picks[0]?.itemId ?? "—"} вместо ${duel.externalId}`);
      if (!(await this.acceptsAnyTeacherVote(duel)))
        problems.push(
          `голос учителя не даст «Принят» в паре ${duel.externalId}: ${JSON.stringify((await this.consensus.recompute(duel.itemId))?.outcome)}`,
        );
      const first = await this.consensus.listDuels(w.teacher.principal, 3);
      if (w.index === 1 && first.items[0]?.itemId !== duel.itemId)
        problems.push(`у учителя первой будет пара ${first.items[0]?.sourceRu ?? "—"}`);
      let leagueUp: LeagueTier | null = null;
      if (w.index === 1) {
        if (progress.streak.current !== 5 || progress.streak.freezes !== 2)
          problems.push(
            `серия ${progress.streak.current}, заморозок ${progress.streak.freezes} (ждали 5 и 2)`,
          );
        const result = await this.competition.unseenResult(w.kid.principal.accountId, now);
        if (result?.outcome !== "promoted" || result.tierAfter !== "fireweed")
          problems.push(`итог лиги прошлой недели: ${JSON.stringify(result ?? null)}`);
        leagueUp = result?.outcome === "promoted" ? result.tierAfter : null;
      }
      if (problems.length)
        throw new Error(`сид: мир ${w.index} не готов к показу:\n  ${problems.join("\n  ")}`);
      const hive = await this.competition.classHive(w.teacher.principal, w.classInfo.id, now);
      const tasks =
        w.index === 1
          ? await this.assignments.list(w.teacher.principal, w.classInfo.id, now)
          : undefined;
      const task = tasks?.active[0];
      if (w.index === 1 && (!task || task.lessonId !== DEMO_LESSON || task.dueOn < ufaDate(now)))
        problems.push(`нет активного задания «${lesson.titleRu}»`);
      if (w.index === 1 && task?.seats.find((s) => s.seatNumber === w.kid.seat)?.status !== "todo")
        problems.push("демо-ученик уже выполнил задание");
      if (problems.length)
        throw new Error(`сид: мир ${w.index} не готов к показу:\n  ${problems.join("\n  ")}`);
      const active =
        hive.participation.active + (progress.streak.week.some((d) => d.status === "done") ? 0 : 1);
      out.push({
        index: w.index,
        teacher: { email: w.teacher.email, fullName: w.teacher.fullName, code: this.code },
        class: {
          id: w.classInfo.id,
          title: w.classInfo.title,
          school: w.classInfo.school,
          seats: w.classInfo.seats,
          ...(w.classInfo.joinCode ? { joinCode: w.classInfo.joinCode } : {}),
        },
        student: { seat: w.kid.seat, nickname: w.kid.nickname, card: w.kid.card },
        lesson: { id: lesson.id, titleRu: lesson.titleRu, answers },
        duel: {
          itemId: duel.itemId,
          externalId: duel.externalId,
          sourceRu: duel.sourceRu,
          variants: [duel.variants[0].text, duel.variants[1].text],
        },
        expect: {
          streakBefore: progress.streak.current,
          freezes: progress.streak.freezes,
          lessonsBefore: progress.lessonsCompleted,
          leagueUp,
          activeAfter: active,
          seatsTotal: hive.participation.total,
        },
        ...(task
          ? {
              assignment: {
                titleRu: task.titleRu,
                dueOn: task.dueOn,
                done: task.summary.done + task.summary.late,
                total: task.summary.total,
              },
            }
          : {}),
        ...(w.index === 1 && this.republic ? { republic: this.republic } : {}),
      });
    }
    return out;
  }
}

/** Мир уже есть — сид не дописывает его (голоса неизменяемы, правило 9): полный сброс — `pnpm demo:reset`. */
export class DemoWorldExists extends Error {}
