#!/usr/bin/env node
// Landing page images (apps/web/app/page.tsx): webp copies of approved illustrations and app screenshots at the size
// they are shown (about 2× the CSS width), so the page does not download 1000-px originals for 100-px icons.
//
// Sources: design/assets/approved/*.webp and Android screen snapshots (Roborazzi,
// android/feature/student/src/test/snapshots/*.png, 780 px wide; tall ones are cut to the phone height 1688 px).
// Output: apps/web/app/_components/landing/img/*.webp (imported statically by landing/images.ts).
//
// Requires ImageMagick 7 (`magick`). Usage: node design/scripts/landing-images.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const approved = join(root, "design/assets/approved");
const snapshots = join(root, "android/feature/student/src/test/snapshots");
const out = join(root, "apps/web/app/_components/landing/img");
mkdirSync(out, { recursive: true });

/** Illustration → fits into a box of `w`×`h` px (never upscaled). */
const ART = [
  ["hero-landing", "hero-800", 800, 800],
  ["deco-ufa-monument", "place-ufa", 200, 200],
  ["deco-shulgantash-cave", "place-shulgantash", 200, 200],
  ["deco-agidel-boat", "place-agidel", 200, 200],
  ["deco-yamantau-peak", "place-yamantau", 200, 200],
  ["deco-village-house", "place-village", 200, 200],
  ["deco-sabantuy-horse", "place-sabantuy", 200, 200],
  ["scene-lesson-complete", "art-lessons", 760, 760],
  ["scene-duel", "art-duel", 760, 760],
  ["scene-word-accepted", "art-accepted", 380, 380],
  ["deco-yamantau-spruce", "art-spruce", 300, 300],
  ["deco-agidel-boat", "art-boat", 320, 320],
  ["badge-clover", "art-badge-clover", 200, 200],
  ["badge-linden", "art-badge-linden", 200, 200],
  ["badge-fireweed", "art-badge-fireweed", 200, 200],
  ["scene-class-cards", "art-school", 760, 760],
  ["scene-anywhere", "art-anywhere", 760, 760],
  ["bee-fly", "art-bee-fly", 440, 440],
  ["bee-cheer", "art-bee-cheer", 360, 360],
];

/** Screen snapshot → the first 780×1688 px (one phone screen), 520 px wide. */
const SCREENS = [
  ["trail_today", "screen-trail"],
  ["league", "screen-league"],
  ["result", "screen-result"],
];

const magick = (args) => execFileSync("magick", args, { stdio: "inherit" });

for (const [src, name, w, h] of ART) {
  magick([join(approved, `${src}.webp`), "-resize", `${w}x${h}>`, "-quality", "82", "-define", "webp:method=6", "-define", "webp:alpha-quality=90", join(out, `${name}.webp`)]);
  console.log(`${name}.webp ← ${src}`);
}
for (const [src, name] of SCREENS) {
  magick([join(snapshots, `${src}.png`), "-crop", "780x1688+0+0", "+repage", "-resize", "520x", "-quality", "84", "-define", "webp:method=6", join(out, `${name}.webp`)]);
  console.log(`${name}.webp ← ${src}.png`);
}
