# HarmonyForge neural chord model: implementation plan

[日本語](neural-chord-model-plan.ja.md) | **English**

Status: v0.4 research-preview foundation implemented; training and musical
quality evaluation not yet run

Target release family: 0.4.x research previews, 1.0 only after listening tests

Runtime targets: NVIDIA CUDA, Apple Metal via PyTorch MPS, CPU fallback

Interpretation note: “Meta environment” is treated as Apple Metal/MPS. If Meta
AI hardware or AudioCraft was intended, it is a different target and must be
designed separately.

## Implementation status (v0.4.0)

This document includes a research plan, so implemented behavior and proposed
experiments are kept separate. v0.4.0 implements the tokenizer, a
104,567,874-parameter PyTorch module, factorized heads, the SafeTensors
checkpoint gate, CUDA/MPS/CPU adapters, asynchronous API v2, cancellation, a
mock fixture, and the preview safety boundary. It does not bundle a trained
checkpoint, and closed-test evaluation, ablations, and listening tests remain
outstanding.

The v0.4 neural request conditions only on melody, tonality, meter/range, the
edit mask, and fixed existing harmony. Form plus style, mood, density,
complexity, exploration, and contour in section 4 are target research inputs,
not silent controls of the current model; the UI labels them as theory
generator/fallback settings.

The implemented model uses learned window-position embeddings plus bar and
metrical-position embeddings. It does not implement rotary or relative
positional attention. Those mechanisms, sparse attention, SCG-style stepwise
guidance, and a causal student remain comparison experiments, not current
features. The exact implementation/prior-work boundary is recorded in the
[neural harmony architecture note](../neural-harmony-architecture.en.md).

## 1. Decision

Build one device-agnostic PyTorch model and one weight format. Do not train a
“CUDA model” and a separate “Metal model.” Device adapters select kernels,
precision, batching, and memory policy:

```text
same tokenizer + same architecture + same checkpoint
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
       CUDA adapter   MPS adapter   CPU adapter
       BF16 / FP16    FP16 / FP32   FP32 / BF16
```

The model proposes variable-rhythm chord sequences from melody and structural
controls. The existing deterministic theory engine remains the authority for
cadences, applied-chord resolution, project safety, voicing, and final
validation.

This ordering is mandatory:

1. immutable user locks and project schema;
2. hard theory constraints;
3. neural conditional likelihood;
4. empirical corpus likelihood;
5. explicit user preference;
6. seeded tie-break.

No learned score may legalize a hard-constraint failure.

## 2. Research question

Can a single bidirectional neural harmonizer:

- use the entire visible melody rather than only its past;
- generate both chord identity and harmonic rhythm;
- inpaint selected bars without regenerating the whole song;
- preserve locked chords and section boundaries;
- improve perceived fit and variety over the deterministic engine and the
  existing POP909 n-gram ranker;
- produce equivalent musical decisions on CUDA and MPS within declared
  numerical tolerance;
- remain usable when either accelerator is unavailable?

## 3. Why this model family

### 3.1 Adopt

- **Sixteenth-note harmonic frames** from AutoHarmonizer: chord change position
  must be modeled rather than fixed at one chord per bar.
- **Masked bidirectional harmonization**: full-song and partial regeneration
  both require right context. A decoder-only next-token model is a poor match
  for replacing bars 5–8 while keeping bars 1–4 and 9–16 fixed.
- **Full-to-full masking curriculum**: keep all harmony hidden during part of
  training so the network cannot ignore melody and solve the task using only
  previous chords.
- **Factorized chord heads** instead of a flat 1,462-class vocabulary: root,
  quality, inversion, bass, and extensions remain inspectable and can express
  combinations absent from training.
- **Forward-only rule evaluation** inspired by stochastic control guidance:
  the production validator can guide or reject samples without being made
  differentiable.
- **Offline-teacher distillation** inspired by ReaLchords for a later low-latency
  mode. The first production model is offline/bidirectional because the editor
  knows the selected melody span.

### 3.2 Do not adopt as the primary path

- Audio-token models such as MusicGen: the application edits symbolic notes,
  ticks, chords, and tracks. Generating audio would destroy editability.
- DeepBach as a general pop harmonizer: its Gibbs-style constrained generation
  is important prior art, but the training domain and four-part chorale output
  do not match variable-rhythm lead-sheet harmony.
