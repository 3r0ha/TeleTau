import { createThrottledErrorLogger } from "@teletau/runtime";
import { loadConfig } from "./config.js";
import { SYSTEM_QUEUE } from "./jobs/system.js";
import { createSystemQueue } from "./system-queue.js";

const { connection, socketTimeoutMs } = loadConfig(process.env);
const report = createThrottledErrorLogger({ write: (m) => console.warn(`workers: ${m}`) });
const { worker, queue } = createSystemQueue(connection, report, {}, socketTimeoutMs);

worker.on("completed", (job, result) => console.log(`workers: ${job.name} → ${JSON.stringify(result)}`));
worker.on("failed", (job, err) => console.error(`workers: ${job?.name} failed: ${err.message}`));

await worker.waitUntilReady();
await queue.add("ping", {}, { removeOnComplete: true, removeOnFail: 100 });
console.log(`workers: слушаю очередь «${SYSTEM_QUEUE}» (${connection.host}:${connection.port}, db ${connection.db}${connection.tls ? ", TLS" : ""})`);

const shutdown = async () => {
  await Promise.allSettled([worker.close(), queue.close()]);
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
