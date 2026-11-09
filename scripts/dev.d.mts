// Типы для импорта scripts/dev.mjs из TypeScript (e2e/support/env.ts).
export function parseEnvFile(text: string): Record<string, string>;
export function mergeEnv(processEnv: NodeJS.ProcessEnv, envFileText: string): Record<string, string | undefined>;
export function mentionedKeys(text: string): Set<string>;
export function layeredEnv(
  processEnv: NodeJS.ProcessEnv,
  envFileText: string,
  exampleText: string,
): { env: Record<string, string | undefined>; missing: string[] };
export function loadDevEnv(root: string, log?: (msg: string) => void): Record<string, string | undefined>;
export function describeServices(env: Record<string, string | undefined>): string;
export const APP_PORTS: ReadonlyArray<{ app: string; key: string; fallback: number }>;
export function findBusyPorts(env: Record<string, string | undefined>): Promise<Array<{ app: string; key: string; port: number }>>;
export function turboArgs(busy: Array<{ app: string }>): string[];
