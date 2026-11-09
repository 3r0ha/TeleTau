import { z } from "zod";
import { buildServer } from "./server.js";

const port = z.coerce.number().int().min(1).max(65535).default(4200).parse(process.env.ML_WORKER_PORT);
const app = buildServer();
await app.listen({ port, host: "0.0.0.0" });
console.log(`ml-worker: http://localhost:${port}/health`);