- An untrained MLP labeled “AI”: a runtime test is not an empirical music model.
- Reinforcement learning in phase 1: reward misspecification can amplify a
  metric without improving music. Supervised masked modeling and human
  evaluation come first.
- Separate CUDA and MPS checkpoints: they would confound model quality with
  device-specific training and double the validation burden.

## 4. Task definition

### 4.1 Inputs

| Stream | Fields |
| --- | --- |
| Melody | onset tick, duration tick, key-relative pitch class, octave, velocity bin, role, tie |
| Meter | PPQ, time signature, bar, beat, sixteenth slot, metrical strength |
| Tonality | active key, mode, section modulation, optional melody mode |
| Form | section kind, phrase boundary, cadence target, loop boundary |
| Controls | style, mood, harmonic density, complexity, exploration, contour |
| Existing harmony | locked chord factors; mask elsewhere |
| Edit mask | generate, preserve, or condition-only for every slot |

All musical positions remain integer ticks. Training data is converted to the
same PPQ contract as the application before quantization.

### 4.2 Outputs

At each harmonic frame:

| Head | Vocabulary |
| --- | --- |
| Event | `NO_CHORD`, `HOLD`, `CHANGE` |
| Root | 12 key-relative semitone classes |
| Quality | current application `ChordQuality` vocabulary plus `OTHER` |
| Inversion | root, 1st, 2nd, 3rd; analysis-only `other` is rejected by product decoding |
| Bass | 12 root-relative pitch classes; offset 0 is the root |
| Extensions | multi-label 6, 9, b9, #9, 11, #11, 13, b13 |
| Function auxiliary | tonic, predominant, dominant, other |
| Cadence auxiliary | none, authentic, plagal, half, deceptive, loop |

`HOLD` avoids repeating full chord labels on every sixteenth. Chord factors are
emitted only at `CHANGE`; this prevents long notes from dominating the loss.

### 4.3 Output conversion

The neural output never writes directly into `GeneratedComposition`.

```text
model factors
  → typed NeuralHarmonyCandidate
  → token/schema validation
  → chord construction
  → existing progression validation
  → voicing + melody/all-track validation
  → preview candidate
  → explicit user Apply
```

An invalid or interrupted candidate is discarded as a unit.

## 5. Architecture

Working name: **HarmonyForge-BiMask**

### 5.1 Base model

- single-encoder Transformer;
- melody and harmony occupy aligned but separately typed tokens;
- learned window-position, stream, bar, metrical-position, section, and
  edit-mask embeddings;
- a bias-free 8→768 projection for existing-extension multi-hot conditioning;
- 12 layers, hidden size 768, 12 attention heads, FFN size 4096;
- pre-norm, GELU, dropout 0.1;
- maximum 128 bars in v1, windowed by section for longer projects;
- factorized output heads sharing the final hidden state;
- **104,567,874 parameters**, regression-checked with the same formula as the
  implemented module.

The large research variant may use 24 layers and hidden size 1024 only after the
base model beats baselines. Capacity alone is not evidence of better harmony.
Rotary or relative positional attention remains a research variant to compare
against the implemented learned embeddings on the same data split and parameter
budget.

### 5.2 Hierarchical context

Every bar receives a summary token. Local harmonic frames attend to:

1. all melody tokens in the same and neighboring bars;
2. all bar summary tokens in the selected section;
3. locked harmony tokens anywhere in the generation window.

This keeps local melody/chord alignment while exposing section-level direction
and cadence. Dense global attention remains the correctness baseline. Sparse
attention is an optimization only after equality tests.

### 5.3 Masking curriculum

Training batches are deterministically assigned to:

- full harmony masked;
- one contiguous bar range masked;
- several disjoint ranges masked;
- random individual harmony frames masked;
- suffix masked for optional live/causal distillation.

The full-mask share and schedule are experimental factors, not constants chosen
by ear. Evaluation compares full-to-full curriculum against uniform random
masking and causal prediction.

### 5.4 Objective

For active output heads, use the unweighted mean of normalized cross-entropies.
Auxiliary function and cadence heads are reported separately and included only
after ablation. Do not introduce manually tuned musical-loss decimals.

```text
Lprimary = mean(
  Levent,
  Lroot on CHANGE,
  Lquality on CHANGE,
  Linversion on CHANGE,
  Lbass on CHANGE,
  Lextensions on CHANGE
)
```

