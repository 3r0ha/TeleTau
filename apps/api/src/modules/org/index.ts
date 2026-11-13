// Публичный интерфейс модуля org: другие модули импортируют только отсюда (apps/api/scripts/boundaries.mjs).
// Схема (org.schema.ts) отсюда не экспортируется — таблицы не выходят за пределы модуля (ADR 0014).
export { OrgModule } from "./org.module.js";
export { ClassesService, classTitle, type CardCheck, type SeatAdmission } from "./classes.service.js";
export type { PrintJobCard } from "./print-jobs.js";
// Политики class-teacher и class-member для модулей progress и competition: чужой класс — 403, нет класса — 404.
export { ClassPolicy, type ClassRow } from "./class-policy.js";
export { DirectoryService, type SchoolRef } from "./directory.service.js";
export { JoinGrants } from "./join-grants.js";
// Состав республики для кабинета министерства (ADR 0023) и доски почёта (ТЗ §4.5): только подсчёты, без мест и ников.
export { RosterService, type Roster, type RosterClass, type RosterDistrict, type RosterSchool } from "./roster.service.js";
export { JoinService, POLL_INTERVAL_SECONDS, type JoinDevice, type JoinPoll } from "./join.service.js";
