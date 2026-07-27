# Research-grounded engine rewrite

This document is the evidence gate for replacing the current generation engine.
An implementation is not accepted merely because it sounds plausible for a few
seeds. Every musical objective must be one of:

1. a hard data invariant;
2. a published theory reproduced by a focused test;
3. a statistic estimated on a declared corpus and validated out of sample; or
4. an explicit user preference learned from Like/Dislike or A/B choices.

## Source ledger

| Area | Source | Implementation use | License / use |
| --- | --- | --- | --- |
| Tonal hierarchy and tension | Navarro-Cáceres et al., *A Computational Model of Tonal Tension Profile of Chord Progressions in the Tonal Interval Space* (Entropy 2020), <https://doi.org/10.3390/e22111291> | Separate hierarchical tonal distance, dissonance, and sequential movement instead of one hand-written tension number | Open-access paper; independently reimplement equations |
| Voice-leading distance | Tymoczko, *Geometrical Methods in Recent Music Theory* (MTO 16.1), <https://www.mtosmt.org/issues/mto.10.16.1/mto.10.16.1.tymoczko.pdf> | Use actual fixed-cardinality taxicab voice-leading distance; do not treat arbitrary Tonnetz path length as global distance | Open-access paper; independently reimplement definitions |
| Dynamic non-functional harmony | Chan, Ito, and Mikami, *Development of a Dynamic Chord Progression Generation System for Digital Game based on Neo-Riemannian Theory* (DiGRA Japan 2023), <https://doi.org/10.57518/digrajproc.13.0_281> | P/L/R transformations as candidate moves for game and cinematic harmony, while functional cadence remains an independent constraint | Open-access proceedings |
| Flexible harmonic rhythm | Wu et al., *Generating Chord Progression from Melody with Flexible Harmonic Rhythm and Controllable Harmonic Density*, <https://arxiv.org/abs/2112.11122> | Chord positions are generated on the metric grid and evaluated with melody rhythm, not fixed to one chord per bar | Paper plus MIT repository |
| Flexible harmonic rhythm implementation | `sander-wood/autoharmonizer`, <https://github.com/sander-wood/autoharmonizer> | Representation and evaluation comparison only; no runtime dependency | MIT |
| Bidirectional melody-conditioned harmonization | Kaliakatsos-Papakostas et al., *Melody Harmonization with Encoder-only Transformers*, <https://proceedings.mlr.press/v303/kaliakatsos-papakostas26a.html> | Use a single encoder with synchronized melody/harmony context as the primary neural baseline; test arbitrary fixed-chord conditioning | Open-access proceedings; independently implement |
| Melody-attentive masking curriculum | Kaliakatsos-Papakostas et al., *Pay Cross Attention to Music*, <https://arxiv.org/abs/2601.16150> | Compare full-to-full harmony masking with random and causal masking so the model cannot solve training by ignoring melody | Preprint; hypothesis only until reproduced |
| Harmony representation | Kaliakatsos-Papakostas et al., *Harmony Tokenization for Symbolic Music Generation*, <https://doi.org/10.3390/info16090759> | Compare factorized, spelling-preserving, and chunked harmony representations instead of assuming one tokenizer is universally best | CC BY article; independently implement |
| Low-latency accompaniment | Wu et al., *ReaLchords*, <https://proceedings.mlr.press/v235/wu24c.html> | Later offline-teacher distillation and latency/quality comparison; not the first editor model | Open-access proceedings |
| Rule-guided neural generation | Huang et al., *Symbolic Music Generation with Non-Differentiable Rule Guided Diffusion*, <https://proceedings.mlr.press/v235/huang24g.html> | Evaluate forward-only guidance from the existing auditable validator without converting every rule to a differentiable loss | Open-access proceedings |
| Tonal-tension reference implementation | `merismeris/tonal-tension-TIS`, <https://github.com/merismeris/tonal-tension-TIS> | Black-box result comparison against published examples; code is not copied | No detected license: do not copy code |
| Constraint-based polyphony | Hadjeres, Pachet, and Nielsen, *DeepBach*, <https://proceedings.mlr.press/v70/hadjeres17a.html> and <https://github.com/Ghadjeres/DeepBach> | Preview candidates can be regenerated around fixed notes/cadences instead of irreversible left-to-right generation | MIT |
| Computational validation | `cuthbertLab/music21`, <https://github.com/cuthbertLab/music21> | Development-only cross-check for interval, voice-leading, and harmony fixtures | BSD-3-Clause |
| Symbolic generation metrics | Dong et al., *MusPy*, <https://arxiv.org/abs/2008.01951> and <https://github.com/salu133445/muspy> | Development-only corpus statistics and held-out evaluation | MIT |
| Pop arrangement corpus | Wang et al., *POP909*, <https://archives.ismir.net/ismir2020/paper/000089.pdf> and <https://github.com/music-x-lab/POP909-Dataset> | Local evaluation of melody/chord/rhythm relations; dataset is never bundled with the app | Repository MIT; underlying songs are not redistributed |

