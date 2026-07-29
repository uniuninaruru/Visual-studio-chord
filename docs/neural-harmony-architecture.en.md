# HarmonyForge neural-harmony preview architecture

[日本語](neural-harmony-architecture.ja.md) | **English**

Status: v0.4 research-preview foundation. The model implementation and API
contract exist, but this repository does not bundle a trained checkpoint or
completed quality evaluation.

## User safety contract

- Neural output is always a candidate and never writes directly to the project.
- A candidate remains `adoptable: false` until the existing TypeScript theory,
  schema, voicing, and all-track validators accept it.
- Only an explicit Apply action may copy a validated preview into the song.
- Cancellation, a missing checkpoint, inference failure, or schema rejection
  never stores a partial candidate.
- The development mock is reported as `mock: true`, `trained: false`, and
  `evaluationStatus: notEvaluated`; it is not presented as a trained neural model.
- A normal checkout without a trained checkpoint continues to use the empirical
  corpus and deterministic theory paths.

## Implemented path

```mermaid
flowchart TD
    UI["React editor<br/>range, melody, locks, seed"] --> API["FastAPI API v2<br/>asynchronous preview job"]
    API --> REGISTRY{"Allowlisted model"}
    REGISTRY -->|trained manifest + checkpoint| TOKENIZER["Deterministic tokenizer<br/>sixteenth frames, key relative"]
    REGISTRY -->|explicit development mode only| MOCK["Mock backend<br/>mock=true / trained=false"]
    TOKENIZER --> MODEL["HarmonyForge-BiMask<br/>single-encoder Transformer"]
    MODEL --> HEADS["Factorized heads<br/>event / root / quality / inversion / bass / extensions"]
    HEADS --> DECODE["Seeded decoding<br/>preserve locks and schema masks"]
    MOCK --> ATOMIC["Atomic candidate publication"]
    DECODE --> ATOMIC
    ATOMIC --> VALIDATE["Existing TypeScript theory, voicing, and all-track validation"]
    VALIDATE -->|pass| PREVIEW["A/B/C previews"]
    VALIDATE -->|reject or cancel| DISCARD["Discard the whole candidate<br/>song unchanged"]
    PREVIEW -->|explicit Apply| PROJECT["Committed project + Undo history"]
```

`POST /api/v2/harmony/generate` creates a job and
`GET /api/v2/jobs/{requestId}` reports progress.
`POST /api/v2/harmony/cancel/{requestId}` cooperatively interrupts the job and
rechecks cancellation immediately before publishing completed candidates.
`GET /api/v2/models/{modelId}/manifest` exposes model availability and provenance.

## Implemented v0.4 model

| Item | Implementation |
| --- | --- |
| Model ID | `harmonyforge-bimask-base-v1` |
| Family | Bidirectional masked Transformer with time-aligned melody and harmony |
| Encoder | 12 layers, hidden 768, 12 heads, FFN 4096, pre-norm, GELU |
| Position | Learned position within each 256-frame window, plus bar and sixteenth-position embeddings |
| Context | Melody tokens, harmony tokens, and bar-summary tokens |
| Extension conditioning | Existing extension multi-hot vector through a bias-free 8→768 projection |
| Output | Factorized event, root, quality, inversion, bass, and extension heads; function/cadence heads are architecture-only and are not trained by the v0.4 reference CLI |
| Size | **104,567,874 parameters**, checked with the same formula as the module |
| Artifact | One `SafeTensors` checkpoint and a strict JSON manifest |
| Devices | The same checkpoint on CUDA, Apple Metal/MPS, and CPU |
| Determinism | Request-local seed material, a fixed tokenizer SHA-256, and stable candidate IDs |

In v0.4, one model forward processes one tokenizer window
(`candidate_decoding_batch: 1`), and the requested 1–32 candidates are sampled
from the shared logits with a seed. API `candidateCount` is not the execution
batch size. OOM batch shrinking is not implemented; the adapter records the
reason and falls back to an allowed CPU path.

The implemented model does **not** use the rotary or relative positional
attention considered in the research plan. v0.4 uses the standard PyTorch
`TransformerEncoder` with learned window-position, bar, and metre embeddings.
Rotary/relative attention, sparse attention, stepwise SCG guidance, and a causal
student remain future research variants, not shipped v0.4 behavior.

## Checkpoint gate

The real model is available only when every check passes:

- the allowlisted filename
  `harmonyforge-bimask-base-v1.safetensors`, `data-manifest.json`, and
  `training-run.json`;
- `trained: true`;
- `evaluationStatus: researchOnly` or `validated`;
- `MTC_ENABLE_RESEARCH_CHECKPOINT=1` for a research-only artifact;
- matching architecture, actual config/checkpoint/data-manifest/training-run
  file SHA-256 values, and the fixed tokenizer digest;
- declared PyTorch version, minimum app/API version, and supported precision;
- CPU-safe `SafeTensors` loading, strict state-dict validation, and only then
  device placement.

Missing, untrained, unevaluated, corrupt, or checksum-mismatched artifacts return
`available: false` or a safe job failure. They never produce a disguised fallback
candidate.

