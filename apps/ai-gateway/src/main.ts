import { loadConfig } from "./config.js";
import { CircuitBreaker, DailyBudget } from "./guards.js";
import { selectProvider } from "./providers/select.js";
import { buildServer } from "./server.js";

const config = loadConfig(process.env);
const { provider, warning } = selectProvider(config);
if (warning) console.warn(`ai-gateway: ${warning}`);
const app = buildServer(provider, {
  ...(config.AI_GATEWAY_TOKEN ? { token: config.AI_GATEWAY_TOKEN } : {}),
  logger: { level: config.AI_GATEWAY_LOG_LEVEL },
  budget: new DailyBudget(config.AI_GATEWAY_DAILY_CALLS),
  breaker: new CircuitBreaker(config.AI_GATEWAY_BREAKER_FAILURES, config.AI_GATEWAY_BREAKER_COOLDOWN_SECONDS * 1000),
});
await app.listen({ port: config.AI_GATEWAY_PORT, host: config.AI_GATEWAY_HOST });
console.log(`ai-gateway: http://${config.AI_GATEWAY_HOST}:${config.AI_GATEWAY_PORT}/health (провайдер: ${provider.name})`);
