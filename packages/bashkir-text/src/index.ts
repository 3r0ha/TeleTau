export { fold, normalize, toComparable } from "./normalize.js";
export { answerTokens, matchAnswer, osaDistance, TYPO_MIN_LENGTH, type AnswerInput, type AnswerMatch, type AnswerVerdict, type LetterHint } from "./match.js";
/**
 * Таблица свёртки особых букв (ҡ→к, ә→а, …, ё→е) — та же, что применяет `fold`. Для портов свёртки вне TS,
 * которым нельзя вызвать функцию: например, `translate()` в SQL-поиске по справочнику (apps/api, модуль org).
 */
export { FOLD_MAP } from "./table.generated.js";
