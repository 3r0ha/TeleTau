// Табличный набор векторов normalize-table.json: по вектору на каждую запись правил
// (letterMap, removeCodePoints, whitespaceCodePoints, sequences). Ожидания выводятся прямо из правил,
// а не из какой-либо реализации, поэтому набор ловит пропущенную или неверно перенесённую запись.
// Генерируется и проверяется из codegen.mjs (pnpm codegen / pnpm codegen:check).

const ch = (hex) => String.fromCodePoint(parseInt(hex, 16));
const isCyrillic = (hex) => {
  const cp = parseInt(hex, 16);
  return cp >= 0x0400 && cp <= 0x052f;
};

/** @returns {{suite:string,version:number,function:string,description:string,cases:Array<{id:string,input:string,expected:string,note:string}>}} */
export function buildTableSuite(spec, source) {
  const cases = [];
  const add = (id, input, expected, note) => cases.push({ id, input, expected, note });

  for (const e of spec.letterMap) {
    const from = ch(e.from);
    const to = ch(e.to);
    add(`t-map-${e.from}`, `ҡ${from}ы`, `ҡ${to}ы`, `в кириллическом слове: ${e.why}`);
    add(
      `t-map-${e.from}-alone`,
      from,
      isCyrillic(e.from) ? to : from,
      isCyrillic(e.from) ? `отдельное слово (сама буква — кириллица): ${e.why}` : `отдельное слово без кириллицы не меняется`,
    );
  }

  for (const e of spec.removeCodePoints) {
    const c = ch(e.cp);
    add(`t-rm-${e.cp}`, `ҡы${c}ҙ`, "ҡыҙ", `удаляется рядом с буквами: ${e.why}`);
    if (e.onlyNearLetters) {
      add(`t-rm-${e.cp}-emoji`, `🐝${c}🍯`, `🐝${c}🍯`, "между эмодзи сохраняется");
      add(`t-rm-${e.cp}-edge`, `${c} ҡ`, `${c} ҡ`, "в начале строки перед пробелом сохраняется (соседей-букв нет)");
    }
  }

  for (const hex of spec.whitespaceCodePoints) {
    const w = ch(hex);
    add(`t-ws-${hex}`, `ҡы${w}${w}ҙ`, "ҡы ҙ", `пробельный U+${hex} внутри: заменяется и схлопывается`);
    add(`t-ws-${hex}-edge`, `${w}ҡ${w}`, "ҡ", `пробельный U+${hex} по краям обрезается`);
  }

  for (const e of spec.sequences) {
    add(`t-seq-${e.from.join("-")}`, `${ch(e.from[0])}${ch(e.from[1])}ы`, `${ch(e.to)}ы`, e.why);
  }

  return {
    suite: "bashkir-text/normalize-table",
    version: 2,
    function: "normalize",
    description: `СГЕНЕРИРОВАНО из ${source} (версия правил ${spec.version}) скриптом packages/bashkir-text/scripts/vectors-table.mjs через pnpm codegen. Не редактировать вручную. По вектору на каждую запись правил.`,
    cases,
  };
}
