# Visual studio chord

[日本語](README.md) | **English**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version: 0.5.0](https://img.shields.io/badge/version-0.5.0-6f42c1.svg)](CHANGELOG.en.md)

## 🎹 Nothing to install. Just open it

### → **[https://uniuninaruru.github.io/Visual-studio-chord/](https://uniuninaruru.github.io/Visual-studio-chord/)**

**No Docker. No terminal, no ZIP to download, no command to type.** Open the
link and a chord progression and melody are generated on the spot. Phones and
tablets too — it is the same link.

Composing, editing, playback, and MIDI export **all run inside your browser**.
Your song is never sent anywhere ([section 8 has the
details](#8-what-is-stored-where-and-what-is-sent)).

<sub>Running it yourself, with a GPU or the neural feature, is covered by the Docker and native setups below.</sub>

---

Visual studio chord is a local-first composition workspace that generates and
edits chord progressions, melodies, voicings, and additional parts. You can
regenerate only a selected range, audition A/B/C candidates, keep playback
running while editing, and export separate MIDI tracks for a DAW.

## How to read this README

This document separates first-time use from implementation details.

| Section | Audience | Contents |
| --- | --- | --- |
| [Part 1: First-time users](#part-1-first-time-users) | No Docker, terminal, or ML experience required | Which launcher to choose, where to paste commands, and how to generate the first song |
| [Part 2: Technical reference](#part-2-technical-reference) | Developers, operators, and model researchers | Architecture, GPU runtimes, API/data contracts, security, testing, and research provenance |

You do not need to understand a backend, checkpoint, MPS, or CUDA before using
the basic composition workflow.

# Part 1: First-time users

## 1. What you do in the app

The shortest useful workflow is:

1. choose Key, Scale, Style, BPM, and Bars;
2. select **Generate**;
3. select **Play**;
4. select only the bars you want to change and regenerate chords or melody;
5. export MIDI for a DAW.

You can also import a melody MIDI and have chords written to fit it, and the
three lines in the top left open a usage guide, the release notes, the licences,
and the volume controls.

### Edit a chord directly

You can change a selected chord's sound and length without rewriting its symbol
by hand.

1. Click a chord in **Chord Lane**.
2. Select **Edit sound** in the action bar (double-clicking the chord button does
   the same). The Inspector's chord section has the same entry point.
3. Choose the **root, quality, tensions, slash bass,** and **inversion** in the
   dialog.
4. Formal project data does not change until you select **Apply**. Cancel or Esc
   discards the uncommitted form values.
5. The action bar also provides **Add chord, Delete, Split, one-beat left/right
   Move,** and **one-beat shorter/longer Resize**. Add inserts into the selected
   chord, up to one beat where space permits.
6. An edit touching a locked bar is disabled with a written reason. Successful
   edits remain undoable. During playback, a next-bar message means the audible
   side keeps the old chord until that boundary.
7. The changed definition is propagated to playback, MIDI export, and JSON export.

An **inversion** changes which chord tone is on the bottom while keeping the
same chord. A **slash bass** explicitly names the lowest sounding note, as in
`C/E`. Under the Store contract, a chord with tensions or a slash bass uses root
position rather than a second, ambiguous inversion.

The current direct-edit surface is intentionally button- and dialog-based.
Drag-and-drop and freeform pointer resizing are not implemented; length changes
are made one beat at a time.

Candidate A/B/C previews do not change the current song until you explicitly
adopt one. Apply remains undoable.

### Build a song from separate sections

You can make the parts independently, choose their order, and assemble one
song only when the plan is ready.

1. Select **Create the four parts** (`4つのパーツを作る`) to make Intro, A melody, B melody, and C melody drafts.
2. On each card choose its name, template, Key / Scale / Style, and length (8 / 16 / 24 / 32 bars).
3. A changed setting is marked **Not applied** while the old material stays in place. Select **Generate with these settings** (`この設定で生成`) to update only that part.
4. Reorder, repeat, remove, or add parts in the sequence. The total must stay at or below 128 bars.
5. Choose Automatic (おまかせ / Auto) / As-is (そのまま / Direct) / Lead to next (次へ導く / Dominant) / Shared chord (共通コード / Pivot) between parts. Pivot is only for a boundary where Key / Scale actually changes, and it needs a real diatonic chord shared by both keys; a forced same-Key / Scale Pivot is rejected.
6. The finished song is not overwritten until **Assemble into one song** (`1曲にまとめる`). A dirty part used in the sequence blocks assembly. A failure keeps the current song, and a successful assembly can still be undone.
7. After assembly, click a section on the composition ruler to select its full range and set the loop. Playback, every track in MIDI, and JSON use the assembled result. On a phone, the visible part label stays readable while the lane scrolls horizontally.

For a same-Key / Scale `Auto` join, only theory-valid candidates are compared
using local two-step POP909 conditional evidence, the existing optimized
four-part voice leading, and the current style prior. No one score decides the
result: a seeded choice is made from the Pareto frontier. If corpus evidence is
unavailable, the corpus view is removed for every candidate and selection
continues safely, with the reason retained in the explanation. Forced `Direct`,
`Dominant`, and `Pivot` keep their existing meanings. See
[`docs/research/section-transition-ranking.en.md`](docs/research/section-transition-ranking.en.md)
for the calculation and limits.

### Find the next chord statistically

The **統計** tab in Workspace Tools analyzes the whole song or the selected bar range against the local POP909 statistics. **定番** (familiar) favors frequent candidates, **バランス** (balanced) aims between familiarity and novelty, and **意外** (adventurous) favors unusual candidates that were still observed. It separates **raw observed frequency** — how often this chord actually followed this context — from **interpolated probability**, which combines that evidence with shorter-context and global tendencies. Neither is a quality score. Counts are occurrences (including repetitions), not unique songs; ranking uses root+quality only, while voicing, tensions, and inversion remain theory/arrangement decisions.

**試聴** (audition) never edits the song. Applying is enabled only for one explicitly selected chord, preserves its exact start and duration, and names the target bar. With no selected chord the whole song can still be analyzed and song-end candidates auditioned, but nothing can be applied. Locked bars are refused. Every successful apply remains undoable.

The source is a compact browser 3-gram snapshot derived from the tracked local POP909 model (909 songs, 1,131 tonal sequences, 93,904 tokens). The app does not connect to Hooktheory or copy its statistics/data. Formulas and limitations are documented in [`docs/research/statistical-chord-advisor.en.md`](docs/research/statistical-chord-advisor.en.md).

For technical readers, a separate external evaluation uses McGill Billboard
annotations. The 3-gram improves prediction and overall Top-k on that corpus,
but the section-boundary subset does not improve uniformly. This does not
guarantee better music, listening quality, or a better complete UI candidate
advisor. Normal composition does not fetch the external data; see the
[external evaluation report](docs/research/mcgill-billboard-external-evaluation.en.md)
for scope and reproduction.

## 2. Choose one launch method

| Goal | Recommended method |
| --- | --- |
| Open the app with the fewest prerequisites | [Docker CPU](#method-a-docker-the-simplest-start) |
| Use the GPU in an Apple Silicon Mac | [Native macOS with MPS](#method-b-apple-gpu-on-macos-without-docker) |
| Use an NVIDIA GPU on Windows 11 | [Native Windows with CUDA](#method-c-nvidia-cuda-on-windows-without-docker) |
| Use an NVIDIA GPU on Linux | [Native Linux with CUDA](#method-d-nvidia-cuda-on-linux-without-docker) |
| Open the desktop-hosted app on a phone | [Same-LAN phone access](#3-open-it-on-a-phone-or-tablet) |

> Apple GPU and CUDA are different runtimes. Apple Silicon uses Metal/MPS;
> CUDA requires a compatible NVIDIA GPU.

### Open a terminal in the project folder

Every command below must run inside the downloaded project folder.

- **macOS:** open Terminal, type `cd ` including the space, drag the project
  folder into the Terminal window, and press Enter.
- **Windows 11:** open the project folder in File Explorer, type `powershell`
  into the address bar, and press Enter.

Check the location:

```bash
# macOS / Linux
pwd
ls scripts
```

```powershell
# Windows PowerShell
Get-Location
Get-ChildItem .\scripts
```

If the `scripts` directory is listed, you are in the correct place.

## Method A: Docker, the simplest start

Docker packages the required Node.js and Python environment. The standard
Docker launcher uses CPU and does not require a host Python installation.

First-time preparation:

1. install [Docker Desktop](https://www.docker.com/products/docker-desktop/);
2. start Docker Desktop and wait until its engine is running;
3. download this repository with **Code → Download ZIP** and extract it;
4. open a terminal in the extracted project folder.

Start on macOS or Linux:

```bash
./scripts/start-local.sh
```

Start on Windows PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\start-local.ps1
```

The first start downloads images and can take several minutes. Keep the
terminal open. Copy the complete printed address:

```text
Desktop URL: http://127.0.0.1:5173/#access=...
```

Press `Control + C` in the terminal to stop the app.

## Method B: Apple GPU on macOS without Docker

This is for Apple Silicon Macs such as M1 through M5. It uses PyTorch MPS and
ONNX CoreML, not CUDA.

Install Node.js 24 and Python 3.12, then run once:

```bash
./scripts/setup.sh mps
./.venv/bin/python scripts/verify_acceleration.py \
  --require-torch-device mps
```

If the probe reports MPS or `GPU available: yes`, start the app:

```bash
./scripts/dev.sh
```

Open <http://127.0.0.1:5173>.

## Method C: NVIDIA CUDA on Windows without Docker

This requires Windows 11, a CUDA-capable NVIDIA GPU, and a working NVIDIA
driver. AMD and Intel GPUs are not CUDA devices.

Install Node.js 24 and Python 3.12. Confirm the driver first:

```powershell
nvidia-smi
```

Then run once inside the project folder:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\setup.ps1 -Acceleration cuda
.\.venv\Scripts\python.exe .\scripts\verify_acceleration.py `
  --require-torch-device cuda
```

If the probe prints the CUDA device name, start the app:

```powershell
.\scripts\dev.ps1
```

Open <http://127.0.0.1:5173>.

## Method D: NVIDIA CUDA on Linux without Docker

After installing the NVIDIA driver, Node.js 24, and Python 3.12:

```bash
nvidia-smi
./scripts/setup.sh cuda
./.venv/bin/python scripts/verify_acceleration.py \
  --require-torch-device cuda
./scripts/dev.sh
```

Open <http://127.0.0.1:5173>.

## 3. Open it on a phone or tablet

The Mac, Windows PC, or Linux desktop performs generation and storage. The
phone is only a responsive client. Put both devices on the same trusted Wi-Fi.

```bash
# macOS / Linux
./scripts/serve-lan.sh
```

```powershell
# Windows
.\scripts\serve-lan.ps1
```

Open the complete printed `Phone URL`, including `#access=...`. Do not expose
this development launcher directly to the public internet or an untrusted
network.

## 4. First composition

1. start or skip the optional first-use tutorial (the three lines in the top
   left reopen it, and the written guide, at any time);
2. open **Basic**;
3. leave C / Major / 120 BPM / 8 bars selected for the first run;
4. select **Generate**, then **Play**;
5. select one or more bars in the piano roll or Chord Lane;
6. request a partial regeneration;
7. audition the candidates and adopt only the one you want;
8. use **Export** to download MIDI.

## 5. Recognize success and failure

| Message | Meaning | Action |
| --- | --- | --- |
| `Web app: http://127.0.0.1:5173` | The browser application started | Open that URL |
| `Local inference server: http://127.0.0.1:8765` | The local Python backend also started | Continue normally |
| `continuing in browser/theory mode` | An optional runtime is unavailable | Basic composition remains available; inspect Diagnostics |
| `ERR_CONNECTION_REFUSED` | The launcher is not running or has stopped | Return to the terminal and start it again |
| `port 5173 is already in use` | Another process owns the port | Change `MTC_FRONTEND_PORT` as described in the technical section |

## 6. Small glossary

| Term | Plain-language meaning |
| --- | --- |
| Terminal / PowerShell | A window for giving the computer text commands |
| Docker | A packaged application environment |
| CPU | The compatible default processor available on every supported computer |
| GPU | Hardware that performs many calculations in parallel |
| MPS / Metal | The PyTorch path to an Apple GPU |
| CUDA | NVIDIA's GPU-computing runtime |
| Backend | The local Python server that performs optional inference |
| Inference | Asking a trained model to calculate candidates |
| Checkpoint | A file containing trained model weights |
| MIDI | Note and performance data that a DAW can import |

## 7. Safety contract

- Generated candidates never overwrite the current song automatically.
- Neural candidates must pass schema, theory, voicing, 88-key, left/right-hand,
  and all-track checks before adoption.
- A validated preview changes the project only after explicit adoption and
  remains undoable.
- Cancel, timeout, checkpoint rejection, or inference failure does not publish
  a partial candidate.
- Songs stay in the browser; see section 8 for exactly what is sent and when.
- A missing neural model falls back to the empirical corpus, browser ranking,
  and deterministic theory workflow.

## 8. What is stored where, and what is sent

**The song itself never leaves the browser, under any launch method.** Chord and
melody generation, editing, playback, and MIDI export all run in browser
JavaScript. Songs are kept in `localStorage`, falling back to session memory
when that is unavailable. Preference learning is stored the same way, trying
IndexedDB, then `localStorage`, then memory.

Only when the backend is running are two things sent to it:

- **Candidate ranking** — per-candidate feature values (degree n-grams,
  harmonic-function ratios, and similar) together with the learned preference
  weights. These are not the notes themselves, but **for a short song of five
  chords or fewer a feature name is the chord progression**.
- **Neural inference**, and only if a checkpoint has been installed — the
  selected range, the melody, and any locked chords.

With no backend running, neither is sent. `Browser mode` in the header means no
request is being made.

The backend's preference state lives **in process memory only** and is never
written to disk; it is lost when the server stops.

### Using it with the browser alone

Generation, editing, playback, MIDI export, and preference learning all work
without starting the backend. Only two things become unavailable:

- **candidate ordering** by the 909-song empirical model — this changes the
  order A/B/C are shown in, not the music itself;
- the neural harmony preview, which needs a checkpoint that is not shipped.

## What is included

- deterministic, seeded generation with named progressions and functional
  harmony;
- variable harmonic rhythm, sections, modulation, phrase grammar, tension, and
  advanced chord vocabulary;
- independently designed Intro / A melody / B melody / C melody drafts with
  explicit assembly, repeatable joins, and a 128-bar ceiling;
- the full J-pop shape at the longest length: two verse-chorus cycles, a
  bridge, then the sabi twice more as a 落ちサビ and a 大サビ — the same
  progression, set quietly and then at full height;
- no section shorter than a four-bar period wherever the piece can afford one;
- four-part/piano voicing with cadence, applied-chord, voice-leading, and
  all-track validation;
- a left hand that holds a shell — root with a fifth, seventh, octave or tenth —
  with the interval read off the bass against the low interval limits, so the
  lower it sits the wider it has to be; the hands may overlap in pitch and may
  not swap;
- melodic skeletons, contextual non-chord tones, countermelody, canon,
  polyrhythm, and groove;
- melodic rhythm drawn from the note values the metre admits — eight of them,
  dotted values included — with a landing note reserved wherever a phrase closes;
- Bass / Left Hand, Chords / Right Hand, Melody, and additional DAW-style
  tracks with visibility, mute, solo, playback, and MIDI export;
- range regeneration, candidate audition, Like/Dislike preference ranking,
  Auto Fix preview, Apply, and Undo;
- light / dark / follow-the-system themes (menu → settings → 外観), with every
  colour tokenised so the chord lane and piano roll are designed for both rather
  than inverted into one;
- harmonic-function colours chosen to stay distinguishable under protanopia and
  deuteranopia — the tonic/predominant separation goes from a simulated 9.3 to
  25.8;
- preference-guided generation, off by default: the generate button draws
  several pieces and keeps the one the A/B judgements prefer, and the piece
  carries the seed of the draw that won, so it stays reproducible from that
  seed alone with no model involved;
- progression search across ~1500 catalogued and derived progressions, with
  any result applicable to the selected section — the bars keep their harmonic
  rhythm and only what each chord spells changes;
- voicing chosen by cost rather than named in a setting: a catalogue of shapes,
  low interval limits held as a rule, the melody kept audible above the
  accompaniment, and a register that moves with the section;
- melody MIDI import, with the key estimated from the melody and chords written
  to fit it;
- an explanation of what it wrote and why, per chord and for the whole piece,
  each statement naming the body of theory it comes from;
- local JSON persistence, offline operation after setup, diagnostics, and
  safe browser/theory fallbacks;
- a menu behind the three lines: usage guide, release notes, dependency
  licences, and master/per-track/reverb volume stored on the device rather than
  in the project.

The rest of this document is implementation and operations documentation.

---

# Part 2: Technical reference

## v0.5.0 position and scope

v0.5.0 lets a user design generated parts independently, choose their order,
repetitions, and joins, and explicitly assemble them into one song. Existing
direct chord editing, playback, multi-track output, Undo / Redo, MIDI, and JSON
use the same definitions in the assembled song.

The release includes section drafts, deterministic template generation, a
sequence up to 128 bars, boundary transition reconciliation, the composition
SectionRuler, and sticky part labels on a phone. Assembly is explicit and a
failure leaves the current finished song unchanged. The v0.4.0 HarmonyForge
neural-harmony research-preview feature remains available as an optional
research-preview path; no trained checkpoint is bundled or advertised.

## v0.4.0 scope

v0.4.0 adds the **HarmonyForge neural-harmony research-preview foundation**:
a 104,567,874-parameter masked Transformer, asynchronous API v2 jobs,
cancellation, strict checkpoint validation, and CUDA / Apple Metal (MPS) / CPU
adapters.

It does **not** include a trained HarmonyForge checkpoint. The normal product
continues to use the deterministic theory engine and an empirical chord
language model built from aggregate POP909 annotations. The optional mock is an
integration fixture and is visibly labeled `MOCK`, untrained, and unevaluated.

### Neural development is paused

With apologies to anyone who was looking forward to it: **work on the neural
harmony feature is currently stopped**, and there is no date that can honestly
be promised.

Harmony-only pre-training was run locally. Those weights cannot be loaded by the
inference path by design — they were never conditioned on a melody, so serving
them would make the interface claim a capability the model does not have.
Reaching something usable needs melody-conditioned training and a quality
evaluation, and the work paused before that.

Being honest about why: the model is too large for the data. Against 909 songs
and roughly five thousand windows, four of the six output heads never moved off
the trivial majority prediction, and generalization stopped improving after five
epochs. Getting to a quality worth shipping at this data scale needs a design
rethink, not more epochs.

**Nothing about the app is missing because of this.** Generation, editing,
playback, and MIDI export all run on the music-theory engine and the empirical
model. The neural feature was always additive, and everything that worked before
still works.

## Technical contents

| Area | Sections |
| --- | --- |
| Runtime and devices | [Optional acceleration](#optional-acceleration), [Native development and tests](#native-development-and-tests) |
| Neural model | [HarmonyForge research preview](#harmonyforge-research-preview), [Implemented model](#implemented-model), [Fallback](#fallback) |
| Section arrangement | [Section arrangement architecture and contract](#section-arrangement-architecture-and-contract) |
| External evaluation | [McGill Billboard external evaluation](#mcgill-billboard-external-evaluation), [evaluation report](docs/research/mcgill-billboard-external-evaluation.en.md) |
| Contracts | [API](#api), artifact validation, cancellation, and versioned data described in the HarmonyForge section |
| Quality and provenance | [Primary v0.4 references](#primary-v04-references), [Current limitations](#current-limitations) |

## McGill Billboard external evaluation

McGill Billboard annotations are used only to evaluate the tracked aggregate
model externally. The raw dataset is not tracked by Git and is not sent into the
application runtime or training path. The evaluation writes aggregate values to
a tracked aggregate evaluation report (aggregate evaluation JSON); song titles,
artists, absolute paths, and individual sequences are not written to public
documentation or tracked JSON.

On POSIX systems, reproduce it with:

```bash
python3 scripts/fetch-mcgill-billboard.py
python3 scripts/evaluate-mcgill-billboard.py \
  --output docs/research/evaluations/mcgill-billboard-v2-harmony-language-model-v1.json
```

The report fixes five SHA-256 values for the source archive, portable tree,
model, normalized input, and the canonical tokenizer script (strict UTF-8 + LF;
not raw checkout bytes), plus denominators and OOV rate,
overall and section-boundary results,
and the claims that are intentionally excluded:
[McGill Billboard external evaluation report](docs/research/mcgill-billboard-external-evaluation.en.md).
The tracked machine-readable result is the
[aggregate evaluation JSON](docs/research/evaluations/mcgill-billboard-v2-harmony-language-model-v1.json).

The input hashes and denominator are:

| Item | SHA-256 / count |
| --- | --- |
| source archive | `a22e32bf24c8a18859ce18427c6501a7a72520185cddd6d882ceb3c61d02ec75` |
| portable tree | `312a0e6478ca018aef44291e799434cc2096c0ea4a0e2568ef0ac90020ebb503` |
| tracked aggregate model | `dfa28603b2aa0247abe5265a6975ae8267042a91e72e8c1ddd2221e2624209ae` |
| normalized evaluation input | `f0ceb26872322f3e867d0d6ba9c4523c0bd057efed9799769a6208993cc21fdb` |
| canonical tokenizer script (strict UTF-8 + LF) | `b524df19323c5fbc28c30e90960a8dec3d17e0d7b2e22c774647693fd947a28d` |
| coverage / OOV | 890 annotations, 79,807 transitions / `191 / 79,807 = 0.2393%` |

`parserVersion` is `mcgill-salami-v2-normalizer-1`. The tokenizer is read as strict UTF-8; CRLF and lone CR are canonicalized to LF, and those canonical bytes are used for both hashing and compile/exec. The candidate set is all 106 model unigrams, not the UI template advisor
subset. McGill is centered on US Billboard material from 1958–1991; melody,
voicing, rhythm, audio, listening, and song-ID identity exclusion relative to
POP909 are not evaluated. Do not read the overall 3-gram improvement as a claim
about music quality or the complete advisor.

The section-boundary slice is not a generic inferred break: it uses the McGill
marker of a capital letter plus optional primes (`A`, `B'`, and so on) as a
high-level segment start, then evaluates the transition into that phrase's first
valid token from the preceding context. `Z` is non-musical and resets context;
a plain-text function label alone is excluded from this formal slice.

## Section arrangement architecture and contract

```mermaid
flowchart LR
    DESIGN["SectionDesign<br/>role / template / bars / key"] --> GENERATE["generateArrangementSection"]
    GENERATE --> SOURCE["immutable SectionSourceDefinition"]
    SOURCE --> PLAN["sequence instances + adjacent links"]
    PLAN --> ASSEMBLE["assembleSectionArrangement"]
    ASSEMBLE --> FINAL["flat composition<br/>playback / MIDI / JSON / Undo"]
```

- `SectionDesign` passes through `generateArrangementSection` to become an
  immutable `SectionSourceDefinition` with no nested plan. Source IDs,
  sequence-instance IDs, and link IDs are stable. A repeat references the same
  source, while event-ID prefixes are unique to the sequence instance.
- Each source is 8 / 16 / 24 / 32 bars and a sequence is at most 128 bars. A
  dirty source referenced by the sequence blocks assembly fail-closed; an
  unreferenced dirty draft can remain stored. Only explicit
  `assembleSectionArrangement` creates the finished flat composition. The
  Store keeps draft, committed, history, pending playback, and Undo separate.
- `arrangementPlan` carries `revision`, `assembledRevision`, and
  `manualSongEdited`. Plan-only edits leave the finished audio unchanged;
  only a successful explicit assembly updates the flat composition.
- Adjacent links use `auto`, `direct`, `dominant`, or `pivot`. Pivot requires a
  real diatonic chord shared by both keys and an invalid forced pivot is
  rejected. Dominant is a secondary dominant. Auto prefers a valid pivot on a
  modulation, falls back to dominant, and uses a deterministic seeded style
  approach / common-tone / global voice-leading choice in the same key.
- Approach and pivot split the outgoing final chord in half to place a pickup.
  The timeline remains `[0,totalTicks)`, with tick/bar offsets and locks; the
  assembler then performs global four-part revoicing and hand assignment,
  melody octave smoothing between sections, transition-window pitch
  reconciliation, and voice merging before `validateComposition`.
- JSON schema is 3. Schema v1 / v2 are safely migrated as formats that had no
  `arrangementPlan`; unknown schema or plan versions are rejected. The current
  `appVersion` is 0.5.0.
- SectionRuler shares Chord Lane's 122px-per-bar alignment, shows playback
  position and selection state in text (not colour alone), and keeps visible
  part labels sticky on narrow screens.

The implementation reuses the existing verified progression catalogue, the
[section/modulation research](docs/research/niche-genres.md), [SoundQuest's
secondary-dominant material](https://soundquest.jp/quest/chord/chord-mv2/secondary-dominant/3/),
and [Open Music Theory's jazz voicing / voice-leading
principles](https://viva.pressbooks.pub/openmusictheory/chapter/jazz-voicings/).
It does not copy songs or examples; it implements general principles as
deterministic constraints.

The test matrix covers Store history / pending playback, schema migration and
current-plan coverage, 128-bar JSON, MIDI built from shared
`buildCompositionTracks`, and Chromium / WebKit full flow, axe, and 390px
sticky behavior.

## Optional acceleration

The normal native setup now installs pinned PyTorch 2.13.0 and SafeTensors
0.8.0. `auto` probes MPS on Apple silicon and CUDA on NVIDIA systems with a
real tensor operation, then safely falls back to PyTorch CPU. To change the
device profile later. The pinned PyTorch targets are Apple silicon, Windows
x64, and Linux x86_64/aarch64; Intel Mac and Windows ARM64 can use the explicit
`none` profile to skip installing PyTorch and use Browser/Theory features.
`none` does not remove an already installed runtime.

```bash
# macOS / Linux
./scripts/setup-acceleration.sh auto
```

```powershell
# Windows 11
.\scripts\setup-acceleration.ps1 auto
```

The scripts verify a real tensor operation rather than GPU presence alone.
Windows accepts `cuda`, `directml`, or `cpu`; DirectML is for the existing ONNX
ranker and is not a v0.4 HarmonyForge device. HarmonyForge on Windows uses CUDA
or CPU. macOS uses MPS when supported, and Linux uses CUDA or CPU.

Equivalent pinned dependency commands used by the scripts, CI, and Docker are:

```bash
python -m pip install --requirement backend/requirements-acceleration-cpu.lock
python -m pip install --requirement backend/requirements-acceleration-cuda.lock
python -m pip install --requirement backend/requirements-acceleration-macos.lock
python -m pip install --requirement backend/requirements-acceleration-directml.lock
```

The first three include PyTorch 2.13.0 and SafeTensors 0.8.0 as appropriate.
The ranker-only DirectML lock includes neither. The current PyPI PyTorch
distribution also brings CUDA 13 packages into the Linux resolution even when
execution is CPU-only, so the CPU lock and Docker image have a large
download/storage footprint. We keep the reproducible upstream resolution
instead of inventing a wheel source or hashes; a separately pinned official CPU
wheel source can replace it after cross-platform validation.

The standard CPU Docker image includes the pinned optional neural runtime, but
HarmonyForge remains unavailable until a valid trained checkpoint is mounted
read-only. To start the optional CUDA image:

```bash
# Linux CUDA host
./scripts/start-local.sh cuda
```

```powershell
# Windows PowerShell
.\scripts\start-local.ps1 -Backend cuda
```

This adds `compose.cuda.yaml` and requests `gpus: all`. The host needs a
compatible NVIDIA driver and the
[official NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).

## HarmonyForge research preview

### Artifact layout

The real model is read only from the allowlisted layout:

```text
models/
  harmonyforge-bimask-base-v1/
    current.json
    versions/<manifest-sha256>/
      manifest.json
      data-manifest.json
      training-run.json
      harmonyforge-bimask-base-v1.safetensors
```

The manifest declares the architecture, actual config, checkpoint, and
`data-manifest.json` and `training-run.json` file SHA-256 values, the fixed
tokenizer digest, training/evaluation status, PyTorch version, minimum
application/API versions, and supported precision. The loader verifies
allowlisted filenames, actual file hashes, the tokenizer, and the architecture.
Dataset rights and leakage review remain training release gates. Separately,
the compiler verifies the data manifest’s ledger and split, vocabulary, and
statistics artifact hashes before export. Missing, untrained, unevaluated,
malformed, incompatible, or checksum-mismatched artifacts are rejected before
weights are moved to an accelerator.
The exporter publishes a fully validated immutable version first and switches
`current.json` atomically. A direct root-level artifact layout is accepted only
for legacy read compatibility and is never produced by the v0.4 writer.

Relevant environment settings:

```dotenv
MODEL_DIRECTORY=./models
NEURAL_MODEL_CONFIG=./configs/models/harmonyforge-bimask-base-v1.yaml
MTC_ENABLE_RESEARCH_CHECKPOINT=0
MTC_ENABLE_NEURAL_MOCK=0
```

`MTC_ENABLE_RESEARCH_CHECKPOINT=1` permits an explicitly research-only
artifact, but does not bypass any schema, checksum, architecture, or
compatibility check. `MTC_ENABLE_NEURAL_MOCK=1` enables only the deterministic
API/UI fixture; it does not turn the fixture into a trained music model.

### User workflow

1. Select bars in ChordLane, choose **コードのみ** (chords only) in the bottom
   regeneration dock, select Auto / Apple MPS / CUDA / CPU, and press
   **選択範囲を再生成**. Other regeneration targets keep using theory generation.
2. The editor sends melody, metre/form controls, immutable locks, generation
   mask, seed, `candidateCount: 3`, the preferred device, and
   `allowCpuFallback: true` to an API v2 background job.
3. Playback, draft editing, and manual controls remain available. The status
   area shows stage, progress, elapsed time, device, fallback reason, and
   Cancel. It says `Detecting device…` until a real probe completes.
4. Server candidates arrive as `hardRuleValidation: pendingClient` and
   `adoptable: false`.
5. The client materializes and validates each complete candidate. Invalid,
   cancelled, or context-stale results are discarded as a unit. Results
   compatible with newer edits are rebased, revalidated, and labeled `Rebased`.
6. Audition A/B/C. Only **この候補を採用** commits a validated preview to
   project/Undo history. Accelerator failure offers **CPUで再試行** for the same
   range; later failure falls back through deterministic theory generation,
   local ranking, and browser ranking.

### Implemented model

| Item | v0.4 implementation |
| --- | --- |
| Family | Time-aligned bidirectional masked, single-encoder Transformer |
| Encoder | 12 layers, hidden 768, 12 heads, FFN 4096, pre-norm, GELU |
| Position | Learned position in a 256-frame window plus bar/metre embeddings |
| Context | Melody, harmony, and bar-summary tokens |
| Extension conditioning | Existing extension multi-hot vector through a bias-free 8→768 projection |
| Outputs | Factorized event/root/quality/inversion/bass/extensions plus auxiliary function/cadence heads |
| Size | **104,567,874 parameters** |
| Artifact | One strict-manifest `SafeTensors` checkpoint |
| Devices | The same checkpoint on CUDA, MPS, and CPU |

v0.4 uses the standard PyTorch `TransformerEncoder`; it does not implement the
rotary/relative attention considered in the research plan. Those approaches,
sparse attention, stepwise stochastic-control guidance, and a causal student
remain future comparison experiments.

One forward processes one tokenizer window at
`candidate_decoding_batch: 1`. The requested 1–32 candidate variants are
seeded samples from the shared logits, so API `candidateCount` is not an
execution batch size. On accelerator OOM, v0.4 records the reason and falls
back to CPU when allowed; adaptive batch shrinking is not implemented.

### Fallback

```mermaid
flowchart LR
    REQUEST["HarmonyForge request"] --> DEVICE{"Platform tensor probe"}
    DEVICE -->|NVIDIA| CUDA["CUDA"]
    DEVICE -->|Apple Silicon| MPS["Metal / MPS"]
    DEVICE -->|other or accelerator failure| CPU["CPU"]
    CUDA -->|OOM or inference failure| CPU
    MPS -->|OOM or inference failure| CPU
    CPU -->|unavailable or failed| CORPUS["Empirical corpus"]
    CORPUS --> BROWSER["Browser ranker"]
    BROWSER --> THEORY["Deterministic theory"]
    THEORY --> SAFE["Existing song remains safe"]
```

The diagram is platform selection, not an attempt to execute CUDA and MPS on
one host. Silent MPS operation fallback is not reported as Metal execution;
the adapter records an explicit CPU fallback reason in the job and Diagnostics.

For the full processing diagram, artifact gate, prior-work mapping, and primary
sources, see the
[English architecture note](docs/neural-harmony-architecture.en.md) or the
[Japanese version](docs/neural-harmony-architecture.ja.md).

## Direct chord-editing contract

The data path is:

```text
ChordLane / ChordEditor
  -> StructuredChordEdit or timeline action
  -> editorStore
  -> draft / committed (pending until a playback boundary)
  -> buildCompositionTracks
  -> Web Audio / MIDI
```

- The canonical chord timeline covers exactly `[0,totalTicks)` with integer,
  positive-duration ticks, no gaps or overlaps, and unique IDs.
- Locked-bar edits fail closed. The Store owns Undo/Redo, progression metadata
  normalization, and draft/committed separation while playback is running.
- The UI never partial-merges derived `notes`, roman numerals, function, source,
  or other theory fields. Acoustic changes are rebuilt atomically from
  `StructuredChordEdit`.
- Tensions or a slash bass use root position only, as required by the existing
  Store contract.
- Delete/Backspace removes selected notes first, then the selected chord when no
  notes are selected. While the chord modal is open, background global shortcuts
  are suppressed.
- Project JSON keeps the existing `schemaVersion` and round-trips ChordEvent
  timing, IDs, and derived data.

The implemented surface is the button-based timeline controls, the detailed
dialog, and propagation to playback tracks, MIDI, and JSON. Freeform pointer
move/resize is not implemented.

## API

API v1 remains the health/ranking/preference boundary. Neural preview jobs use:

- `POST /api/v2/harmony/generate`
- `GET /api/v2/jobs/{requestId}`
- `POST /api/v2/harmony/cancel/{requestId}`
- `GET /api/v2/models/{modelId}/manifest`

OpenAPI is exported to `backend/openapi.json`, and the frontend types are
generated from it. Client input cannot supply arbitrary checkpoint paths or
backend-native tensors.

## Native development and tests

Pinned environment: Node.js 24.14.0, pnpm 11.9.0 (npm is also supported), and
Python 3.12.10. Supported ranges are Node.js 24 and Python 3.11–3.14.

```bash
./scripts/setup.sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
(cd backend && ../.venv/bin/python -m pytest)
pnpm test:e2e
```

For explicit native setup profiles, use `./scripts/setup.sh cpu`,
`./scripts/setup.sh cuda`, or `./scripts/setup.sh mps`; on Windows use
`.\scripts\setup.ps1 -Acceleration cpu|cuda`. The normal backend CI lane
explicitly selects the internal `none` profile and stays torch-free, while the
separate neural CPU lane installs the pinned CPU lock and verifies model
construction, tokenizer behavior, checkpoint rejection, API jobs/cancel/mock
behavior, and preview safety without claiming trained musical quality. CUDA and
MPS remain real-hardware release gates.

## Primary v0.4 references

- [AutoHarmonizer paper](https://arxiv.org/abs/2112.11122) /
  [official repository](https://github.com/sander-wood/autoharmonizer):
  sixteenth-note frames and variable harmonic rhythm.
- [ReaLchords](https://proceedings.mlr.press/v235/wu24c.html):
  an offline teacher and future low-latency student.
- [Stochastic Control Guidance paper](https://proceedings.mlr.press/v235/huang24g.html) /
  [official repository](https://github.com/yjhuangcd/rule-guided-music):
  forward evaluation of non-differentiable rules.
- [Full-to-full curriculum masking](https://arxiv.org/abs/2601.16150):
  a training plan intended to discourage melody-ignoring shortcuts; no
  training result is claimed here.

The [architecture note](docs/neural-harmony-architecture.en.md) maps each cited
idea to the implementation and separates it from repository-specific
integration. It also contains the full bibliography.

## Current limitations

- No trained HarmonyForge checkpoint is bundled or advertised.
- Dataset rights review, leakage-safe compilation, training, closed-test
  metrics, ablations, cross-device equivalence, and listening tests remain.
- The POP909 n-gram model represents mostly popular-music annotations; it does
  not claim equal coverage of classical counterpoint, jazz, or game music.
- DirectML accelerates the ONNX ranker, not HarmonyForge v0.4.
- Firefox is outside the current release-gating matrix.
- A parameter count, successful tensor probe, mock response, or passing API
  test is not evidence of musical quality.

See the [compatibility matrix](docs/compatibility.md),
[release checklist](docs/release-checklist.md), bilingual
[research plan](docs/research/neural-chord-model-plan.en.md), and
[state-of-the-art review](docs/research/neural-harmonization-sota.en.md).

## License

Application code is available under the [MIT License](LICENSE). Dataset and
checkpoint rights are separate; verify each source license before training or
redistributing derived artifacts.

Copyright (c) 2026 uniuninaruru
