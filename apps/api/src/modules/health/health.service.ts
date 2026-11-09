import { Inject, Injectable } from "@nestjs/common";
import type { CheckStatus, Health } from "@teletau/contracts";
import type { ErrorReporter } from "@teletau/runtime";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { INFRA_REPORTER, PG_POOL, VALKEY, type KvPinger, type SqlPinger } from "../../infra/tokens.js";

export const SERVICE_VERSION = "0.1.0";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(PG_POOL) private readonly pg: SqlPinger,
    @Inject(VALKEY) private readonly valkey: KvPinger,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(INFRA_REPORTER) private readonly report: ErrorReporter,
  ) {}

  async check(): Promise<Health> {
    const timeout = this.config.HEALTH_TIMEOUT_MS;
    // Причина `down` пишется в лог через общий репортёр (не чаще раза в 30 с на источник и код ошибки):
    // иначе при разрыве с Postgres оператор видит только 503.
    const probe = async (source: string, fn: () => Promise<unknown>): Promise<CheckStatus> => {
      try {
        await withTimeout(fn(), timeout);
        return "ok";
      } catch (err) {
        this.report(source, err);
        return "down";
      }
    };
    const [postgres, valkey] = await Promise.all([
      // Собственный короткий таймаут на запрос: зависший после «тихого» разрыва клиент получает ошибку,
      // пул его уничтожает, и после восстановления сети health быстро возвращается к 200.
      probe("health/postgres", () => this.pg.query({ text: "SELECT 1", query_timeout: timeout })),
      probe("health/valkey", () => this.valkey.ping()),
    ]);
    const status: CheckStatus = postgres === "ok" && valkey === "ok" ? "ok" : "down";
    return { status, service: "api", version: SERVICE_VERSION, checks: { postgres, valkey } };
  }
}
