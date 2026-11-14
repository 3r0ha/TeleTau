#!/usr/bin/env python3
"""Синтез башкирской озвучки строк курса — content/audio/tts/<слаг>.ogg (Ogg Vorbis).

Вход — манифест scripts/tts/collect-slugs.mjs (JSON {слаг: текст}): слаги строк курса без записи
носителя. Модель Silero v5_cis_base_nostress (диктор bak_aigul, MIT — LICENSE_CIS в репозитории
модели); синтез ≠ запись носителя: клиенты видят происхождение в источнике silero-tts-v5-cis
(content/sources.yaml). Подробности и окружение — scripts/tts/README.md.

Запуск (из корня репозитория):
  node scripts/tts/collect-slugs.mjs > manifest.json
  python scripts/tts/generate.py manifest.json            # существующие файлы не трогает
  python scripts/tts/generate.py manifest.json --force    # перегенерировать всё

Дальше файлы подхватывает пайплайн озвучки: check-content.mjs (проверка слагов), prepare-audio.mjs
(копии в apps/web/public/audio), content-import.ts (фолбэк «Послушать» для строк без записи).
"""
import argparse
import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT_DIR = REPO / "content" / "audio" / "tts"
MODEL_ID = "v5_cis_base_nostress"
SPEAKER = "bak_aigul"
SAMPLE_RATE = 24000
MIN_SECONDS = 0.2  # короче — подозрительно, probably пустой синтез


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("manifest", help="JSON {слаг: текст} из scripts/tts/collect-slugs.mjs")
    parser.add_argument("--force", action="store_true", help="перегенерировать существующие файлы")
    args = parser.parse_args()

    items = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    if not items:
        print("манифест пуст — синтезировать нечего", file=sys.stderr)
        return 1

    try:
        import soundfile
        import torch
    except ImportError as e:
        print(f"нет зависимостей ({e}) — окружение описано в scripts/tts/README.md", file=sys.stderr)
        return 1

    started = time.time()
    model, _ = torch.hub.load(
        repo_or_dir="snakers4/silero-models",
        model="silero_tts",
        language="ru",  # в models.yml модель v5_cis_base* лежит под «ru»; язык задаёт диктор bak_*
        speaker=MODEL_ID,
        trust_repo=True,
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    done = skipped = failed = 0
    for slug, text in sorted(items.items()):
        dst = OUT_DIR / f"{slug}.ogg"
        if dst.exists() and not args.force:
            skipped += 1
            continue
        try:
            audio = model.apply_tts(text=text, speaker=SPEAKER, sample_rate=SAMPLE_RATE)
            if len(audio) < MIN_SECONDS * SAMPLE_RATE:
                raise RuntimeError(f"пустой синтез ({len(audio) / SAMPLE_RATE:.2f} с)")
            soundfile.write(str(dst), audio.clamp(-1, 1).numpy(), SAMPLE_RATE, format="OGG", subtype="VORBIS")
            done += 1
        except Exception as e:  # noqa: BLE001 — одна строка не должна валить всю генерацию
            failed += 1
            print(f"  FAIL «{text}» ({slug}): {e}", file=sys.stderr)

    total = len(items)
    print(
        f"tts: строк {total}, синтезировано {done}, пропущено (уже есть) {skipped}, ошибок {failed} "
        f"за {time.time() - started:.0f} с → {OUT_DIR.relative_to(REPO)}"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
