// Renders the v1 engine over eval/cases.json. Kept for provenance; it runs
// inside a v1-final checkout, not in this workspace:
//
//   git worktree add ../vsc-v1 v1-final
//   cp tools/eval/export-v1-baseline.ts ../vsc-v1/frontend/
//   cd ../vsc-v1 && pnpm install && cd frontend
//   npx vite-node@3 export-v1-baseline.ts -- <cases.json> <out-dir> "v1-final@58eab80"
//
// Settings are DEFAULT_GENERATOR_SETTINGS (what v1 shipped) with the case's
// style, key, mode, tempo, length and seed.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { generateComposition, DEFAULT_GENERATOR_SETTINGS } from "./src/music/generator";
import { buildCompositionTracks } from "./src/music/compositionTracks";
import { exportCompositionMidi } from "./src/features/export/midi";
import type { GeneratorSettings } from "./src/types/music";

const [casesPath, outDir, engine] = process.argv.slice(2);
const { cases } = JSON.parse(readFileSync(casesPath, "utf8"));
mkdirSync(outDir, { recursive: true });
for (const c of cases) {
  const settings = {
    ...structuredClone(DEFAULT_GENERATOR_SETTINGS),
    style: c.style, key: c.key, mode: c.mode, bpm: c.bpm, bars: c.bars, seed: c.seed,
  } as GeneratorSettings;
  const composition = generateComposition(settings);
  const tracks = buildCompositionTracks(composition).filter((t) => !t.muted);
  const render = {
    format: "vsc-render/1",
    caseId: c.id,
    engine,
    bpm: c.bpm,
    timeSignature: composition.timeSignature,
    ppq: composition.ppq,
    totalTicks: composition.totalTicks,
    chords: composition.chords.map((ch) => ({ symbol: ch.symbol, start: ch.startTick, dur: ch.durationTick })),
    sections: (composition.sections ?? []).map((s) => ({ kind: s.kind, startBar: s.startBar, endBar: s.endBar })),
    tracks: tracks.map((t) => ({
      role: t.role,
      notes: t.notes.map((n) => ({ midi: n.midi, start: n.startTick, dur: n.durationTick, vel: n.velocity })),
    })),
  };
  writeFileSync(`${outDir}/${c.id}.json`, JSON.stringify(render));
  writeFileSync(`${outDir}/${c.id}.mid`, exportCompositionMidi(composition, { name: `${c.id} (${engine})` }));
  console.log(c.id, composition.resolvedStyle, composition.chords.length, "chords", tracks.map((t) => `${t.role}:${t.notes.length}`).join(" "));
}
