// Аватары ников (avatars.ts): у каждого из 36 существительных словаря ников есть свой файл, порядок совпадает со
// словарём API (apps/api/src/modules/identity/nicknames.ts, NOUNS) и с нарезкой листов (design/scripts/process-assets.mjs,
// AVATAR_SHEETS). Исходники читаются как текст — пакет не зависит от кода API.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AVATAR_NOUNS, avatarSlugFor } from "../src/avatars";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");

/** NOUNS словаря ников — по порядку, как в API. */
function dictionaryNouns(): string[] {
  const src = read("apps/api/src/modules/identity/nicknames.ts");
  const block = /const NOUNS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(src)?.[1] ?? "";
  return [...block.matchAll(/\[\s*"([^"]+)",\s*"[mfn]"\s*\]/g)].map((m) => m[1]!);
}

/** Имена файлов аватаров из листов, по порядку клеток. */
function sheetSlugs(): string[] {
  const src = read("design/scripts/process-assets.mjs");
  const block = /const AVATAR_SHEETS = \{([\s\S]*?)\n\};/.exec(src)?.[1] ?? "";
  return [...block.matchAll(/\[([^\]]*)\]/g)].flatMap((m) => [...m[1]!.matchAll(/"([a-z-]+)"/g)].map((s) => s[1]!));
}

describe("аватары ников", () => {
  it("36 существительных — в том же порядке, что NOUNS словаря API", () => {
    const nouns = dictionaryNouns();
    expect(nouns).toHaveLength(36);
    expect(AVATAR_NOUNS.map(([noun]) => noun)).toEqual(nouns);
  });

  it("имена файлов — в порядке нарезки листов (AVATAR_SHEETS), у каждого существительного есть файл и импорт", () => {
    const slugs = AVATAR_NOUNS.map(([, slug]) => slug);
    expect(slugs).toEqual(sheetSlugs());
    expect(new Set(slugs).size).toBe(36);
    const illustrations = read("packages/ui/src/illustrations.ts");
    for (const slug of slugs) {
      expect(existsSync(resolve(repo, `design/assets/approved/avatar-${slug}.webp`)), slug).toBe(true);
      expect(illustrations, slug).toContain(`/design/assets/approved/avatar-${slug}.webp"`);
    }
  });

  it("аватар — по последнему слову ника, без регистра и различия «ё/е»; чужое слово — нет аватара", () => {
    expect(avatarSlugFor("Смелая пчела")).toBe("bee");
    expect(avatarSlugFor("Мудрый филин")).toBe("eagle-owl");
    expect(avatarSlugFor("Горный ёж")).toBe("hedgehog");
    expect(avatarSlugFor("горный еж")).toBe("hedgehog");
    expect(avatarSlugFor("Лесной бобер")).toBe("beaver");
    expect(avatarSlugFor("  Ясное  солнце ")).toBe("sun");
    expect(avatarSlugFor("Сонный ёжик")).toBeUndefined();
    expect(avatarSlugFor("Участник")).toBeUndefined();
    expect(avatarSlugFor("")).toBeUndefined();
    expect(avatarSlugFor(undefined)).toBeUndefined();
  });

  it("каждый ник словаря получает аватар своего существительного", () => {
    for (const [noun, slug] of AVATAR_NOUNS) expect(avatarSlugFor(`Добрый ${noun}`), noun).toBe(slug);
  });
});
