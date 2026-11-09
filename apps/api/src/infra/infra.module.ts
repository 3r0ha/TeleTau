import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { Redis } from "ioredis";
import type pg from "pg";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { createDb } from "../db/database.js";
import { createPgPool, createValkey, reportInfraError } from "./clients.js";
import { IdempotencyStore } from "./idempotency.js";
import { RateLimiter } from "./rate-limiter.js";
import { DB, INFRA_REPORTER, PG_POOL, VALKEY } from "./tokens.js";

@Global()
@Module({
  providers: [
    { provide: PG_POOL, inject: [APP_CONFIG], useFactory: (config: AppConfig) => createPgPool(config) },
    { provide: VALKEY, inject: [APP_CONFIG], useFactory: (config: AppConfig) => createValkey(config) },
    { provide: DB, inject: [PG_POOL], useFactory: (pool: pg.Pool) => createDb(pool) },
    { provide: INFRA_REPORTER, useValue: reportInfraError },
    RateLimiter,
    IdempotencyStore,
  ],
  exports: [PG_POOL, VALKEY, DB, INFRA_REPORTER, RateLimiter, IdempotencyStore],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(VALKEY) private readonly valkey: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.pool.end(), this.valkey.quit()]);
  }
}
