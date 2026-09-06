import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

// A reproducible listening comparison. No inference service, soundfont or browser
// is required; open the MIDI pairs with the same instruments in your DAW.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(process.argv[2] ?? join(root, "artifacts/phrase-comparison"));
const seed = process.argv[3] ?? "naruru-comparison-1";
const temporary = await mkdtemp(join(tmpdir(), "vsc-phrase-comparison-"));
const hash = (value) => createHash("sha256").update(value).digest("hex");

try {
  await build({
    configFile: false,
    root,
    logLevel: "warn",
    build: {
      outDir: temporary,
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: {
          music: join(root, "frontend/src/music/index.ts"),
          midi: join(root, "frontend/src/features/export/midi.ts"),
          json: join(root, "frontend/src/features/export/json.ts"),
        },
        formats: ["es"],
        fileName: (_format, entry) => `${entry}.mjs`,
      },
    },
  });
  const music = await import(pathToFileURL(join(temporary, "music.mjs")));
  const { exportCompositionMidi } = await import(pathToFileURL(join(temporary, "midi.mjs")));
  const { exportCompositionJson } = await import(pathToFileURL(join(temporary, "json.mjs")));
  await mkdir(output, { recursive: true });
  const results = [];
  for (const [style, bpm] of [["j-pop", 128], ["lo-fi", 82], ["edm", 132], ["jazz", 120]]) {
    for (const phraseDesign of [false, true]) {
      const version = phraseDesign ? "phrase" : "classic";
      const settings = {
        ...music.DEFAULT_GENERATOR_SETTINGS,
        seed, style, bpm, bars: 16,
        melody: { ...music.DEFAULT_GENERATOR_SETTINGS.melody, phraseDesign },
      };
      const piece = music.generateComposition(settings);
      const validation = music.validateComposition(piece);
      if (!validation.valid) throw new Error(`${style}/${version}: ${JSON.stringify(validation.errors)}`);
      const tracks = music.buildCompositionTracks(piece);
      const midi = exportCompositionMidi(piece, { name: `${style} / ${version} / ${seed}` });
      const name = `${style}-${version}`;
      await writeFile(join(output, `${name}.mid`), midi);
      await writeFile(join(output, `${name}.json`), exportCompositionJson(piece));
      const intervals = piece.notes.slice(1).map((note, index) => Math.abs(note.midi - piece.notes[index].midi));
      const barRhythms = piece.bars.map((bar) => piece.notes.filter((note) => note.barIndex === bar.index)
        .map((note) => Math.round((note.startTick - bar.index * piece.ticksPerBar) / (piece.ppq / 4))).join(","));
      results.push({
        style, version, seed, bpm, bars: 16,
        midi: `${name}.mid`, project: `${name}.json`, midiSha256: hash(midi),
        melodyNotes: piece.notes.length,
        distinctBarRhythms: new Set(barRhythms).size,
        maximumLeapSemitones: Math.max(0, ...intervals),
        meanDurationBeats: Number((piece.notes.reduce((sum, note) => sum + note.durationTick, 0) / piece.notes.length / piece.ppq).toFixed(3)),
        renderedNotes: tracks.reduce((sum, track) => sum + track.notes.length, 0),
        valid: true,
      });
    }
  }
  await writeFile(join(output, "comparison.json"), JSON.stringify({
    schemaVersion: 1,
    description: "Same settings and seed within each pair; only phraseDesign differs. Both use the corrected MIDI exporter. These measurements are not ratings of musical quality.",
    entrySha256: hash(await readFile(join(temporary, "music.mjs"))),
    results,
  }, null, 2) + "\n");
  await writeFile(join(output, "README.txt"), [
    "Visual Studio Chord — 生成方式の比較",
    "",
    "classic = 従来の生成 / phrase = 新しいフレーズ主導の生成",
    "同じジャンルのペアはシード・テンポ・キー・小節数が同じです。",
    "両方とも修正後のMIDI書き出しを使い、伴奏の強弱を保持しています。",
    "",
    "1. Logic Proなどに同じジャンルのMIDIを読み込みます。",
    "2. ベース・コード・メロディにそれぞれ同じ音源を割り当て、片方ずつ再生します。",
    "3. 主題が戻ってくるか、途中の展開、着地、伴奏との重なりを聴き比べます。",
    "4. JSONはアプリへ読み込むと、ノート編集や別シードでの生成に使えます。",
    "",
    "MIDIには音源が含まれません。音色やミックスの完成度を比較する資料ではありません。",
    "comparison.jsonの数値は生成内容の記録です。好みや音楽的な良さを証明する点数ではありません。",
    "",
    `再生成: node scripts/compare-phrase-generation.mjs <出力フォルダ> ${seed}`,
    "",
  ].join("\n"));
  console.log(JSON.stringify({ output, results }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
