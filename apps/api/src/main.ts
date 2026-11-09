import { createApp } from "./bootstrap.js";
import { loadConfig } from "./config/config.js";

const config = loadConfig(process.env);
const app = await createApp(config);
await app.listen({ port: config.API_PORT, host: "0.0.0.0" });
console.log(`api: http://localhost:${config.API_PORT}/api/v1/health`);
