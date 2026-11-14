import { loadConfig } from "./config.js";
import { selectProvider } from "./providers/select.js";
import { buildServer } from "./server.js";

const config = loadConfig(process.env);
const { provider, warning } = selectProvider(config);
if (warning) console.warn(`ai-gateway: ${warning}`);
const app = buildServer(provider, { token: config.AI_GATEWAY_TOKEN });
await app.listen({ port: config.AI_GATEWAY_PORT, host: config.AI_GATEWAY_HOST });
console.log(`ai-gateway: http://${config.AI_GATEWAY_HOST}:${config.AI_GATEWAY_PORT}/health (провайдер: ${provider.name})`);
