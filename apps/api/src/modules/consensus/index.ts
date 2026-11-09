// Публичный интерфейс модуля consensus: другие модули импортируют только отсюда (apps/api/scripts/boundaries.mjs).
// Схема (consensus.schema.ts) отсюда не экспортируется — таблицы не выходят за пределы модуля (ADR 0014).
export { ConsensusModule } from "./consensus.module.js";
export { ConsensusService } from "./consensus.service.js";
export type { ConsensusApi, DuelCard, DuelSideView, VoteInput, VoteReceipt, Voter, VoterGroup } from "./consensus.api.js";
