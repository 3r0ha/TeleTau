// Озвучка со своего сайта: API отдаёт в записи (AudioClip) пути к копиям на нашем сайте — AAC `/audio/<id>.m4a`
// (`url`, играют все платформы) и оригинал Ogg (`files`). Копии в public/audio готовит scripts/prepare-audio.mjs при
// сборке веба. Чужие адреса не играем (CSP media-src 'self'): без локального пути кнопки «Послушать» нет.
import type { Schema } from "@teletau/contracts";
import type { AudioSource } from "@teletau/ui";

const AAC = 'audio/mp4; codecs="mp4a.40.2"';
const local = (url: string) => url.startsWith("/audio/");

/** Файлы записи по порядку предпочтения (как отдал API); только с нашего сайта. */
export function localAudio(clip: Schema<"AudioClip"> | undefined | null): AudioSource[] {
  if (!clip) return [];
  const files = clip.files?.length ? clip.files : [{ url: clip.url, type: AAC }];
  return files.filter((f) => local(f.url)).map((f) => ({ src: f.url, type: f.type }));
}