Class imbalance is handled by documented data sampling or effective-number
class weighting fitted from the training split. Validation chooses neither by
listening to the test set.

### 5.5 Inference

1. Fill requested harmony frames with mask tokens.
2. Run the bidirectional model.
3. Apply schema masks and immutable user locks.
4. Sample a seeded set of complete candidates using temperature/top-p or
   confidence-based iterative unmasking.
5. Evaluate existing non-differentiable theory rules.
6. Reject hard failures.
7. Rank survivors lexicographically using neural mean log probability,
   empirical corpus likelihood, and explicit preference.
8. Return previews with model/device/seed/checkpoint provenance.

The v0.4 implementation requests 32 candidates by default (API range 1–32),
but one model forward processes one tokenizer window at
`candidate_decoding_batch: 1`; candidate variants are sampled from the shared
logits. `candidateCount` and execution batch size are separate values. v0.4
does not shrink a batch after OOM: it records the reason and, when allowed,
falls back from the accelerator to CPU. Adaptive batch shrinking remains a
future measured optimization.

## 6. Constraint integration

### 6.1 Hard masks before sampling

- preserve locked events exactly;
- forbid invalid enum combinations;
- enforce event grammar (`HOLD` requires a previous chord);
- keep requested start/end ticks inside the selected range;
- force declared terminal cadence positions to contain a chord change when the
  theory planner requires one.

### 6.2 Complete-candidate validation

Reuse the current engine for:

- declared and sounding-root resolution of secondary dominants;
- tritone-substitute resolution;
- cadence validity;
- maximum chromatic run;
- section/modulation seam checks;
- fixed-cardinality voice-leading diagnostics;
- 88-key and left/right-hand voicing;
- melody/chord and all-track collision checks.

### 6.3 Rule-guided research variant

The research implementation evaluates forward-only rule guidance during
iterative sampling:

- sample several proposals at each refinement step;
- run a bounded subset of non-differentiable rules;
- resample from proposals that improve the constraint vector;
- never reduce the vector to a single undocumented scalar.

This follows the plug-and-play principle of stochastic control guidance while
keeping the existing TypeScript validator as the auditable source of truth.
Production adoption requires a measured quality gain over final-only rejection.

## 7. Data plan

### 7.1 Allowed sources

| Source | Role | Policy |
| --- | --- | --- |
| POP909 | aligned melody, chord, beat, key; primary supervised set | keep source commit; do not bundle songs |
| AutoHarmonizer/Wikifonia artifacts | reproducibility baseline only | verify every file and weight license before use |
| ChoCo | larger harmony-only pretraining and style analysis | select subsets by their individual licenses |
| user projects | private personalization | opt-in only; never join global training silently |
| generated theory corpus | constraint pretraining/negative examples | label as synthetic; never use as human ground truth |

Data acquisition is not “download everything.” A machine-readable ledger must
record source, version, license, allowed purpose, checksum, split, and removal
procedure.

### 7.2 Leakage prevention

- split by work/song before making windows;
- group duplicate arrangements and transpositions before splitting;
- fingerprint normalized melody and harmony n-grams;
- keep all sections of one song in one split;
- hold out complete keys, styles, and modulation types for robustness tests;
- publish the deduplication threshold and collision counts.

### 7.3 Normalization

- convert chord spelling to canonical factors while preserving the original
  label for audit;
- transpose key-relative training examples only;
- preserve major/minor/mode and modulation boundaries;
- retain unknown/unsupported chords as `OTHER` during analysis, but exclude or
  map them according to a declared coverage rule;
- quantize to sixteenth frames for the model while retaining original ticks for
  alignment-error reporting.

### 7.4 Dataset outputs

```text
datasets/
  manifests/*.json
  processed/<dataset-version>/
    train.index.jsonl
    validation.index.jsonl
    test.index.jsonl
    vocabulary.json
    statistics.json
    data-card.md
```

Raw copyrighted or separately licensed source files stay outside Git.

## 8. CUDA and Metal/MPS execution

### 8.1 Common adapter contract

```python
class NeuralHarmonyBackend(InferenceBackend):
    def load(self) -> None: ...
    def generate(self, request: HarmonyRequest) -> list[HarmonyCandidate]: ...
    def infer(self, inputs: dict) -> dict: ...
    def unload(self) -> None: ...
    def health(self) -> dict: ...
```

