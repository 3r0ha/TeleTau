import { describe, expect, it } from "vitest";
import { BULLMQ_MAX_BLOCK_MS, MIN_WORKER_SOCKET_TIMEOUT_MS, loadConfig } from "../src/config.js";
import { processSystemJob } from "../src/jobs/system.js";
import { createSystemQueue } from "../src/system-queue.js";

describe("system queue", () => {
  it("answers ping with pong", async () => {
    await expect(processSystemJob({ name: "ping", data: {} })).resolves.toMatchObject({ pong: true });
  });

  it("rejects unknown jobs loudly", async () => {
    await expect(processSystemJob({ name: "drop-tables", data: {} })).rejects.toThrow(/Неизвестная задача/);
  });

  it("keeps password, db and TLS from VALKEY_URL (M0-06)", () => {
    expect(loadConfig({ VALKEY_URL: "rediss://default:s3cret@valkey.prod.internal:6380/2" }).connection).toEqual({
      host: "valkey.prod.internal",
      port: 6380,
      username: "default",
      password: "s3cret",
      db: 2,
      tls: {},
    });
    expect(loadConfig({}).connection).toMatchObject({ host: "localhost", port: 16379, db: 0 });
  });

  it("attaches error handlers to the worker and the queue (M0-12)", async () => {
    const reported: string[] = [];
    // Заведомо закрытый порт: клиенты сыплют ECONNREFUSED, и без обработчиков это необработанные события.
    const { worker, queue } = createSystemQueue({ host: "127.0.0.1", port: 1, db: 0 }, (source) => reported.push(source), {
      autorun: false,
    });
    expect(worker.listenerCount("error")).toBeGreaterThan(0);
    expect(queue.listenerCount("error")).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 300));
    await Promise.allSettled([worker.close(true), queue.close()]);
  });
});

describe("timeouts policy for BullMQ connections (M0-R2-02)", () => {
  it("passes a socket timeout above the blocking-command window to worker and queue", async () => {
    const config = loadConfig({});
    expect(config.socketTimeoutMs).toBeGreaterThan(BULLMQ_MAX_BLOCK_MS); // окно блокировки при отложенных задачах — 10 с
    const { worker, queue } = createSystemQueue(
      { ...config.connection, host: "127.0.0.1", port: 1 },
      () => undefined,
      { autorun: false },
      config.socketTimeoutMs,
    );
    expect((worker.opts.connection as { socketTimeout?: number }).socketTimeout).toBe(config.socketTimeoutMs);
    expect((queue.opts.connection as { socketTimeout?: number }).socketTimeout).toBe(config.socketTimeoutMs);
    await Promise.allSettled([worker.close(true), queue.close()]);
  });

  it("rejects a socket timeout inside BullMQ's blocking window, accepts 12 s and more (M0-R3-02)", () => {
    // BullMQ блокируется до maximumBlockTimeout (10 с), если есть отложенные задачи; сокет не должен рваться раньше.
    expect(MIN_WORKER_SOCKET_TIMEOUT_MS).toBeGreaterThan(BULLMQ_MAX_BLOCK_MS);
    for (const v of ["6000", "10000", String(MIN_WORKER_SOCKET_TIMEOUT_MS - 1)]) {
      expect(() => loadConfig({ VALKEY_WORKER_SOCKET_TIMEOUT_MS: v }), v).toThrow(/VALKEY_WORKER_SOCKET_TIMEOUT_MS/);
    }
    expect(loadConfig({ VALKEY_WORKER_SOCKET_TIMEOUT_MS: String(MIN_WORKER_SOCKET_TIMEOUT_MS) }).socketTimeoutMs).toBe(12_000);
  });

  it("reads IPv6 VALKEY_URL through the shared parser (M0-R2-05)", () => {
    expect(loadConfig({ VALKEY_URL: "redis://[::1]:16379" }).connection).toMatchObject({ host: "::1", family: 6 });
  });
});
