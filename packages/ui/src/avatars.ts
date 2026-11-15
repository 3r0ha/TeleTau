// Аватары ников (design/assets/approved/avatar-*.webp): ник — «прилагательное + существительное»
// (ADR 0009), аватар выбирается по существительному. Порядок — как NOUNS в apps/api/src/modules/identity/nicknames.ts
// (словарь только дополняется в конец) и как AVATAR_SHEETS в design/scripts/process-assets.mjs; соответствие проверяет
// test/avatars.test.ts. Модуль без картинок: сами файлы подключает illustrations.ts.

/** Существительное ника → имя файла аватара (avatar-<slug>.webp). */
export const AVATAR_NOUNS = [
  ["пчела", "bee"],
  ["шмель", "bumblebee"],
  ["сова", "owl"],
  ["ёж", "hedgehog"],
  ["лиса", "fox"],
  ["барсук", "badger"],
  ["белка", "squirrel"],
  ["медведь", "bear"],
  ["рысь", "lynx"],
  ["сокол", "falcon"],
  ["ласточка", "swallow"],
  ["журавль", "crane"],
  ["синица", "tit"],
  ["бобёр", "beaver"],
  ["стрекоза", "dragonfly"],
  ["заяц", "hare"],
  ["куница", "marten"],
  ["филин", "eagle-owl"],
  ["цапля", "heron"],
  ["дельфин", "dolphin"],
  ["комета", "comet"],
  ["кедр", "cedar"],
  ["звезда", "star"],
  ["клён", "maple"],
  ["ромашка", "chamomile"],
  ["ветер", "wind"],
  ["берёза", "birch"],
  ["маяк", "lighthouse"],
  ["рябина", "rowan"],
  ["компас", "compass"],
  ["волна", "wave"],
  ["родник", "spring"],
  ["солнце", "sun"],
  ["облако", "cloud"],
  ["озеро", "lake"],
  ["перо", "feather"],
] as const;

export type AvatarSlug = (typeof AVATAR_NOUNS)[number][1];

/** Сравнение без регистра и без различия «ё/е»: «Горный ёж» и «горный еж» — один ник. */
const fold = (s: string) => s.toLocaleLowerCase("ru").replace(/ё/g, "е");
const BY_NOUN: ReadonlyMap<string, AvatarSlug> = new Map(AVATAR_NOUNS.map(([noun, slug]) => [fold(noun), slug]));

/**
 * Аватар по тексту ника: последнее слово — существительное из словаря. Нет ника или слово не из словаря (взрослый без
 * ника, «Участник») — undefined: вызывающий рисует обычный цветной шестиугольник.
 */
export function avatarSlugFor(nickname: string | null | undefined): AvatarSlug | undefined {
  const noun = nickname?.trim().split(/\s+/).pop();
  return noun ? BY_NOUN.get(fold(noun)) : undefined;
}
