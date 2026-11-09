import { Controller, Get, Res } from "@nestjs/common";
import type { Health } from "@teletau/contracts";
import type { FastifyReply } from "fastify";
import { Operation } from "../../common/contract.js";
import { HealthService } from "./health.service.js";

/** Реализует operationId getHealth из packages/contracts/openapi.yaml. */
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @Operation("getHealth")
  async getHealth(@Res({ passthrough: true }) reply: FastifyReply): Promise<Health> {
    const result = await this.health.check();
    reply.status(result.status === "ok" ? 200 : 503);
    return result;
  }
}
