# Neural harmonization: prior work and state-of-the-art review

[日本語](neural-harmonization-sota.ja.md) | **English**

Last reviewed: 2026-07-27

Scope: symbolic melody-to-chord generation, constrained harmonization, local
CUDA and Apple Metal/MPS execution

This review is an implementation decision record, not a claim that every paper
is directly comparable. Tasks, datasets, tokenizations, and evaluation
protocols differ substantially.

## 1. Directly relevant systems

| Work | Task / architecture | Useful result | Limitation for this application | Decision |
| --- | --- | --- | --- | --- |
| DeepBach (Hadjeres et al., 2017) | pseudo-Gibbs generation of four-part Bach chorales with positional constraints | demonstrates steerable infilling and preserving fixed notes | chorale domain, fixed voices, not variable-rhythm lead-sheet chords | retain as constrained-generation baseline, do not port as production model |
| AutoHarmonizer (Wu et al., 2021/2024) | recurrent melody-to-chord model on sixteenth-note frames; controllable harmonic density; large flat chord vocabulary | directly models flexible harmonic rhythm and melody timing | legacy Keras/TensorFlow stack; flat vocabulary; limited long-range/inpainting behavior | reproduce as the principal historical baseline |
| DeepChoir (Wu et al., 2022/2023) | Transformer chorale generation conditioned on melody and chord progression | shows chord-token conditioning can control four-part harmonization | generates voices from supplied chords rather than generating the chord plan needed here | use only when later training voicing/arrangement models |
| ReaLchords (Wu et al., ICML 2024) | online autoregressive accompaniment; offline teacher, knowledge distillation, reinforcement learning reward models | addresses recovery, latency, temporal coordination, and live accompaniment | online past-only information is weaker than an editor that knows future melody; RL adds reward-risk | reserve teacher-to-online-student distillation for a later live mode |
| Rule-guided diffusion / SCG (Huang et al., ICML 2024) | latent symbolic diffusion with forward-only, non-differentiable rule guidance | enables existing rule functions to guide sampling without gradients | paper targets broader symbolic piano-roll generation; iterative cost is high | evaluate as a plug-in sampling variant after the masked baseline |
| MelodyT5 (Wu et al., 2024) | encoder-decoder score-to-score multi-task Transformer on ABC; 261.9K melodies and over one million task instances | multi-task transfer can help data-scarce symbolic tasks | ABC/task representation does not match the app’s tick/chord schema; broad pretraining complicates licensing and conversion | consider later pretraining, not phase-1 architecture |
| EMO-Harmonizer (Huang and Yang, 2024) | key-aware functional representation with Transformer conditioning | supports key-adaptable harmony and explicit affect control | emotion labels and melodic variation are additional tasks; not the first correctness bottleneck | reuse key-relative representation concepts; defer emotion head |
| B* constrained decoding (Kaliakatsos-Papakostas et al., 2025) | beam/A*/backtracking to force exact chord constraints at positions | makes the difficulty of satisfying fixed future chords explicit | worst-case exponential brute-force search | benchmark exact lock satisfaction; prefer direct mask conditioning |
| Encoder-Only Transformers for Melodic Harmonization (Kaliakatsos-Papakostas et al., PMLR 2026) | non-autoregressive single-encoder model on synchronized melody-harmony grid | single encoder outperformed dual encoders with fewer parameters; supports fixing chords at arbitrary positions | published setup is narrower than this app’s variable quality, section, style, and harmonic-rhythm controls | adopt as the primary architectural starting point |
| Curriculum Masking / “Pay (Cross) Attention to the Melody” (Kaliakatsos-Papakostas et al., 2026 preprint) | full-to-full masking curriculum for single-encoder harmonization | reports that keeping harmony fully masked early strengthens melody use and out-of-domain behavior | recent preprint; exact curriculum must be reproduced rather than assumed | make full-mask curriculum a preregistered ablation |
| HarmonyTok (Kaliakatsos-Papakostas et al., Information 2025) | comparison of full-symbol, root/quality, pitch-class-set, and root-aware tokenizations | no representation dominates every goal; spelling-based forms better preserved rhythm/alignment while chunkier tokens better matched source style | task-specific results do not directly validate this app’s richer chord schema | compare factorized heads against full-symbol tokens before freezing schema |
| Function Alignment (Jiang et al., 2025 preprint) | pretrained symbolic LM plus lightweight adapters for music-to-music tasks | suggests parameter-efficient transfer across recognition and conditional generation | requires compatible pretrained LM and representation | later experiment after the direct harmonizer baseline |

## 2. What is currently the strongest fit