The checkpoint manifest declares architecture, vocabulary checksum, data
manifest checksum, PyTorch version, minimum app/API version, and supported
precision. Caller input can select an allowlisted model ID, never a file path.

### 8.2 CUDA

- training: BF16 when supported, otherwise FP16 with `torch.amp.GradScaler`;
- FP32 reference run for numerical checks;
- DistributedDataParallel for multi-GPU, not `DataParallel`;
- gradient accumulation, activation checkpointing, and fused SDPA are
  performance options;
- deterministic research mode uses
  `torch.use_deterministic_algorithms(True)` and a declared SDPA backend;
- fast production mode may use fused attention, but reports that bitwise
  reproduction is not guaranteed;
- v0.4 records real allocation failures and falls back to CPU; candidate-batch
  shrinking and a cache-clear/retry policy remain future performance
  experiments.

### 8.3 Metal/MPS

- Apple silicon, supported macOS, and `torch.backends.mps.is_available()` are
  checked by an actual tensor operation;
- begin with FP32 training/inference parity, then validate FP16;
- keep model operations within standard PyTorch Transformer/SDPA primitives;
- unsupported operations may use explicit CPU fallback in development, but
  production diagnostics must report every fallback;
- monitor MPS allocated memory and expose allocator diagnostics;
- do not disable the MPS high-watermark safety limit merely because capacity is
  not a product constraint;
- v0.4 reports MPS OOM and falls back to CPU; pre-fallback batch reduction is
  not implemented.

### 8.4 Cross-device acceptance

Bit-identical logits are not required across CUDA and MPS. Required:

- identical tokenizer and checkpoint hashes;
- identical hard-constraint pass/fail results;
- top-1 agreement on at least the preregistered threshold;
- top-k overlap and rank correlation with confidence intervals;
- no device-specific invalid schema output;
- comparable human preference within a predefined non-inferiority margin.

Thresholds are fixed in the experiment protocol before viewing the test result.

## 9. API and project contracts

Add API v2 endpoints only when the schema is stable:

```text
POST /api/v2/harmony/generate
POST /api/v2/harmony/cancel/{requestId}
GET  /api/v2/models/{modelId}/manifest
GET  /api/v2/jobs/{requestId}
```

Request envelope includes:

```json
{
  "apiVersion": "2",
  "requestId": "uuid",
  "modelId": "harmonyforge-bimask-base-v1",
  "seed": "user-visible-seed",
  "generationMask": [],
  "lockedHarmony": [],
  "melody": [],
  "controls": {}
}
```

Response candidates include:

- `candidateId`;
- typed chord events;
- neural mean log probability;
- hard-rule vector and pass/fail;
- empirical model score;
- device, dtype, backend, checkpoint SHA-256;
- elapsed stages;
- warnings and fallback reason.

Scores remain separate fields. The client does not receive hidden training
metadata or backend-native tensors.

## 10. UX integration

- “Generate” starts a cancellable background job; playback and manual editing
  continue.
- Stage labels: encoding, neural proposal, theory validation, voicing, ranking.
- Result is always a preview.
- Show `Neural CUDA`, `Neural Metal`, or `Neural CPU`, checkpoint version, and
  whether any CPU operation fallback occurred.
- On failure: composition unchanged; offer retry, CPU, corpus ranker, or
  theory-only actions. Offer a smaller batch only after that future behavior is
  implemented.
- Smartphone uses the desktop server’s model. It does not need a separate
  mobile checkpoint unless future measurements justify one.

## 11. Evaluation protocol

### 11.1 Baselines

1. deterministic theory engine;
2. theory engine + POP909 n-gram ranker;
3. AutoHarmonizer reproduction where license/runtime permits;
4. causal Transformer with matched parameter budget;
5. HarmonyForge without hard constraints;
6. HarmonyForge full system.

### 11.2 Objective metrics

- event/root/quality/inversion accuracy and negative log likelihood;
- note-in-chord ratio, reported but never treated as musical quality alone;
- chord-to-melody onset EMD;
- chord-duration entropy;
- cadence and applied-dominant resolution success;
- hard-violation count by rule;
- functional-transition distribution divergence;
- common-tone and fixed-cardinality voice-leading distributions;
- harmonic-rhythm diversity;
- unique progression and nearest-training-neighbor distance;
- exact/near memorization rate;
- generation latency p50/p95, throughput, peak memory, OOM recovery;
- CUDA/MPS top-k overlap and rank correlation.

