# Changelog

[日本語](CHANGELOG.md) | [**English**](CHANGELOG.en.md)

Notable changes are recorded here. Dates use `Asia/Tokyo`. The
[Japanese changelog](CHANGELOG.md) contains the complete pre-0.4 history.

## Unreleased

### Added — a harmony-only, private-local training pipeline

The first weights this project trains are a **private, local-only harmony
pretraining artifact**, not a publishable melody-conditioned model. The
repository distributes no part of the POP909 corpus, no normalized or processed
rows, no split assignments, and no trained weights. Whoever runs it obtains
POP909 from the upstream source themselves and prepares, compiles, and trains
locally.

**Fetch and extract.** `scripts/fetch-pop909.py` clones the canonical GitHub
repository without credentials using a blob filter and a non-cone sparse
checkout, materializing only LICENSE and each song's `beat_audio.txt`,
`chord_audio.txt`, and `key_audio.txt`. MIDI, audio, archives, weights, and
normalized derivatives are never requested into the working tree.
`scripts/prepare-pop909-harmony-only.py` emits only key-relative chord root,
quality, inversion, bass, and extension; harmonic rhythm in integer ticks;
key/mode, meter, and bar position. Melody, audio, lyrics, raw MIDI, performance
expression, voicing, arrangement, and identifying metadata are **not written at
the normalization step**, rather than read and discarded afterwards.

**Compile.** Dataset schema v2 adds a `harmonyOnlyV1` content profile, reachable
only under the `privateLocalHarmonyOnlyTraining` purpose and pinned to a
`privateLocalOnly` distribution scope. Provenance is recorded per dataset or
source subset rather than per song: stable source id, version, canonical URL,
UTC retrieval date, citation, SHA-256 of both the source tree and the normalized
input, the content scope actually reviewed, and the basis for the decision.
`approved` is a project record, not a legal finding; `pending`, `blocked`,
unknown-origin, and checksum-mismatched sources never enter training. When a
ledger declares a preparation descriptor, `--prepare-run` requires the
hash-bound `prepare-run.json` that matches it.

**Atomic installs.** Neither prepare nor compile can damage the last known good
set by failing partway. Each writes its whole output into a staging directory
and publishes it with a single directory rename. An existing non-empty directory
is never an overwrite target — a new versioned directory is required. The
staging directory is flushed before the rename and the parent after it, and file
contents are flushed as they are written, so a bundle cannot appear under its
final name while its bytes are still only in the page cache.

**Docker build-context audit.** The audit now covers not only "stays out of Git"
but "stays out of what Docker uploads". A remote daemon receives the build
context over the network and cache layers can be pushed to a registry, so
careful `COPY` statements are not sufficient. Raw data, trained weights, and
MIDI/audio material are excluded at the context level in `.dockerignore`, with
contract tests. `scripts/check-private-artifacts.py` enforces the boundary in CI
and in `scripts/test.sh`.

**What may be published.** `scripts/export-public-training-receipts.py` verifies
the content-addressed binding between a private checkpoint and its compiled data
and then writes only non-reconstructive receipt JSON — never weights, split
assignments, record ids, source-item ids, raw content, or local paths. The
[data card](docs/research/pop909-harmony-only-data-card.en.md) records the recipe
and contract along with aggregate counts and hashes for a pinned upstream
checkout.

**Not measured.** Full neural training time, cost, convergence, and musical
quality are unmeasured. The data card's source-review status is `pending` per
run for whoever fetches the corpus.

### Added — a safety boundary keeping harmony-pre-trained weights out of inference

The trainer is fixed at melody-conditioned variable-rhythm harmonization.
Weights produced by harmony-only pre-training share the architecture, the
tokenizer, and the config, so **every structural check the loader performs —
tokenizer match, architecture match, SHA-256 of every file — passes on them**.
The declared objective is the only thing separating the two. Loading such
weights as the product model would make the capability the interface advertises
untrue.

There were three gaps.

- **No vocabulary for an honest declaration.** `manifest.task` was a `Literal`
  admitting exactly one value, and the writer hardcoded that same string. A
  harmony-only checkpoint could not be described at all except by claiming to
  be melody-conditioned — the schema compelled the misstatement.
