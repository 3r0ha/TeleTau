import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PitchDeck } from "./PitchDeck";
import "./pitch.css";

export const metadata: Metadata = {
  title: "Презентация",
  robots: { index: false, follow: false },
};

/** Номер слайда в имени файла двузначный: slide-01.webp … slide-99.webp. */
const MAX_SLIDES = 99;

/** Число слайдов из public/pitch/slides.json ({ "count": N }); файла нет или он битый — 0. */
async function slideCount(): Promise<number> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(process.cwd(), "public/pitch/slides.json"), "utf8"));
    const count = typeof parsed === "object" && parsed !== null ? (parsed as { count?: unknown }).count : undefined;
    return typeof count === "number" && Number.isInteger(count) && count > 0 ? Math.min(count, MAX_SLIDES) : 0;
  } catch {
    return 0;
  }
}

/** Листалка слайдов: только слайды на весь экран, без шапки и подвала сайта. */
export default async function PitchPage() {
  const count = await slideCount();
  if (count === 0) notFound();
  return <PitchDeck count={count} />;
}