For an offline editor with arbitrary locked ranges, the 2026 encoder-only,
non-autoregressive line of work is a closer match than an autoregressive model:

- the entire melody is visible;
- chords can be fixed at arbitrary positions;
- a selected range can be masked and regenerated;
- the same operation covers whole-song generation and inpainting;
- a synchronized time grid matches the current tick-aligned UI.

Therefore phase 1 uses a **single-encoder masked Transformer**, not an LSTM, GAN,
audio model, or decoder-only LLM.

This is an architectural hypothesis, not a result for this repository. It must
beat matched baselines on the same splits and listening protocol.

## 3. Elements combined in the proposed implementation

| Requirement | Research basis | Planned mechanism |
| --- | --- | --- |
| variable chord changes | AutoHarmonizer | sixteenth-note harmonic frames with `HOLD` and `CHANGE` |
| see future melody | encoder-only harmonization | bidirectional single encoder |
| partial regeneration | DeepBach; encoder-only harmonization | arbitrary harmony mask plus immutable locked tokens |
| stronger melody dependence | full-to-full curriculum | full-mask and range-mask training schedules |
| inspectable chord output | HarmonyTok and existing schema | factorized event/root/quality/inversion/bass/extensions heads |
| hard theory rules | SCG; current validator | token masks, final rejection, optional forward rule guidance |
| live mode | ReaLchords | later offline-teacher to causal-student distillation |
| sparse-data transfer | MelodyT5; Function Alignment | later multi-task/pretrained adapter experiment |
| user control | AutoHarmonizer; B* | density controls, fixed chord positions, edit mask |

The combination is deliberately staged. The first model does not include RL,
diffusion, multi-task pretraining, and live distillation simultaneously because
their effects would be impossible to attribute.

## 4. Tokenization decision

The production schema needs chords beyond simple major/minor triads, including
borrowed chords, applied dominants, inversions, slash basses, suspensions, and
extensions. A single flat class has two problems:

1. vocabulary growth and rare-class sparsity;
2. inability to represent a legal factor combination unseen in training.

The initial design therefore predicts:

```text
event × root × quality × inversion × bass × extensions
```

The decision is not final until evaluated against:

- full chord-symbol token;
- root-plus-quality token;
- pitch-class-set token;
- factorized multi-head output.

Evaluation includes exact chord accuracy, pitch-class-set F1, calibration,
invalid-combination rate, rare-chord recall, and human preference.

## 5. Constraint strategy comparison

| Strategy | Advantage | Risk | Phase |
| --- | --- | --- | --- |
| condition on locked chord tokens | efficient and natural for masked models | model may still produce invalid surrounding resolutions | production baseline |
| mask impossible factor combinations | prevents schema errors before sampling | cannot express long-range theory by itself | production baseline |
| final full validator rejection | reuses audited engine; simple | wastes samples when rejection is high | production baseline |
| repair invalid candidate | can recover useful material | repair may move away from learned distribution | preview-only experiment |
| B*/backtracking | exact positional satisfaction | worst-case exponential | benchmark |
| SCG-style forward rule guidance | can steer non-differentiable constraints during sampling | repeated rule evaluation, algorithmic complexity | research ablation |
| differentiable theory loss | fast at inference | incomplete proxy may be gamed | not planned until independently validated |

The first release uses conditioning + schema masks + final validator rejection.
SCG-style guidance is promoted only if it improves acceptance and listening
scores at acceptable latency.

## 6. Data landscape

### POP909

POP909 provides aligned symbolic melody, accompaniment, beat, key, and chord
information for 909 pop songs. It already powers the repository’s aggregate
n-gram model and is the first supervised harmonization dataset.

Use:

- train/validation/test split by song before windowing;
- key-relative transposition;
- sixteenth-frame melody/harmony alignment;
- modulation-aware segmentation;
- no raw songs in Git.

Risk: one pop corpus cannot establish generality across jazz, classical, game
music, or non-Western tonal systems.

### ChoCo

ChoCo standardizes more than 20,000 harmony annotations from heterogeneous
collections. It is useful for harmony-only pretraining and distribution
analysis. Individual source subsets retain different license conditions, so
the project must allowlist subsets rather than treating “ChoCo” as one blanket
license.

Use:

- chord-language pretraining;
- style/domain held-out evaluation;
- vocabulary coverage analysis.

Not enough by itself: many records lack aligned symbolic melody, so they cannot
train the primary melody-conditioned objective without a separate pairing.

### Wikifonia / AutoHarmonizer

Use only for reproducibility after verifying the exact artifact and permitted
redistribution. Do not silently merge it with POP909 and call the result an
open model.

