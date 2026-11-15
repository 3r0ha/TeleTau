"use client";

import { useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react/ssr";
import { toComparable } from "@teletau/bashkir-text";
import { EmptyState, TextField } from "@teletau/ui";
import { useResource } from "@teletau/session/react";
import { useT } from "../../../i18n/client";
import type { T } from "../../../i18n/core";
import { LoadError, LoadingBlock, Screen, SimpleTop } from "../screens";
import { learnApi } from "./api";
import { plural } from "./format";
import type { PublicDictionaryEntry } from "./model";

/** Секции словаря — по языковой паре строки (контракт getPublicDictionary): ba-ru — основная, ba-kz — вторая. */
const SECTIONS: { pair: PublicDictionaryEntry["langPair"]; title: string; sourceHeader: string }[] = [
  { pair: "ba-ru", title: "Русско-башкирский", sourceHeader: "Русский" },
  { pair: "ba-kz", title: "Казахско-башкирский", sourceHeader: "Казахский" },
];

/**
 * Публичный словарь (ТЗ §5): витрина принятых пар «исходник — башкирский вариант» без входа — как доска почёта, но
 * строки — слова. Источники пар — только в выгрузке (/api/v1/public/dictionary), не на экране. Башкирские слова — контент, не переводятся, размечены lang="ba";
 * ключи интерфейса — русские строки через t(). Пары грузятся в браузере: витрина работает и без токена.
 */
export function DictionaryScreen() {
  const t = useT();
  const dict = useResource(() => learnApi.dictionary(), []);
  const items = dict.data?.items;
  return (
    <Screen top={<SimpleTop back="/" title={t("Словарь")} />}>
      <header className="dict__head">
        <h1 className="page-title">{t("Словарь")}</h1>
        {items && items.length > 0 ? <p className="page-lead">{countsLead(items, t)}</p> : null}
      </header>
      {items && items.length > 0 ? (
        <DictionaryView items={items} />
      ) : dict.error && !dict.data ? (
        <LoadError error={dict.error} onRetry={dict.reload} audience="child" />
      ) : dict.data ? (
        <EmptyState art="beeIdle" title={t("Словарь скоро наполнится")} headingAs="h2" compact>
          {t("Как только первые пары будут приняты, они появятся здесь.")}
        </EmptyState>
      ) : (
        <LoadingBlock rows={5} label={t("Открываем словарь")} />
      )}
    </Screen>
  );
}

/** Подпись с числом пар по каждой языковой паре: «Русско-башкирский: 36 пар · Казахско-башкирский: 50 пар». */
function countsLead(items: PublicDictionaryEntry[], t: T): string {
  return SECTIONS.map((s) => ({ title: s.title, count: items.filter((i) => i.langPair === s.pair).length }))
    .filter((s) => s.count > 0)
    .map((s) => `${t(s.title)}: ${s.count} ${plural(s.count, [t("пара"), t("пары"), t("пар")])}`)
    .join(" · ");
}

/** Список с поиском: фильтр по подстроке с обеих сторон — башкирской и исходника. */
function DictionaryView({ items }: { items: PublicDictionaryEntry[] }) {
  const t = useT();
  const [query, setQuery] = useState("");
  // Подстрока в сравнимой форме: регистр и написание букв (канонизация @teletau/bashkir-text) поиску не мешают.
  const needle = toComparable(query.trim());
  const groups = SECTIONS.map((s) => ({
    ...s,
    rows: items.filter(
      (i) => i.langPair === s.pair && (!needle || toComparable(i.textBa).includes(needle) || toComparable(i.translation).includes(needle)),
    ),
  }));
  return (
    <>
      <div className="dict__search">
        <TextField
          label={t("Поиск")}
          type="search"
          icon={<MagnifyingGlass weight="bold" aria-hidden />}
          placeholder={t("Слово или перевод")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>
      {needle && groups.every((g) => g.rows.length === 0) ? (
        <p className="dict__none" role="status">
          {t("Ничего не нашлось.")}
        </p>
      ) : null}
      <div className="dict__groups">
        {groups
          .filter((g) => g.rows.length > 0)
          .map((g) => (
            <DictTable key={g.pair} id={`dict-${g.pair}`} title={g.title} sourceHeader={g.sourceHeader} rows={g.rows} />
          ))}
      </div>
    </>
  );
}

/** Секция языковой пары: «башкирское слово — исходник». */
function DictTable({ id, title, sourceHeader, rows }: { id: string; title: string; sourceHeader: string; rows: PublicDictionaryEntry[] }) {
  const t = useT();
  return (
    <section className="dict__group" aria-labelledby={id}>
      <h2 className="dict__group-title" id={id}>
        {t(title)}
      </h2>
      <div className="dict__sheet">
        <table className="dict__table">
          <thead>
            <tr>
              <th className="dict__th" scope="col">
                {t("Башкирский")}
              </th>
              <th className="dict__th" scope="col">
                {t(sourceHeader)}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.fragmentId} className="dict__row">
                <td className="dict__td dict__td--ba">
                  <b className="dict__ba" lang="ba">
                    {row.textBa}
                  </b>
                </td>
                <td className="dict__td">
                  <span className="dict__ru">{row.translation}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
