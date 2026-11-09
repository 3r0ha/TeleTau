import type { ErrorReporter, ValkeyConnection } from "@teletau/runtime";
import { Queue, Worker, type WorkerOptions } from "bullmq";
import { SYSTEM_QUEUE, processSystemJob } from "./jobs/system.js";

/**
 * Служебная очередь и её воркер. Обработчики `error` обязательны: без них при недоступном Valkey
 * клиенты BullMQ пишут трассировку на каждую попытку переподключения.
 * socketTimeout (без commandTimeout — он оборвал бы блокирующие команды BullMQ) защищает от «тихих» разрывов.
 */
export function createSystemQueue(
  connection: ValkeyConnection,
  report: ErrorReporter,
  workerOptions: Partial<WorkerOptions> = {},
  socketTimeoutMs = 15_000,
): { worker: Worker; queue: Queue } {
  const conn = { ...connection, socketTimeout: socketTimeoutMs };
  const worker = new Worker(SYSTEM_QUEUE, (job) => processSystemJob({ name: job.name, data: job.data }), {
    ...workerOptions,
    connection: conn,
  });
  const queue = new Queue(SYSTEM_QUEUE, { connection: conn });
  worker.on("error", (err) => report("valkey/worker", err));
  queue.on("error", (err) => report("valkey/queue", err));
  return { worker, queue };
}