### 11.3 Human evaluation

- pairwise, loudness-matched, same soundfont, tempo, melody, octave, velocity,
  and start position;
- musicians and non-musicians analyzed separately;
- questions: melody fit, progression naturalness, directional interest,
  rhythmic fit, overall preference;
- include no-preference;
- randomized candidate side and blinded model identity;
- power analysis before collection;
- mixed-effects analysis with listener and melody as random effects;
- confidence intervals and corrected multiple comparisons.

### 11.4 Ablations

- no melody stream;
- no full-mask curriculum;
- causal instead of bidirectional;
- flat chord vocabulary instead of factor heads;
- no section/bar hierarchy;
- no empirical ranker;
- no hard validator;
- final-only rejection versus stepwise rule guidance;
- POP909 only versus licensed multi-corpus pretraining;
- FP32 versus CUDA BF16/FP16 versus MPS FP16.

## 12. Implementation milestones and gates

### M0 — protocol freeze

- evaluation protocol, dataset ledger, tokenizer schema, metrics, seeds;
- no training until leakage and licensing checks pass.

### M1 — data compiler

- POP909 reproduction;
- split/deduplication tests;
- round-trip tick/chord tests;
- data card.

### M2 — baseline reproduction

- current n-gram baseline;
- matched causal Transformer;
- AutoHarmonizer comparison if reproducible.

### M3 — HarmonyForge-BiMask

- CPU reference training;
- full and range-mask inference;
- deterministic checkpoint and manifest.

### M4 — engine integration

- typed candidate adapter;
- hard validation;
- preview-only UI;
- cancel/retry/fallback.

### M5 — CUDA/MPS

- CUDA mixed precision and DDP;
- MPS operation coverage and memory tests;
- cross-device output study.

### M6 — evaluation

- locked test set;
- three or more training seeds;
- objective metrics and ablations;
- listening study.

### M7 — validated release

- publish only measured result tables;
- release code/config/checksums;
- publish model card and failure cases;
- 1.0 requires non-inferiority on MPS and a significant preference improvement
  over both deterministic and n-gram baselines.

## 13. Required repository structure

```text
backend/app/ml/
  contracts.py
  tokenizer.py
  model.py
  decoding.py
  checkpoint.py
  backends/cuda.py
  backends/mps.py
  backends/cpu.py
training/
  datasets/
  train.py
  evaluate.py
configs/models/
  harmonyforge-bimask-base-v1.yaml
models/
  manifests/
tests/
  unit/
  integration/
  cuda/
  mps/
  cross_device/
```

## 14. Stop conditions

Do not ship the neural model if any of these remain true:

- test leakage or unclear training-data rights;
- lower human preference than the existing deterministic+n-gram system;
- increased hard-theory failures;
- silent MPS CPU fallback;
- device-specific schema differences;
- model output directly overwrites a project;
- cancellation can save a partial candidate;
- evaluation report shows the best seed without all preregistered seeds;
- a larger model is selected only because it is larger.

## 15. Primary references

- Wu et al., AutoHarmonizer: <https://arxiv.org/abs/2112.11122>
- Wu et al., ReaLchords: <https://proceedings.mlr.press/v235/wu24c.html>
- Huang et al., rule-guided diffusion:
  <https://proceedings.mlr.press/v235/huang24g.html>
- Kaliakatsos-Papakostas et al., curriculum masking:
  <https://arxiv.org/abs/2601.16150>
- Kaliakatsos-Papakostas et al., harmony tokenization:
  <https://doi.org/10.3390/info16090759>
- Hadjeres et al., DeepBach:
  <https://proceedings.mlr.press/v70/hadjeres17a.html>
- Wang et al., POP909:
  <https://archives.ismir.net/ismir2020/paper/000089.pdf>
- de Berardinis et al., ChoCo:
  <https://doi.org/10.1038/s41597-023-02410-w>
- PyTorch CUDA semantics:
  <https://docs.pytorch.org/docs/stable/notes/cuda.html>
- PyTorch MPS backend:
  <https://docs.pytorch.org/docs/stable/notes/mps.html>
- Apple, Accelerated PyTorch training on Mac:
  <https://developer.apple.com/metal/pytorch/>
- PyTorch reproducibility:
  <https://docs.pytorch.org/docs/stable/notes/randomness.html>
