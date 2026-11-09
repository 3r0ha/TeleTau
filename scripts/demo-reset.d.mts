// Типы для импорта scripts/demo-reset.mjs из TypeScript (e2e/support/env.ts).
export const E2E_DATABASE_SUFFIX: string;
export function e2eDatabaseUrl(devUrl: string): string;
export function e2eValkeyUrl(devUrl: string): string;
export function e2eEnv<T extends Record<string, string | undefined>>(devEnv: T): T & { DATABASE_URL: string; VALKEY_URL: string };
export class DatabaseBusyError extends Error {}
export function rebuildDemoDatabase(options: {
  env: Record<string, string | undefined>;
  force?: boolean;
  seedArgs?: string[];
  log?: (msg: string) => void;
}): void;