- **The boundary rode on release status.** `MTC_ENABLE_RESEARCH_CHECKPOINT=1`
  reaches the production serving path as `allow_research`. "Not yet evaluated"
  and "trained at a different objective" are independent axes, but they were
  collapsed onto one flag, so a single environment variable admitted the wrong
  kind of model.
- **Nothing surfaced it.** The backend manifest response omitted `task`, leaving
  clients no way to tell the two apart.

What changed:

- `manifest.task` accepts `harmony_only_pretraining`, so pre-training weights
  can be declared honestly. The writers (`save_trained_artifact`,
  `publish_checkpoint_manifest`, `train_reference_model`) take a `task`.
- The loader checks `task` ahead of every other gate and refuses anything but
  the inference objective. **That check does not consult `allow_research`.** A
  dedicated `permit_pretraining_task` argument defaults to `False`, and only the
  training, export, and evaluation paths pass it. The serving path
  (`TorchHarmonyBackend`) never mentions the argument, so **no setting and no
  environment variable can open the boundary**.
- The declared objective is also recorded in `training-run.json`, which is
  hashed into the manifest — putting it inside the verified provenance chain
  rather than beside it.
- `evaluate_checkpoint` can still evaluate pre-training weights, since that is
  how they earn promotion, but its result now names the `task` so a number
  measured on one objective cannot be read as evidence about the other.
- The backend manifest response reports `task`; a rejected artifact appears as
  `available: false` with the declared objective in its reason.

Eight tests in `backend/tests/test_harmony_pretraining_boundary.py`. Both
removing the boundary and folding it into `allow_research` make them fail; the
latter is caught by the test that exists to hold the two axes apart.

### Fixed — setup rebuilds a virtual environment whose interpreter has gone (`e8546cc`)

`.venv/bin/python` is a symlink. When the Python it points at is upgraded or
uninstalled — an Xcode or system Python is the usual case — the link dangles and
every script that uses the environment fails with a file-not-found error naming
a path that plainly exists.

Running setup again did not help. `venv` will not touch a directory that already
exists: **with pip it exits non-zero, and without pip it exits zero having
repaired nothing**, so a script checking the return code is told it succeeded.

Setup then fell through to its next check and reported `The existing .venv uses
an unsupported Python`. That is the wrong diagnosis and it sends the reader
somewhere useless: the environment does not use an unsupported Python, it has no
Python at all, and installing one will not fix it.

- `scripts/setup.sh` and `scripts/setup.ps1` now rebuild in place with `--clear`
  when the interpreter is missing and the directory exists, and say so while
  doing it. `--clear` discards the environment and never the project.
- If a rebuild still leaves no interpreter, the message says to delete the
  directory rather than blaming the Python version.
- The version complaint is now reachable **only when there really is a working
  interpreter of the wrong version**.
- `scripts/tests/test_setup_venv_repair.py` pins the `venv` behaviour the
  workaround exists for, that each script rebuilds, and the order of the two
  messages. It asserts the outcome rather than the return code, because that
  varies with pip. Removing `--clear` from either script fails the suite.

**Verified** by reproducing the failure and repairing this checkout's own
`.venv`, which had been pointing at a removed Xcode Python: 154 tests pass from
the repository root and 133 from `backend/`, and `import app` works from an
unrelated directory again.

## 0.4.0 — Major update: HarmonyForge neural-harmony research preview (2026-07-28)

This major update turns the research plan into an executable model, artifact,
API, and UI-safety foundation. It does **not** bundle a trained checkpoint or
claim completed musical-quality evaluation. Normal users continue to have the
empirical corpus and deterministic theory engine.

### Added — HarmonyForge-BiMask

- Added a deterministic tokenizer that aligns melody, metre, form, edit masks,
  and locked harmony to sixteenth-note frames.
- Implemented a 12-layer, hidden-768, 12-head, FFN-4096, pre-norm/GELU
  single-encoder Transformer with factorized event, root, quality, inversion,
  bass, extension, function, and cadence heads.
- The implemented module has **104,567,874 parameters**. v0.4 uses learned
  window-position and bar/metrical-position embeddings plus a bias-free
  8→768 projection for existing-extension multi-hot conditioning.
  Rotary/relative attention remains a future comparison experiment.
- One forward processes one tokenizer window at batch size 1. The requested
  1–32 candidates are seeded samples from shared logits; candidate count is not
  execution batch size.
