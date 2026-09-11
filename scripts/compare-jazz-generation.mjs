import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// This is a reproducible rendering/serialization comparison, not a listening
// test and not a claim that any profile is musically better.  MIDI files can be
// opened with the same instruments in a DAW for human review.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = join(root, "frontend");
const output = resolve(process.argv[2] ?? join(root, "artifacts/jazz-generation-comparison"));
const seed = process.argv[3] ?? "naruru-jazz-comparison-1";
const temporary = await mkdtemp(join(tmpdir(), "vsc-jazz-comparison-"));
const frontendRequire = createRequire(join(frontendRoot, "package.json"));
// Vite is a frontend dev dependency.  Resolving it from frontend/package.json
// keeps this utility usable when the repository root has no vite installation.
const { build } = frontendRequire("vite");
const { Midi } = frontendRequire("@tonejs/midi");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

try {
  await build({
    configFile: false,
    root: frontendRoot,
    logLevel: "warn",
    build: {
      outDir: temporary,
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: {
          music: join(frontendRoot, "src/music/index.ts"),
          midi: join(frontendRoot, "src/features/export/midi.ts"),
          json: join(frontendRoot, "src/features/export/json.ts"),
        },
        formats: ["es"],
        fileName: (_format, entry) => `${entry}.mjs`,
      },
    },
  });

  const music = await import(pathToFileURL(join(temporary, "music.mjs")));
  const { exportCompositionMidi } = await import(pathToFileURL(join(temporary, "midi.mjs")));
  const { exportCompositionJson, importCompositionJson } = await import(pathToFileURL(join(temporary, "json.mjs")));
  await mkdir(output, { recursive: true });

  const profiles = [
    ["swing", "aaba", 16],
    ["ballad", "aaba", 16],
    ["bebop", "aaba", 16],
    ["modern", "modal", 16],
    ["neoSoul", "free", 16],
    ["swing", "blues", 12],
  ];
  const results = [];
  for (const [style, form, bars] of profiles) {
    const settings = {
      ...music.DEFAULT_GENERATOR_SETTINGS,
      key: "C",
      bpm: 120,
      bars,
      seed,
      style: "jazz",
      jazz: {
        version: 1,
        style,
        form,
        chromaticism: 0.35,
        interaction: 0.6,
      },
    };
    const composition = music.generateComposition(settings);
    const validation = music.validateComposition(composition);
    if (!validation.valid) {
      throw new Error(`${style}/${form}: ${JSON.stringify(validation.errors)}`);
    }
    const tracks = music.buildCompositionTracks(composition);
    const midiBytes = exportCompositionMidi(composition, { name: `jazz / ${style} / ${form} / ${seed}` });
    const json = exportCompositionJson(composition);
    const midi = new Midi(midiBytes);
    const reloaded = importCompositionJson(json);
    const expectedTrackNotes = tracks.map((track) => track.notes.map((note) => [
      note.midi,
      note.startTick,
      note.durationTick,
    ]));
    const actualTrackNotes = midi.tracks.map((track) => track.notes.map((note) => [
      note.midi,
      note.ticks,
      note.durationTicks,
    ]));
    const sharedTracks = JSON.stringify(expectedTrackNotes) === JSON.stringify(actualTrackNotes);
    const reloadValid = JSON.stringify(reloaded) === JSON.stringify(composition);
    if (!sharedTracks || !reloadValid) {
      throw new Error(`${style}/${form}: serialized data did not reload identically`);
    }
    const name = `jazz-${style}-${form}`;
    await writeFile(join(output, `${name}.mid`), midiBytes);
    await writeFile(join(output, `${name}.json`), json);
    const allMidiNotes = midi.tracks.flatMap((track) => track.notes);
    const intervals = composition.notes.slice(1).map((note, index) =>
      Math.abs(note.midi - (composition.notes[index]?.midi ?? note.midi)));
    results.push({
      profile: style,
      form,
      key: settings.key,
      bpm: settings.bpm,
      bars,
      seed,
      midi: `${name}.mid`,
      project: `${name}.json`,
      midiSha256: sha256(midiBytes),
      jsonSha256: sha256(json),
      compositionId: composition.id,
      melodyNotes: composition.notes.length,
      renderedNotes: tracks.reduce((sum, track) => sum + track.notes.length, 0),
      midiTracks: midi.tracks.length,
      midiNotes: allMidiNotes.length,
      maximumMelodyLeapSemitones: Math.max(0, ...intervals),
      sharedTrackReload: sharedTracks,
      projectReload: reloadValid,
      valid: true,
    });
  }

  const comparison = {
    schemaVersion: 1,
    description: "Jazz profile-and-form generation measurements with identical key, tempo, and seed; the regular profiles use 16 bars and the blues profile uses 12. The values are serialization/rendering diagnostics, not listening-quality scores or learned jazz probabilities.",
    inputs: {
      key: "C",
      bpm: 120,
      seed,
      profiles: profiles.map(([style, form, bars]) => ({ style, form, bars })),
    },
    metricsAreGenerationMeasurements: true,
    notListeningQuality: true,
    results,
  };
  await writeFile(join(output, "comparison.json"), `${JSON.stringify(comparison, null, 2)}\n`);
  console.log(JSON.stringify({ output, results }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
