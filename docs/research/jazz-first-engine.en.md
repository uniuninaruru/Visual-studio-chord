# Jazz-first engine — architecture, evidence, and validation scope

[日本語](jazz-first-engine.ja.md) | [English](jazz-first-engine.en.md)

Status: unreleased major engine update. This does not mean the public hosted app
has been updated.

## Purpose

Do not treat frequencies from POP909 popular-music annotations as the answer to
jazz composition. New projects use a deterministic in-browser engine that plans
harmony, melody, and accompaniment together. Existing projects retain their old
path until explicitly switched. Basic generation needs no GPU, Python server,
or corpus download.

“All styles” means five selectable generation profiles in the same editor, not
every historical jazz idiom, professional-level performance, or a trained jazz
model. The initial instrumentation is melody, chords/right hand, and bass/left
hand. It does not claim a drum instrument or an interactive drummer model.

## Settings contract

`GeneratorSettings.jazz` is optional project data:

```ts
type JazzSettings = {
  version: 1;
  style: "swing" | "ballad" | "bebop" | "modern" | "neoSoul";
  form: "aaba" | "blues" | "modal" | "free";
  chromaticism: number; // 0..1
  interaction: number;  // 0..1
};
```

- Absent: legacy generation. Loading an old project must not silently opt it in.
- Present: the jazz path, with validated version, enums, finite numbers, and ranges.
- Fresh defaults: Swing / AABA, chromaticism 0.35, interaction 0.6.
- Blues uses complete 12-bar cycles: 12 / 24 / 48 bars, not an eight-bar sequence
  mislabeled as twelve-bar blues.
- `chromaticism` controls the tendency toward resolving chromatic approaches;
  `interaction` controls melodic/accompaniment response. Neither is a learned
  probability or a quality score.
- Changing settings does not overwrite the current song. Generate uses the new
  settings explicitly.

Independent sections use 8 / 16 / 24 / 32 bars and inherit the Jazz profile at
generation time. Sections and their arbitrary assembled sequence are saved as
`free`, not mislabeled AABA or blues. Legacy per-part Pop/Rock style controls are
disabled with an explanation on this path. A dedicated per-part selector for the
five Jazz profiles is not included in this implementation.
Changing Basic engine/profile settings does not convert existing source material.
Assembly rejects referenced parts whose engine or Jazz profile differs from the
current settings and asks for regeneration. Unused source alternatives do not
block assembly.

## Data flow

```text
Validated settings + seed + explicit progression choice
  → style/form and harmonic destinations
  → functional phrases and voicings
  → melodic chord-tone targets, approaches, and motifs
  → accompaniment informed by melodic space and the next chord
  → shared track definition
      → piano roll
      → Web Audio playback
      → multitrack MIDI
```

Tracks share harmonic destinations and musical time rather than being unrelated
random streams mixed at the end. A non-chord tone is not automatically a mistake:
its resolution and metrical role matter. Bass movement considers the following
harmony instead of merely cycling through the current chord's pitch classes.

Swing, ballad, bebop, modern, and neo-soul are authored profiles with different
density, rests, chromatic approaches, harmonic vocabulary, and accompaniment
rhythm. They are not renamed POP909 distributions. Their parameters are not
weights estimated from jazz recordings.

Integer ticks at PPQ 480 remain the storage basis, with piano MIDI pitches 21–108.
Melody timing is applied once to the stored notes; accompaniment timing is
applied in the shared rendering path. Neither is applied again by the legacy
groove layer. Playback must not use a hidden, different sequence from exported
MIDI and the displayed tracks.

## Removing implicit POP909 use

The new engine, normal browser ranking, and automatic section joins do not load
the POP909 snapshot implicitly. Without an empirical jazz corpus, the interface
shows theory-based candidates and reasons, not invented frequencies or likelihoods.

Likewise, backend `auto` must not select POP909 merely because a model file exists.
Legacy reproduction scripts, fixtures, and explicitly injected corpus providers
can remain separate from the default path. User datasets and weights are not
deleted. Earlier POP909/McGill evaluations are not results for this new engine.

