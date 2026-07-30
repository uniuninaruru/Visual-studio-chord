# POP909 harmony-only local data card

Status: **v1.0 recipe/contract finalized (2026-07-30)**. No POP909 corpus, normalized
or processed rows, split assignments, or trained weights are distributed by
this repository. A user who elects to run the recipe must obtain POP909 from
upstream and perform preparation, compilation, and training locally.
Full-corpus preparation and compilation have been run against a pinned upstream
checkout; the aggregate dataset results and hashes are recorded below. Full
neural training time, cost, convergence, and quality remain **unmeasured**.

Source review status: **pending for each user-run acquisition**. This card does
not grant a repository-wide `approved` decision.

This card is documentation, not legal advice or a finding that any use is
lawful. It is governed by the
[harmony-only private training policy](harmony-only-private-training-policy.en.md).

## Intended use

The dataset recipe is for private, local harmony-only pretraining and for
validating the deterministic compiler path. Reviewed source inputs are
`harmony`, `key`, `meter`, and `beatTiming`. Emitted training content is limited
to `harmony`, `key`, and `meter`. Beat times are used only to derive the integer
musical grid; raw timestamps in seconds remain local.

It is not evidence of melody-conditioned harmonization, accompaniment,
arrangement, voicing, performance generation, model quality, commercial
clearance, or fitness for production inference. A harmony-only checkpoint must
remain outside the melody-conditioned runtime regardless of research or release
flags.

## Upstream source and review

