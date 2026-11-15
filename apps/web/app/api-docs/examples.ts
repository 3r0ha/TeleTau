// Примеры ответов открытых операций для страницы документации. В контракте полных примеров нет, поэтому записи
// собраны по схемам (типы — из @teletau/contracts: расхождение со схемой не пройдёт typecheck). Башкирский текст
// и источники — строки демо-контента content/corpus/duels/01-ufa.yaml и content/course/ba-ru/units/01-ufa, обе
// уже в очереди проверки носителем (docs/native-review-queue.md). Идентификаторы и числа — условные.
import type { Schema } from "@teletau/contracts";

export const dictionaryExample: Schema<"PublicDictionary"> = {
  generatedAt: "2026-11-15T06:00:00.000Z",
  langPair: "ba-ru",
  items: [
    {
      fragmentId: "0193f7a4-0000-7000-8000-00000000f001",
      textBa: "Һаумыһығыҙ!",
      langPair: "ba-ru",
      translation: "Здравствуйте!",
      sources: [
        {
          title: "Tatoeba: башкирские предложения (bak) с русскими переводами",
          url: "https://tatoeba.org/ru/sentences/show/2839364",
          locator: "предложение №2839364 (CC BY 2.0 FR); русский перевод №483499 — связан косвенно, через перевод на другой язык",
          license: "CC BY 2.0 FR",
        },
      ],
      confirmed: 4,
      status: "confirmed",
    },
  ],
};

export const leaderboardExample: Schema<"PublicLeaderboard"> = {
  asOf: "2026-11-15T06:00:00.000Z",
  period: "week",
  periodStart: "2026-11-09",
  smallGroupThreshold: 5,
  schools: [
    {
      rank: 1,
      school: "Демо-школа № 1 (для проверки)",
      district: "Демо-район (для проверки)",
      lessons: 148,
      activeStudents: 12,
      wordsLearned: 356,
    },
  ],
  classes: [
    {
      rank: 1,
      school: "Демо-школа № 1 (для проверки)",
      district: "Демо-район (для проверки)",
      classLabel: "5 «Б»",
      lessons: 96,
      activeStudents: 8,
      wordsLearned: 214,
    },
  ],
};

export const phraseExample: Schema<"PhraseOfDay"> = {
  date: "2026-11-15",
  pair: {
    sourceRu: "Привет.",
    kind: "phrase",
    textBa: "Сәләм.",
    sources: [
      {
        title: "Викигид: Башкирский разговорник",
        url: "https://ru.wikivoyage.org/w/index.php?title=%D0%91%D0%B0%D1%88%D0%BA%D0%B8%D1%80%D1%81%D0%BA%D0%B8%D0%B9_%D1%80%D0%B0%D0%B7%D0%B3%D0%BE%D0%B2%D0%BE%D1%80%D0%BD%D0%B8%D0%BA&oldid=761421",
        locator: "раздел «Основные», строка «Привет.»",
        license: "CC BY-SA 4.0",
      },
    ],
  },
};
