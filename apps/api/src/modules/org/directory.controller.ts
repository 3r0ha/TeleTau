import { Controller, Get, Query } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { Operation, type OperationQuery } from "../../common/contract.js";
import { DirectoryService } from "./directory.service.js";

/** Справочник районов и школ РБ — любому вошедшему (учитель выбирает школу в заявке). */
@Controller()
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Get("districts")
  @Operation("listDistricts")
  districts(): Promise<Schema<"DistrictList">> {
    return this.directory.listDistricts();
  }

  @Get("schools")
  @Operation("listSchools")
  schools(@Query() query: OperationQuery<"listSchools", "limit">): Promise<Schema<"SchoolPage">> {
    return this.directory.searchSchools(query);
  }
}
