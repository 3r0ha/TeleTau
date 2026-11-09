import type { KvPinger, SqlPinger } from "../src/infra/tokens.js";

export const okSql: SqlPinger = { query: async () => ({ rows: [{ "?column?": 1 }] }) };
export const failingSql: SqlPinger = {
  query: async () => {
    throw new Error("connection refused");
  },
};
export const hangingSql: SqlPinger = { query: () => new Promise(() => undefined) };
export const okKv: KvPinger = { ping: async () => "PONG" };
export const failingKv: KvPinger = {
  ping: async () => {
    throw new Error("connection refused");
  },
};