- Canonical source: [music-x-lab/POP909-Dataset](https://github.com/music-x-lab/POP909-Dataset)
- Citation: Ziyu Wang, Ke Chen, Junyan Jiang, Yiyi Zhang, Maoran Xu, Shuqi Dai,
  Xianbin Gu, and Gus Xia, “POP909: A Pop-song Dataset for Music Arrangement
  Generation,” ISMIR 2020
  ([paper](https://archives.ismir.net/ismir2020/paper/000089.pdf)).
- Version: record the complete 40-character upstream Git commit in the local
  ledger and sanitized receipt. Abbreviated hashes, branches, and tag names
  alone are rejected.

The upstream repository displays an MIT license and the paper is published
under CC BY 4.0. Neither fact is treated here as automatically clearing every
underlying song, arrangement, annotation, training use, output, or weight.
Review the current upstream terms, acquisition method, intended use, and
applicable law before compilation. The preparer's `--license-id` value and an
`approved` ledger status are operator-supplied review records, not
compiler-generated legal conclusions.

## Exact extraction boundary

`scripts/prepare-pop909-harmony-only.py` discovers local POP909 song
directories that contain all three of:

- `beat_audio.txt`: beat time and beat order, used for the beat grid and meter;
- `chord_audio.txt`: chord start, end, and label;
- `key_audio.txt`: key-region start, end, and label.

It must not read or emit MIDI, audio, lyrics, melody, accompaniment, voicing,
instrumentation, performance controls, song titles, artist names, style
metadata, or alternate arrangement tracks. Directory-derived item identifiers
may exist in the private normalized records for provenance, grouping, and
validation, but must never appear in a public receipt.

## Normalization and quantization

`prepare-run.json` records the repository-relative path and exact byte SHA-256
of `scripts/prepare-pop909-harmony-only.py`, the source commit, all
gap/quantization options, counts, and source/normalized hashes. The ledger binds
those exact prepare-run bytes by SHA-256. Compiler 1.2.0 verifies them through
`--prepare-run` before carrying the same binding into the data manifest. The
reference-run preparer SHA-256 is
`bf66a7a8d999b730938a8437046aad45533521224c7175f896c460e360151fc3`.
The pinned preparer is authoritative; this prose is a readable summary.

The current preparer:

- maps seconds to quarter-note ticks by piecewise-linear interpolation over the
  beat anchors;
- accepts complete 3/4 or 4/4 beat-order cycles, uses PPQ 480, and quantizes to
  120-tick sixteenth-note frames;
- takes the intersection of chord and key coverage as the record range, makes
  ticks relative to its start, and rounds to the nearest frame with exact ties
  away from zero;
- snaps adjacent annotation boundaries only when their pre-quantized absolute
  difference is below one frame, then rejects collapsed spans, remaining gaps,
  overlaps, or incomplete coverage;
- splits chords at key boundaries, encodes chord roots relative to key and bass
  relative to chord root, and merges adjacent identical chord events;
- deterministically splits works longer than 128 bars at bar boundaries into
  parts of at most 128 bars, clips chord/key spans at part boundaries, shifts
  them to part-relative ticks, and preserves one shared work/source grouping
  identity across every part;
- rejects `N` regions by default; retaining explicit no-chord gaps requires the
  matching preparer and compiler gap policies. The preparer's
  `allow-no-chord` policy omits `N`-labeled spans from events and preserves
  them as explicit gaps, which the compiler's `allowNoChord` policy accepts.

All raw beat times, source labels, normalized records, and detailed error
locations remain local. A public receipt may report only aggregate exclusion
counts by broad reason.

## Local reproduction recipe

This is not the normal application launch path. It is for people who elect to
build weights on their own machine. CPU is supported, but full-training time
and memory for the 104,567,874-parameter model have not been measured. Apple
GPUs use `mps`; NVIDIA GPUs use `cuda`. They are different devices.

Install dependencies and fetch the pinned annotation subset directly from
upstream:

```bash
# macOS / Linux
./scripts/setup.sh cpu
./.venv/bin/python scripts/fetch-pop909.py
```

```powershell
# Windows 11 PowerShell
.\scripts\setup.ps1 -Acceleration cpu
.\.venv\Scripts\python.exe .\scripts\fetch-pop909.py
```

The next three values are deliberately invalid placeholders. The preparer
stops until the operator reviews the current terms and replaces them with real
UTC timestamps and the identifier supported by that review.

```bash
# macOS / Linux
RETRIEVED_AT_UTC="REPLACE_WITH_YYYY-MM-DDTHH:MM:SSZ"
REVIEWED_AT_UTC="REPLACE_WITH_YYYY-MM-DDTHH:MM:SSZ"
LICENSE_ID="REPLACE_WITH_IDENTIFIER_FROM_YOUR_REVIEW"
OUTPUT="datasets/processed/pop909-harmony-only-v1"
mkdir -p "$OUTPUT"

./.venv/bin/python scripts/prepare-pop909-harmony-only.py \
  --pop909 datasets/raw/POP909-Dataset \
  --output-records "$OUTPUT/records.jsonl" \
  --output-ledger "$OUTPUT/ledger.json" \
  --output-prepare-run "$OUTPUT/prepare-run.json" \
  --source-version d83e6edba6872a704f5d3b8b32f5cb540088dae6 \
  --retrieved-at-utc "$RETRIEVED_AT_UTC" \
  --review-basis license \
  --reviewed-at-utc "$REVIEWED_AT_UTC" \
  --license-id "$LICENSE_ID" \
  --confirm-source-approved \
  --gap-policy allow-no-chord

./.venv/bin/harmonyforge-compile \
  --input "$OUTPUT/records.jsonl" \
  --ledger "$OUTPUT/ledger.json" \
  --prepare-run "$OUTPUT/prepare-run.json" \
  --output "$OUTPUT/compiled" \
  --dataset-id pop909-harmony-only \
  --dataset-version d83e6edba6872a704f5d3b8b32f5cb540088dae6 \
  --content-profile harmonyOnlyV1 \
  --harmony-gap-policy allowNoChord
```

```powershell
# Windows 11 PowerShell
$RetrievedAtUtc = "REPLACE_WITH_YYYY-MM-DDTHH:MM:SSZ"
$ReviewedAtUtc = "REPLACE_WITH_YYYY-MM-DDTHH:MM:SSZ"
$LicenseId = "REPLACE_WITH_IDENTIFIER_FROM_YOUR_REVIEW"
$Output = "datasets\processed\pop909-harmony-only-v1"
New-Item -ItemType Directory -Force $Output | Out-Null

.\.venv\Scripts\python.exe .\scripts\prepare-pop909-harmony-only.py `
  --pop909 .\datasets\raw\POP909-Dataset `
  --output-records "$Output\records.jsonl" `
  --output-ledger "$Output\ledger.json" `
  --output-prepare-run "$Output\prepare-run.json" `
  --source-version d83e6edba6872a704f5d3b8b32f5cb540088dae6 `
  --retrieved-at-utc $RetrievedAtUtc `
  --review-basis license `
  --reviewed-at-utc $ReviewedAtUtc `
  --license-id $LicenseId `
  --confirm-source-approved `
  --gap-policy allow-no-chord

.\.venv\Scripts\harmonyforge-compile.exe `
  --input "$Output\records.jsonl" `
  --ledger "$Output\ledger.json" `
  --prepare-run "$Output\prepare-run.json" `
  --output "$Output\compiled" `
  --dataset-id pop909-harmony-only `
  --dataset-version d83e6edba6872a704f5d3b8b32f5cb540088dae6 `
  --content-profile harmonyOnlyV1 `
  --harmony-gap-policy allowNoChord
```

Full reference training has the following form. A run with `--max-steps 1` must
not be presented as a quality model or training-cost measurement. Resume
support, an appropriately sized baseline, multi-seed comparison, and convergence
criteria remain research gates.

```bash
./.venv/bin/harmonyforge-train \
  --config configs/models/harmonyforge-bimask-base-v1.yaml \
  --data-manifest "$OUTPUT/compiled/data-manifest.json" \
  --model-directory local-models/pop909-pretraining-v1 \
  --source-commit "$(git rev-parse HEAD)" \
  --task harmony_only_pretraining \
  --epochs 1 \
  --device auto

./.venv/bin/harmonyforge-evaluate \
  --config configs/models/harmonyforge-bimask-base-v1.yaml \
  --data-manifest "$OUTPUT/compiled/data-manifest.json" \
  --model-directory local-models/pop909-pretraining-v1 \
  --split validation \
  --device auto \
  --output training/runs/pop909-harmony-only-validation.json
```

On Windows, pass the same arguments to
`.\.venv\Scripts\harmonyforge-train.exe` and
`harmonyforge-evaluate.exe`, using `--source-commit (git rev-parse HEAD)`.
Diagnostic source wrappers are available at `training/train.py`,
`training/evaluate.py`, and `training/datasets/compiler.py` if a console
entrypoint is damaged.

The artifact is installed content-addressably beneath
`local-models/pop909-pretraining-v1/harmonyforge-bimask-base-v1/versions/`.
It is not an inference-model installation. If the application is pointed at
it, Diagnostics reports an installed checkpoint with inference disabled. No
environment variable sends it into melody-conditioned generation. Using the
weights requires a future explicit fine-tune on melody-conditioned data that
exports a separate inference-task artifact. Evaluation alone never promotes
the task.

To publish sanitized receipts without publishing weights, resolve the immutable
version named by the active pointer. `docs/model-reports/pop909-local-run-v1`
must be a new directory; a non-empty existing directory is never overwritten.

```bash
ARTIFACT_ROOT="local-models/pop909-pretraining-v1/harmonyforge-bimask-base-v1"
ARTIFACT_VERSION="$(./.venv/bin/python -c \
  'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["artifactVersion"])' \
  "$ARTIFACT_ROOT/current.json")"
ARTIFACT="$ARTIFACT_ROOT/versions/$ARTIFACT_VERSION"

./.venv/bin/python scripts/export-public-training-receipts.py \
  --manifest "$ARTIFACT/manifest.json" \
  --training-run "$ARTIFACT/training-run.json" \
  --data-manifest "$ARTIFACT/data-manifest.json" \
  --prepare-run "$OUTPUT/prepare-run.json" \
  --output-dir docs/model-reports/pop909-local-run-v1
```

In PowerShell, first set
`$ArtifactRoot = "local-models\pop909-pretraining-v1\harmonyforge-bimask-base-v1"`,
then obtain the same version directory with
`$ArtifactVersion = (Get-Content "$ArtifactRoot\current.json" |
ConvertFrom-Json).artifactVersion`. The three generated JSON files are not
automatically approved for publication. Review their paths, identifiers, and
claim scope before adding them to Git.

## Split and duplicate control

For each eligible upstream song directory, the preparer emits one normalized
record when the work is at most 128 bars, or deterministic bar-aligned parts
when it is longer, and orders all records deterministically. Parts from one
work share the same work/source grouping identity, so the compiler necessarily
keeps them in one split. The preparer does not claim approximate musical
deduplication.

The dataset compiler groups records transitively by work identity, hashed
source-item identity, optional declared duplicate group, and exact normalized
harmony fingerprint. It assigns the complete group to one split, with a
seeded SHA-256 rule, **before** windowing. Current defaults are 80% train, 10%
validation, and 10% test by hash buckets with split seed `1729`; every receipt
must state the actual values. Fingerprint collisions are counted, not deleted.
The method does not detect approximate plagiarism, related arrangements, or
duplicates whose allowed harmony representation differs.

Row-level assignments, group identifiers, fingerprints, and per-song counts
stay local. Public summaries may contain only aggregate split record/window
counts and collision-group counts after checking that they are not identifying.

## Verified full-corpus preparation and compilation

In the verification run, only the three declared annotation files were
sparse-checked out from pinned upstream commit
`d83e6edba6872a704f5d3b8b32f5cb540088dae6`. Of 909 source items, 900 works
were eligible and 9 were excluded for `beatCoverage`. The 900 works produced
1,022 normalized records: 778 unsplit records plus 244 parts created by
splitting 122 works.
This receipt comes from pairing preparer option
`--gap-policy allow-no-chord` with compiler option
`--harmony-gap-policy allowNoChord`; it is not a result for the default
`reject` policy.

Hashes for the reference run:

- source material SHA-256:
  `b8024b91b1229f7d26dd6b2b85aea1c4064cd39909d5b03f858fda4e5f66df5c`;
- normalized JSONL SHA-256:
  `a1427c405b8b9fa646f68d207c9fb2bcdbfb2c00a2f3a15dbb598206d6e935ec`;
- deterministic prepare-run SHA-256:
  `de8f19490ee24f0bf8e27fa3e3282363ee24ab60a825af86112d5654212638a2`;
- reference review-ledger SHA-256:
  `3468da96c988f3265c14aa34cf3f2d40aaff681a86185a15ea124cddbb2dbeb1`.

Source material, normalized JSONL, and prepare-run hashes are reproducibility
targets for the same pinned bytes, script, and options. The ledger contains
honest operator-specific values such as `retrievedAt`, `reviewedAt`, and review
basis. Its value above is therefore specific to the **2026-07-30 reference
review run**. A later operator is not expected to reproduce that ledger byte
hash. Ledger validation checks the schema, full source commit, review
completeness, and prepare-run binding instead.

Compiler results:

| Split | Records | Groups | Windows |
| --- | ---: | ---: | ---: |
| Train | 807 | 708 | 4,566 |
| Validation | 106 | 95 | 606 |
| Test | 109 | 97 | 608 |
| Total | 1,022 | 900 | 5,780 |

All splits contain 1,366,635 frames in total. There were zero exact-fingerprint
collision groups, a maximum record length of 128 bars, and zero split leakage.
Tonality-coverage failures, harmony range/overlap failures, and duplicate IDs
were also all zero.

Local measurements from the reference machine that reproduced the target
hashes in a second temporary output
(Mac17,3, arm64, macOS 27.0 build 26A5388g, Python 3.14.5) were:

| Stage | Wall time | Max RSS | Peak footprint |
| --- | ---: | ---: | ---: |
| Prepare | 1.28 s | 109,920,256 bytes (104.8 MiB) | 98,419,216 bytes |
| Compile | 5.13 s | 736,411,648 bytes (702.3 MiB) | 723,321,840 bytes |

These are one-machine measurements of full-corpus data preparation and
compilation, not minimum requirements, cross-platform timing predictions, or
universal performance guarantees. Energy was not measured. Full neural
training duration, cost, throughput, convergence, and music quality remain
unmeasured.

Fetch, preparation, compiler, receipt, and portable-setup unit tests run in
Windows, macOS, and Linux CI. The canonical network-fetch test is skipped by
default. End-to-end full-corpus fetch/preparation/compilation has been measured
only on the Mac above. “Cross-platform unit tested” is not the same claim as
“full corpus measured on every OS.”

## Known limitations

- POP909 covers 909 popular songs and is not representative of all cultures,
  periods, genres, meters, or harmonic languages.
- The paper describes beat, key, and chord labels as machine-extracted; label
  and alignment errors can enter the normalized data.
- Sixteenth-note quantization removes finer timing, and key-relative
  normalization removes some spelling and tonal context.
- Supported meter, duration, chord-label, and gap policies exclude some source
  records; exclusion can introduce systematic bias.
- Exact fingerprints and upstream folder identity do not establish
  work-level or near-duplicate independence.
- Harmony-only data cannot validate melody conditioning, playable voicing,
  arrangement, orchestration, expression, or perceptual quality.
- There is no evidence yet that the current 104,567,874-parameter
  configuration is appropriate for this corpus size. Before full training, it
  must be compared with a smaller causal-Transformer baseline under the same
  validation, memorization, and training-cost protocol. “Larger” is not a
  selection criterion.
- Source licensing and downstream model treatment can vary by jurisdiction and
  intended use.
- Full POP909 preparation/compilation counts, hashes, split integrity, and
  reference-machine wall time/memory have been measured, but they cannot be
  generalized to other environments. Energy was not measured.
- Full neural training duration, training cost, throughput, convergence, and
  model quality have not yet been measured.

## Reproducibility levels

| Level | Claim |
| --- | --- |
| Compiler receipt | The same pinned upstream bytes, preparer/compiler code, options, and runtime target the same source/normalized/prepare-run hashes. A review ledger is run-specific; compare its schema and bindings. |
| `deterministicConfigured` | One run recorded a seed and deterministic settings. It does not prove checkpoint-byte equality across two independent runs. This is the strongest label public receipt schema v2 can assign automatically. |
| `bitwiseSameRuntime` | A future receipt schema may claim this only after retaining matching checkpoint hashes from **two independent runs** with the same pinned runtime, device class, libraries, code, inputs, configuration, seed, and a complete runtime fingerprint. The current exporter never issues it. |
| `statisticalMetricsOnly` | MPS runs use this level unless a later validated deterministic path proves otherwise. Compare preregistered aggregate metrics and tolerances, not checkpoint bytes. Cross-device comparisons are also statistical. |

A hash mismatch means “not reproduced”; it must not be explained away as an
equivalent run without a separate statistical evaluation.

## M5 MPS smoke receipt

The measured **MPS smoke on an Apple Silicon M5** exercised the MPS path with the
104,567,874-parameter implementation for exactly one optimizer step and wrote
a 418,289,648-byte checkpoint that was reloaded and structurally validated.
The output is explicitly `trained: false`, `publishable: false`, and
`runtimeCompatible: false`.
CUDA was not used in this measurement; it is a separate NVIDIA-hardware gate.

This smoke proves only one optimizer step, export, and reload through the wiring
and serialization path. It does **not** establish full-training time, training
cost, throughput, convergence, model quality, or a usable model. The untrained
checkpoint must not be used or distributed. MPS backward reported no strict
deterministic implementation for an exercised operation, so this observation
is `statisticalMetricsOnly`, not `bitwiseSameRuntime`.

## Privacy and distribution

Raw checkout, normalized JSONL, detailed ledger, processed splits, the local
`data-manifest.json`, optimizer state, logs, evaluation rows, run directories,
and checkpoints stay local and untracked. In particular, the local data
manifest contains row assignments and must not be published unchanged.

The repository may publish only the recipe, configuration, compiler/CLI source,
this card, and reviewed sanitized receipts. Under policy A, neither raw or
processed data nor weights are redistributed. A receipt may contain only
dataset-level
provenance, immutable versions and hashes, aggregate counts/distributions,
configuration/runtime hashes, and an accurately scoped reproducibility label.
It must not contain per-song sequences or IDs, row-level assignments,
fingerprints, rare reconstructive n-grams, local paths, credentials, or model
bytes. Checkpoint hashes may be recorded for reproducibility; they do not make
the corresponding weights distributable.

The public receipt schema v2 hash chain establishes only **unsigned internal
consistency** among the supplied manifest, training run, data manifest,
prepare run, and checkpoint bytes. It does not authenticate the author,
acquisition source, actual training execution, legal review, or music quality,
and it does not resist an attacker who rewrites every file and recomputes the
hashes. Receipts therefore state
`integrityScope: unsignedInternalConsistency`,
`authenticityClaimed: false`, and
`weightsIncludedInThisReceipt: false`. When the initial warm-start artifact
itself is not supplied, they also state
`initialCheckpointBindingVerified: false`. The three public JSON files are
read back from a sibling staging directory and installed as one directory; an
existing non-empty run directory is never overwritten.

No personal data is intentionally extracted. That is not a guarantee that the
upstream checkout or local metadata contains none; protect local storage,
backups, logs, and uploads accordingly.

## Revocation and rebuild

If the source, terms, provenance decision, or checksum is revoked or changes:

1. stop new compilation and training;
2. mark the dataset-level public receipt revoked or superseded without adding
   source-item details;
3. identify affected local datasets and runs by dataset-level hashes;
4. delete the local checkout, normalized and processed data, detailed ledger,
   checkpoints, optimizer state, logs, and derived run artifacts;
5. repeat review and rebuild only from sources that remain approved.

Deleting a public weight is not a remedy because this policy never permits
publishing one.

## Validation checklist

- [ ] The user obtained POP909 directly from canonical upstream and pinned the
  full 40-character commit.
- [ ] A human review recorded reviewed source inputs
  (harmony/key/meter/beatTiming), emitted training content
  (harmony/key/meter), purpose, basis, timestamps, and removal procedure; no
  default license value was accepted without review.
- [ ] Only the three declared annotation files were opened by the preparer.
- [ ] Prepare-run, script SHA-256, options, source-material hash, normalized
  hash, compiler version, tokenizer hash, and configuration hash were recorded.
- [ ] Compiler 1.2.0 verified the ledger → prepare-run → data-manifest SHA-256
  binding.
- [ ] Quantization and gap policies match between preparation and compilation.
- [ ] Reproduction of this verification receipt explicitly uses the
  `allow-no-chord`/`allowNoChord` pair and is not confused with a default
  `reject` run.
- [ ] Exclusions, coverage, meter, maximum length, chord vocabulary, and
  dataset-level aggregate counts were reviewed.
- [ ] Duplicate/work groups stay in one split and splitting occurred before
  windowing.
- [ ] Every local artifact hash verifies before training.
- [ ] The public receipt was separately sanitized: no per-song sequence or ID,
  split assignment, fingerprint, rare n-gram, local path, credential, or model
  binary remains.
- [ ] Repository private-artifact checks pass, including inspection of tracked
  files rather than relying on filename extensions.
- [ ] A single run is not labeled more strongly than
  `deterministicConfigured`; `bitwiseSameRuntime` is absent without independent
  two-run evidence.
- [ ] The unsigned hash chain is not described as authentication, and
  unverified bindings plus non-inclusion of weights are explicit.
- [ ] The M5 one-step smoke is labeled untrained and unpublishable and is not
  cited as training cost or quality.
- [ ] Verified full-corpus preparation/compilation aggregates, hashes, and
  reference-machine measurements are not conflated with universal performance
  requirements or with full neural training time, cost, or quality.
