// Состав республики для кабинета министерства (ADR 0023): районы, школы с действующими классами и ученики на местах.
// Наружу модуля org уходят только идентификаторы аккаунтов (для подсчётов в модуле ministry), без номеров мест и ников;
// в ответы API идентификаторы не попадают — там только числа.
import { Inject, Injectable } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../../db/database.js";
import { DB } from "../../infra/tokens.js";
import { classes, classSeats, districts, schools } from "./org.schema.js";

export interface RosterDistrict {
  id: string;
  nameRu: string;
  kind: Schema<"DistrictKind">;
  isDemo: boolean;
  /** Школ в справочнике (у демо-района — демо-школы, у остальных — без демо-записей). */
  schoolsTotal: number;
}

export interface RosterSchool {
  id: string;
  districtId: string;
  shortNameRu: string;
  isDemo: boolean;
  /** Действующих классов. */
  classes: number;
  /** Ученики на местах действующих классов (без повторов). */
  studentIds: string[];
}

export interface Roster {
  districts: RosterDistrict[];
  /** Только подключённые школы — с хотя бы одним действующим классом. */
  schools: RosterSchool[];
}

@Injectable()
export class RosterService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Районы справочника и подключённые школы; `districtId` — только один район. */
  async roster(districtId?: string): Promise<Roster> {
    const byDistrict = districtId ? eq(districts.id, districtId) : undefined;
    const [districtRows, classRows, seatRows] = await Promise.all([
      this.db
        .select({
          id: districts.id,
          nameRu: districts.nameRu,
          kind: districts.kind,
          isDemo: districts.isDemo,
          schoolsTotal: sql<number>`count(${schools.id}) FILTER (WHERE ${schools.isDemo} = ${districts.isDemo})::int`,
        })
        .from(districts)
        .leftJoin(schools, eq(schools.districtId, districts.id))
        .where(byDistrict)
        .groupBy(districts.id)
        .orderBy(asc(districts.nameRu)),
      this.db
        .select({ schoolId: schools.id, districtId: schools.districtId, shortNameRu: schools.shortNameRu, isDemo: schools.isDemo, classes: sql<number>`count(*)::int` })
        .from(classes)
        .innerJoin(schools, eq(schools.id, classes.schoolId))
        .where(and(eq(classes.status, "active"), districtId ? eq(schools.districtId, districtId) : undefined))
        .groupBy(schools.id),
      this.db
        .selectDistinct({ schoolId: classes.schoolId, accountId: classSeats.accountId })
        .from(classSeats)
        .innerJoin(classes, eq(classes.id, classSeats.classId))
        .innerJoin(schools, eq(schools.id, classes.schoolId))
        .where(and(eq(classes.status, "active"), isNotNull(classSeats.accountId), districtId ? eq(schools.districtId, districtId) : undefined)),
    ]);
    const students = new Map<string, string[]>();
    for (const r of seatRows) if (r.accountId) students.set(r.schoolId, [...(students.get(r.schoolId) ?? []), r.accountId]);
    return {
      districts: districtRows.map((d) => ({ id: d.id, nameRu: d.nameRu, kind: d.kind, isDemo: d.isDemo, schoolsTotal: d.schoolsTotal })),
      schools: classRows
        .map((s) => ({ id: s.schoolId, districtId: s.districtId, shortNameRu: s.shortNameRu, isDemo: s.isDemo, classes: s.classes, studentIds: students.get(s.schoolId) ?? [] }))
        .sort((x, y) => x.shortNameRu.localeCompare(y.shortNameRu, "ru")),
    };
  }

  /** Есть ли такой район в справочнике. */
  async districtExists(districtId: string): Promise<boolean> {
    const [row] = await this.db.select({ id: districts.id }).from(districts).where(eq(districts.id, districtId)).limit(1);
    return Boolean(row);
  }
}
