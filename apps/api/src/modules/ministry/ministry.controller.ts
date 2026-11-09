import { Controller, Get, Param } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { Operation } from "../../common/contract.js";
import { MinistryService } from "./ministry.service.js";

/** Кабинет министерства (ADR 0023): только агрегаты, только для роли ministry (x-access в контракте). */
@Controller("ministry")
export class MinistryController {
  constructor(private readonly ministry: MinistryService) {}

  @Get("summary")
  @Operation("getRepublicSummary")
  summary(): Promise<Schema<"RepublicSummary">> {
    return this.ministry.summary();
  }

  @Get("districts")
  @Operation("listRepublicDistricts")
  districts(): Promise<Schema<"RepublicDistrictList">> {
    return this.ministry.districts();
  }

  @Get("districts/:districtId")
  @Operation("getRepublicDistrict")
  district(@Param("districtId") districtId: string): Promise<Schema<"RepublicDistrictDetail">> {
    return this.ministry.district(districtId);
  }
}