### User projects

Local feedback and projects are private by default. They may train a personal
adapter only after explicit opt-in. They are never uploaded to a global corpus
by normal application use.

## 7. Evaluation lessons from prior work

ReaLchords reports:

- note-in-chord ratio;
- chord-to-note onset synchronization using distribution distance;
- chord-duration entropy;
- listening comparisons.

These are adopted as partial measurements, not a complete definition of music.
Note-in-chord alone rewards bland chord choices and can penalize valid
non-chord tones.

The proposed evaluation adds:

- cadence and applied-dominant resolution;
- hard-rule violation vector;
- functional transition distributions;
- voice-leading distributions;
- novelty and nearest-training-neighbor checks;
- melody-fit, naturalness, direction, rhythmic fit, and overall preference in
  controlled A/B listening;
- cross-device CUDA/MPS agreement.

## 8. CUDA and Metal/MPS state

### CUDA

PyTorch’s CUDA backend supports device-agnostic model code, mixed precision,
multiple attention kernels, and DistributedDataParallel. Reproducible mode must
explicitly select deterministic algorithms; fused attention backends may have
different backward determinism and floating-point accumulation.

Implementation consequence:

- train the canonical large runs on CUDA;
- record PyTorch, CUDA, driver, GPU, dtype, SDPA backend, seed, and checkpoint;
- maintain an FP32 reference;
- distinguish deterministic research runs from faster production runs.

### Metal/MPS

PyTorch maps the `mps` device to MPS Graph and tuned Metal kernels. Apple and
PyTorch both document that availability must be tested at runtime. MPS exposes
allocator diagnostics and optional CPU fallback for unsupported operations.

Implementation consequence:

- use standard Transformer/SDPA operations first;
- begin with FP32 parity and then validate FP16;
- report every operation fallback rather than silently calling the run “Metal”;
- preserve allocator safety limits even though model capacity is not a product
  constraint;
- use the same checkpoint and tokenizer as CUDA.

## 9. Concrete recommendation

Implement in this order:

1. POP909 data compiler, split/deduplication report, and tokenization study.
2. AutoHarmonizer reproduction and a matched causal Transformer baseline.
3. single-encoder masked Transformer with synchronized melody/harmony grid.
4. full-mask versus random-mask curriculum ablation.
5. factorized versus full-symbol tokenization ablation.
6. immutable lock conditioning and existing-validator rejection.
7. CUDA mixed-precision training and deterministic reference runs.
8. MPS FP32/FP16 inference, operation coverage, and cross-device comparison.
9. optional SCG-style stepwise rule guidance.
10. optional ReaLchords-style causal student for live accompaniment.

Do not start with a larger model, RL, or diffusion before steps 1–8 establish a
credible baseline.

## 10. Primary sources

- DeepBach:
  <https://proceedings.mlr.press/v70/hadjeres17a.html>
- AutoHarmonizer:
  <https://arxiv.org/abs/2112.11122>
- DeepChoir:
  <https://arxiv.org/abs/2202.08423>
- ReaLchords:
  <https://proceedings.mlr.press/v235/wu24c.html>
- Symbolic Music Generation with Non-Differentiable Rule Guided Diffusion:
  <https://proceedings.mlr.press/v235/huang24g.html>
- MelodyT5:
  <https://arxiv.org/abs/2407.02277>
- Emotion-Driven Melody Harmonization:
  <https://arxiv.org/abs/2407.20176>
- Incorporating Structure and Chord Constraints:
  <https://arxiv.org/abs/2512.07627>
- Encoder-Only Transformers for Melodic Harmonization:
  <https://proceedings.mlr.press/v303/kaliakatsos-papakostas26a.html>
- Pay (Cross) Attention to the Melody:
  <https://arxiv.org/abs/2601.16150>
- HarmonyTok:
  <https://doi.org/10.3390/info16090759>
- Function Alignment:
  <https://arxiv.org/abs/2506.15548>
- POP909:
  <https://archives.ismir.net/ismir2020/paper/000089.pdf>
- ChoCo:
  <https://doi.org/10.1038/s41597-023-02410-w>
- PyTorch CUDA semantics:
  <https://docs.pytorch.org/docs/stable/notes/cuda.html>
- PyTorch reproducibility:
  <https://docs.pytorch.org/docs/stable/notes/randomness.html>
- PyTorch MPS backend:
  <https://docs.pytorch.org/docs/stable/notes/mps.html>
- Apple accelerated PyTorch training on Mac:
  <https://developer.apple.com/metal/pytorch/>