## Primary references and boundaries

| Reference | Adopted idea | Not adopted or claimed |
| --- | --- | --- |
| [Berklee: Basic Piano Voicing Techniques](https://online.berklee.edu/takenote/basic-piano-voicing-techniques/) | Functional thirds/sevenths, selective fifth omission, register-aware voicing | Mechanically removing roots/fifths from every chord |
| [Berklee: Voice Leading for Guitar](https://online.berklee.edu/takenote/voice-leading-for-guitar/) | Common tones and connected, economical voice movement | A guarantee that minimum movement always makes good jazz |
| [Impro-Visor](https://www.cs.hmc.edu/~keller/jazz/improvisor/) / [source repository](https://github.com/Impro-Visor/Impro-Visor) | Harmony-aware melodic grammar and separated motifs/rules | Copying source, grammar files, or learned data; this is an independent implementation |
| [Downbeat delays are a key component of the swing feel in jazz (2022)](https://www.nature.com/articles/s42005-022-00995-z) | Timing that distinguishes performer roles and beat positions | Claiming universal 2:1 swing or independent random jitter is validated by the paper |
| [Weimar Jazz Database](https://jazzomat.hfm-weimar.de/dbformat/dboverview.html) | A future source of performance-derived annotations for melodic/rhythmic evaluation | Claiming it was downloaded, trained on, or used to fit this release; assuming solo transcriptions cover polyphonic piano accompaniment |

The swing study concerns timing relative to an accompaniment. The engine's
profile constants are not fitted paper parameters, and the paper does not prove
that this app's synthetic output sounds better.

## Validation and remaining work

The 2026-09-11 development-branch checks passed 1,460 frontend tests, typecheck,
lint, production build, 187 backend tests, and eight environment-diagnostic tests.
Additional generation/track-boundary checks passed 5,400 configurations; six
MIDI/JSON pairs passed reload validation. Browser E2E passed 8/8 in Chromium but
5/8 in WebKit: repeated generation and section operations still crash the page.
The previous HEAD passed the section operation, so this is being investigated
as a regression in this update, not declared Safari-ready or release-ready.
Native reports show `EXC_BREAKPOINT / SIGTRAP` inside JavaScriptCore DFG JIT
`VirtualRegisterAllocationPhase::run()`. Bypassing the Jazz display-track path
did not prevent it. The minimal trigger is not yet identified; browser-name
feature disabling, test skips, and JIT disabling are not shipped as fixes.
Temporary diagnostic edits have been restored.
These results do not include Windows/Linux hardware, real GPUs, or expert listening.

Mechanical checks cover fixed-seed reproduction, twelve-bar cycles, tick bounds,
registers, locked bars, range regeneration, project round trips, shared tracks,
MIDI output, and UI operation without a server. Passing tests or reducing a
non-chord-tone ratio is not evidence of improved musical quality on its own.

Listening comparisons should keep key, BPM, bar count, instrument, volume, and
playback range constant, separating stylistic differences from quality. Compare
chords, melody, bass, then the full arrangement. Expert listening, blind
comparisons, and performance-corpus evaluation remain separate work.

Future learned models need a baseline against this engine, task-appropriate
jazz data, separated training/evaluation, and truthful capability manifests.
Relabeling existing POP909 weights is not a migration strategy.

## Generate local comparison MIDI

After dependency setup, run from the project directory:

```sh
node scripts/compare-jazz-generation.mjs
# Optional output directory and seed
node scripts/compare-jazz-generation.mjs ./artifacts/jazz-generation-comparison jazz-review-1
```

The utility writes six MIDI/project-JSON pairs (five profiles plus twelve-bar
blues), and `comparison.json` with validation results and hashes. It reloads
project JSON and parses MIDI notes to compare them with the shared track
definition. Key C and BPM 120 are common, but Modern uses Modal, Neo Soul uses
Free, and Blues has twelve bars: this is not an isolated style-only A/B trial.
Assign identical per-track instruments and levels in your DAW when listening.

MIDI contains no piano samples or finished mix. The recorded numbers validate
generation/serialization; they do not automatically rate listening quality.