## Rejected shortcuts

- Tonnetz edge count is not used as a universal chord distance. Tymoczko shows
  that non-adjacent graph distance may diverge from actual voice-leading
  distance.
- A progression is not accepted only because every chord belongs to the key.
- A zero-rule-violation result is not labelled musically good.
- Floating weights without a paper, corpus fit, compatibility bound, or explicit
  user control are not added.
- Training and evaluation pieces are kept separate.

## First replacement boundary

The public `generateProgression`, `generateMelody`, and `generateRhythmBar`
interfaces remain stable. Their internal objectives change in this order:

1. hard cadence and resolution constraints;
2. ordinal functional hierarchy;
3. fixed-cardinality voice-leading distance;
4. requested global contour and tension profile;
5. corpus-calibrated style likelihood;
6. deterministic seed only as a final tie break.

Every phase must include an ablation showing which objective changed the output.

## Implemented harmony milestone

- Functional transition decimals were replaced by ordinal preference tiers.
- Chord-kind selection now searches the complete span instead of sampling each
  slot independently.
- Applied dominants and tritone substitutes must resolve to the declared next
  degree and its actual pitch root, including section and modulation seams.
- P/L/R transformations are used only as contextual candidates inside a
  functional chromatic-sequence state. The saved chord records the operation
  and source triad, and validation recomputes the transformation.
- Common-tone loss, fixed-cardinality voice-leading distance, root direction,
  sounding-bass direction, and chromatic-run length remain separate reported
  facts; they are not collapsed into an unsourced float.

## Empirical harmony milestone

The first experience model is `harmony-corpus-ngram-v1`.

- Training checkout: POP909 commit
  `d83e6edba6872a704f5d3b8b32f5cb540088dae6`.
- Training population: 909 songs, split into 1,131 uninterrupted key regions.
- Normalized observations: 93,904 chord tokens.
- Representation: `(root semitones relative to active key, normalized quality)`.
- Orders: one through five.
- Runtime: recursive interpolation. The interpolation coefficient is
  `context_count / (context_count + vocabulary_size)`, so it is estimated from
  evidence density rather than selected by ear.
- Boundary: the model ranks candidates that already passed hard theory
  validation. It cannot make an illegal resolution valid.
- Reproducibility: `scripts/train-harmony-corpus.py`; model metadata records the
  source repository and commit.
- Data minimization: the output contains aggregate counts only, not MIDI,
  titles, audio, lyrics, or raw chord annotations.

This is a pop-harmony language model, not a universal musical-quality model.
Results for jazz, common-practice counterpoint, game music, and non-Western
tonal systems require separate declared corpora and held-out evaluation.

The next neural-model stage is specified in two readable languages:

- state-of-the-art comparison:
  [日本語](neural-harmonization-sota.ja.md) /
  [English](neural-harmonization-sota.en.md);
- implementation plan:
  [日本語](neural-chord-model-plan.ja.md) /
  [English](neural-chord-model-plan.en.md).
