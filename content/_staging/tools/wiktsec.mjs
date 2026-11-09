import { readFileSync } from "node:fs";
for (const f of process.argv.slice(2)) {
  const s = readFileSync(f, "utf8");
  const i = s.search(/\{\{-ba-\}\}/);
  console.log(`######## ${f}`);
  if (i < 0) { console.log("  (no ba section)"); continue; }
  let sec = s.slice(i);
  const j = sec.slice(10).search(/\n= *\{\{-[a-z-]+-\}\} *=/);
  if (j > 0) sec = sec.slice(0, j + 10);
  const m = sec.match(/==== Значение ====\n([\s\S]*?)\n====/);
  console.log((m ? m[1] : sec.slice(0, 800)).split("\n").filter((l) => l.trim() !== "#").join("\n").slice(0, 2000));
}
