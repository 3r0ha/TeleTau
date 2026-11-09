import { loadConfig } from "./config.js";
import { selectProvider } from "./providers/select.js";
import { buildServer } from "./server.js";

const config = loadConfig(process.env);
const { provider, warning } = selectProvider(config);
if (warning) console.warn(`ai-gateway: ${warning}`);
const app = buildServer(provider);
await app.listen({ port: config.AI_GATEWAY_PORT, host: "0.0.0.0" });
console.log(`ai-gateway: http://localhost:${config.AI_GATEWAY_PORT}/health (провайдер: ${provider.name})`);
