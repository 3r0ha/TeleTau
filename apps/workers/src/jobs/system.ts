export const SYSTEM_QUEUE = "system";

export interface SystemJob {
  name: string;
  data: unknown;
}

/** Служебная очередь: проверка, что воркеры живы и видят Valkey. Прикладных очередей пока нет. */
export async function processSystemJob(job: SystemJob): Promise<{ pong: true; at: string }> {
  if (job.name === "ping") return { pong: true, at: new Date().toISOString() };
  throw new Error(`Неизвестная задача системной очереди: ${job.name}`);
}