- The same checkpoint runs on CUDA, Apple Metal/MPS, or CPU. Device selection
  now uses real tensor probes and records dtype, device, and explicit
  accelerator-to-CPU fallback provenance. v0.4 does not shrink batches on OOM.

### Added — strict artifacts and API v2

- Only the fixed `manifest.json`, `data-manifest.json`, and
  `harmonyforge-bimask-base-v1.safetensors` location is accepted. Architecture,
  actual config/checkpoint/data-manifest-file SHA-256 values, the fixed
  tokenizer digest, training/evaluation status, PyTorch/app/API versions, and
  precisions are checked before loading. Before export, the compiler also
  verifies the ledger and split/vocabulary/statistics artifact hashes. Dataset
  rights and leakage review remain separate training gates.
- Added `POST /api/v2/harmony/generate`,
  `GET /api/v2/jobs/{requestId}`,
  `POST /api/v2/harmony/cancel/{requestId}`, and
  `GET /api/v2/models/{modelId}/manifest`.
- Jobs publish candidates atomically. Cancellation, timeout, rejected
  checkpoints, or inference errors do not leave partial candidates. Responses
  keep request, seed, model, checkpoint, and device provenance.
- Research-only checkpoints require
  `MTC_ENABLE_RESEARCH_CHECKPOINT=1`. The deterministic development fixture
  requires `MTC_ENABLE_NEURAL_MOCK=1` and remains labeled `MOCK`,
  `trained: false`, and `notEvaluated` in both API and UI.

### User workflow and safety

- Select a ChordLane range, choose chords-only plus Auto / MPS / CUDA / CPU,
  and the editor requests three A/B/C proposals as a background job. Playback
  and manual editing remain available. The status area exposes progress,
  elapsed time, real device, fallback reason, and Cancel. Accelerator failure
  offers a CPU retry for the same range.
- Server candidates arrive with `hardRuleValidation: pendingClient` and
  `adoptable: false`. Only candidates accepted by the existing schema, theory,
  voicing, 88-key/hand, and all-track validators become previews.
- Auditioning a preview does not change the project. Only explicit Apply writes
  a validated candidate into project history, where it can be undone.
  Compatible newer edits are rebased/revalidated and labeled `Rebased`;
  context-stale results, cancellation, or failure leave the song unchanged.
- Without a trained HarmonyForge checkpoint, generation safely falls back to
  the empirical corpus, browser ranking, and deterministic theory paths.

### Distribution, CI, and known limitations

- The normal backend lock and CI job stay torch-free. A separate neural CPU job
  uses pinned optional dependencies to test model construction, checkpoint
  rejection, API/cancel/mock behavior, and the preview contract.
- CPU, CUDA, and macOS acceleration locks pin PyTorch 2.13.0 and SafeTensors
  0.8.0. DirectML is an ONNX-ranker runtime, not a v0.4 HarmonyForge device.
- The normal `setup.sh` / `setup.ps1` flow now installs pinned PyTorch too,
  probes macOS MPS, NVIDIA CUDA, or CPU with a real tensor operation, and keeps
  CPU plus Browser/Theory fallback available when acceleration fails.
- The CPU Docker image contains the optional neural runtime, but HarmonyForge
  is available only when a valid trained checkpoint is mounted read-only. The
  optional CUDA Compose overlay also requires a host NVIDIA driver and NVIDIA
  Container Toolkit.
- Dataset compilation, closed-test evaluation, ablations, CUDA/MPS/CPU parity,
  and listening studies remain release gates. A mock response or parameter
  count is not evidence of musical quality.
- Primary references are AutoHarmonizer, ReaLchords, Stochastic Control
  Guidance, and full-to-full curriculum masking. Architecture diagrams,
  adopted ideas, repository-specific integration, and the complete primary
  bibliography are documented in
  [English](docs/neural-harmony-architecture.en.md) and
  [Japanese](docs/neural-harmony-architecture.ja.md).

## 0.3.0 — Research-grounded engine and empirical harmony (2026-07-27)

v0.3 replaced undocumented scalar heuristics with separated hard theory
constraints, empirical POP909 n-gram likelihood, and explicit user preference.
It also added the retrainable corpus boundary, advanced harmony/rhythm/form
features, multi-track validation, responsive LAN use, and release evidence
gates. See the [complete Japanese entry](CHANGELOG.md)
for the detailed historical record.