Runtime verifies the exported `data-manifest.json` file itself. Before export,
the compiler binds every ledger source checksum to the exact normalized input
JSONL bytes and verifies the hashes of its split,
vocabulary, and statistics artifacts. Dataset rights and leakage review remain
separate release gates.

## Devices and fallback

```mermaid
flowchart LR
    START["HarmonyForge request"] --> CUDA{"CUDA tensor probe"}
    CUDA -->|available| RUNCUDA["CUDA<br/>BF16 → FP16 → FP32"]
    CUDA -->|different platform| MPS{"MPS tensor probe"}
    MPS -->|available| RUNMPS["Metal/MPS<br/>FP16 → FP32"]
    MPS -->|unavailable| CPU["CPU FP32"]
    RUNCUDA -->|OOM or probe failure<br/>fallback allowed| CPU
    RUNMPS -->|OOM or probe failure<br/>fallback allowed| CPU
    CPU -->|missing checkpoint or inference failure| SAFE["Corpus ranker / deterministic theory"]
    SAFE --> PROJECT["Keep the existing song"]
```

This diagram describes platform selection, not an attempt to run every platform
sequentially on one computer. NVIDIA systems select CUDA, supported Apple Silicon
selects MPS, and other systems select CPU. An accelerator failure moves to CPU
only when the request permits it. If neural CPU inference also cannot complete,
the client retains the song and uses the existing corpus/theory workflow.

`PYTORCH_ENABLE_MPS_FALLBACK=1` is never silently reported as Metal execution.
The adapter moves explicitly to CPU and records a fallback reason in the job and
Diagnostics.

## Ideas adopted from prior work

| Idea | Primary source | Treatment here |
| --- | --- | --- |
| Sixteenth-note frames and variable harmonic rhythm | AutoHarmonizer | Deterministic tick-to-frame alignment |
| Constrained regeneration of arbitrary spans | DeepBach and masked harmonization work | Generate / preserve / condition-only masks |
| Full-to-full masking curriculum | Kaliakatsos-Papakostas et al. (2026) | Training plan; no result is claimed yet |
| Harmony-representation comparison and factorization | Harmony-tokenization research | Multiple output heads instead of one flat class |
| Forward evaluation of non-differentiable rules | Stochastic Control Guidance | Final validator rejection now; stepwise guidance is not implemented |
| Offline teacher and future causal student | ReaLchords | Future variant; v0.4 is bidirectional |
| Aligned melody/chord/beat/key data | POP909 | Data-compiler and evaluation plan; raw songs are not bundled |
| Large heterogeneous harmony annotations | ChoCo | Candidate for future, subset-by-subset licensed pretraining |

## Repository-specific implementation

The following is application-specific integration engineering rather than a
verbatim implementation of a cited algorithm. We do not claim it as a novel
machine-learning method.

- strict API v2 types, allowlisted model IDs, and idempotent request IDs;
- tokenizer/config/checkpoint/data-manifest-file verification gates;
- real CUDA/MPS tensor probes and visible fallback provenance;
- background jobs, cancellation, and atomic candidate publication;
- the `adoptable: false` client-theory-validation boundary;
- preview → Apply → Undo integration with Draft / Committed / History;
- precedence that keeps neural, empirical, and preference scores below hard rules;
- explicit separation of mock, research-only, and validated checkpoints.

## Primary sources and official repositories

- Wu et al., [AutoHarmonizer](https://arxiv.org/abs/2112.11122) /
  [official repository](https://github.com/sander-wood/autoharmonizer)
- Wu et al., [ReaLchords](https://proceedings.mlr.press/v235/wu24c.html)
- Huang et al.,
  [Symbolic Music Generation with Non-Differentiable Rule Guided Diffusion](https://proceedings.mlr.press/v235/huang24g.html) /
  [official repository](https://github.com/yjhuangcd/rule-guided-music)
- Kaliakatsos-Papakostas et al.,
  [full-to-full curriculum masking](https://arxiv.org/abs/2601.16150)
- Kaliakatsos-Papakostas et al.,
  [harmony-tokenization comparison](https://doi.org/10.3390/info16090759)
- Hadjeres et al., [DeepBach](https://proceedings.mlr.press/v70/hadjeres17a.html)
- Wang et al., [POP909 paper](https://archives.ismir.net/ismir2020/paper/000089.pdf) /
  [dataset repository](https://github.com/music-x-lab/POP909-Dataset)
- de Berardinis et al., [ChoCo](https://doi.org/10.1038/s41597-023-02410-w)
- PyTorch:
  [CUDA semantics](https://docs.pytorch.org/docs/stable/notes/cuda.html),
  [MPS backend](https://docs.pytorch.org/docs/stable/notes/mps.html),
  and [reproducibility](https://docs.pytorch.org/docs/stable/notes/randomness.html)
- Apple,
  [Accelerated PyTorch training on Mac](https://developer.apple.com/metal/pytorch/)
- Hugging Face,
  [SafeTensors repository](https://github.com/huggingface/safetensors)

See the
[prior-work and state-of-the-art review](research/neural-harmonization-sota.en.md)
for the research comparison and the
[HarmonyForge implementation plan](research/neural-chord-model-plan.en.md)
for experimental gates.
