# Hybrid Pareto ranking for automatic section transitions

> After the Jazz-first update, ordinary `Auto` joins do not use a corpus axis.
> The hybrid path below requires an explicitly supplied corpus provider. Default
> ranking keeps the same Pareto procedure for voice leading and style prior.
> [Current design](jazz-first-engine.en.md).

Status: **implemented design**. This applies only to choosing one inserted chord
for an `Auto` join between sections with the same Key / Scale. Statistical
evidence cannot legalize a theory-invalid candidate, and the meanings of forced
`Direct`, `Dominant`, and `Pivot` are unchanged.

## Selection flow

1. Start with the theory-valid candidates produced by the existing
   `transitionsInto` function. Keep only candidates whose current style-profile
   weight is positive and whose root differs from the outgoing chord.
2. Evaluate every candidate independently on corpus evidence, optimized
   four-part voice leading, and the style prior.
3. Remove candidates that are no better on any active measure and worse on at
   least one, leaving the Pareto frontier.
4. Make the existing seeded, style-weighted choice within that frontier only.
   The seed provides diversity among surviving alternatives; it never revives a
   dominated candidate.

The measures are not collapsed into one arbitrary weighted sum, so frequency,
voice leading, or style alone cannot determine the result.

## The three views

### Local conditional evidence from POP909

The outgoing, candidate, and incoming chords are converted to **root+quality
tokens relative to the destination tonic**. Voicing, tensions, and inversion
are not encoded. The existing local `HarmonyStatisticsProvider` is queried
exactly twice per candidate:

- `P(candidate | outgoing)`: a 2-gram query;
- `P(incoming | outgoing, candidate)`: a 3-gram query.

Mean surprisal over the two transitions is

`S = (-log2 P(candidate | outgoing) - log2 P(incoming | outgoing, candidate)) / 2`.

Lower means more frequent under this POP909 model, not better music. The score
also records how many of the two queries satisfy
`orderUsed >= 2 && exactGramCount > 0`. Pareto comparison treats a higher
supported-transition count and lower mean surprisal as separate improvements.

### Existing four-part voice leading

The three-chord path `outgoing -> candidate -> incoming` is sent to the existing
`revoiceInFourParts(..., optimizeSequence: true)` in the same style and the
destination Key / Mode. The existing voice-leading scorer is then applied to
both transitions and its costs are summed. No new pitch-distance shortcut or
ad-hoc common-tone score is introduced. Lower cost is better.

### Style prior

The current profile weight for the candidate's transition technique is used
unchanged. Higher is better both in Pareto comparison and in the seeded weighted
choice within the frontier.

## Pareto dominance

Candidate A dominates candidate B only when A is no worse on every active
measure and strictly better on at least one:

- corpus: at least as many supported transitions and no higher mean surprisal;
- voice leading: no higher summed cost;
- style: no lower profile weight.

Only non-dominated candidates remain on the frontier.

## Corpus-wide fail-closed fallback

If the provider is unavailable, throws, returns a non-finite value, returns a
probability outside `(0, 1]`, or reports an invalid count/order, the corpus view
is removed for **every candidate**. Valid-looking candidates are never compared
with corpus evidence against candidates scored without it. Theory-validity,
existing four-part cost, and the style prior still form a Pareto selection, the
failure does not escape into the app, and the explanation records the fallback.
Provider creation is deferred until a boundary reaches ranking. As with other
bundled frontend modules, a module load or syntax failure prevents application
startup and is outside this runtime fallback boundary.

In the normal path, the explanation appends the automatic candidate count,
frontier count, hybrid/fallback state, selected candidate's corpus support, mean
surprisal, and four-part cost. The saved result therefore retains an auditable
reason for the choice.

## Preserved contracts

- The transition-rate hash, threshold, and seed derivation are unchanged.
- If the outgoing chord already prepares the incoming chord's dominant, `Auto`
  still returns `null`.
- Forced `Direct`, `Dominant`, and `Pivot` bypass this ranker.
- Existing half-chord insertion, tick coverage, event IDs, and timeline behavior
  are unchanged.
- Equal inputs and seed produce the same result. `Math.random()` is not used.

## Evidence and claim boundary

- Tymoczko models mappings between chord tones geometrically and discusses the
  use of short voice leadings across styles. This implementation does not
  implement that orbifold model; it uses the repository's existing ranged
  four-part optimizer.
- Rohrmeier argues that tonal-harmonic organization exceeds simple Markov
  transition tables and calls for hierarchical, recursive structure. This local
  two-step ranker is therefore not described as a complete harmony grammar.
- Korzeniowski, Sears, and Widmer compare n-grams with language models capable
  of longer context for chord prediction. This implementation is neither a
  generative grammar nor a song-adaptive RNN; it reads only local evidence from
  the tracked POP909 3-gram.
- Pauwels, Kaiser, and Peeters show that key-relative chord-pair distributions
  differ by structural position and combine harmony with complementary cues.
  This implementation does not reproduce their audio segmentation, HMM, or
  novelty features.
- The repository's [McGill Billboard external
  evaluation](mcgill-billboard-external-evaluation.en.md) finds better overall
  NLL/Top-k for the 3-gram but no uniform improvement in section-boundary
  ranking. Corpus evidence is consequently one Pareto view, not the sole rank.
  McGill annotations are used in neither runtime nor training.

This ranker is not evidence of a complete hierarchical grammar, improved
listening or musical quality, McGill runtime use, or improvement at every
section boundary. Listening quality still requires a future blind listening
test.

## References

- Dmitri Tymoczko, “The Geometry of Musical Chords,” *Science* 313 (2006), 72–74. [DOI](https://doi.org/10.1126/science.1126287)
- Martin Rohrmeier, “Towards a Generative Syntax of Tonal Harmony,” *Journal of Mathematics and Music* 5 (2011), 35–53. [DOI](https://doi.org/10.1080/17459737.2011.573676)
- Filip Korzeniowski, David R. W. Sears, and Gerhard Widmer, “A Large-Scale Study of Language Models for Chord Prediction” (2018). [arXiv:1804.01849](https://arxiv.org/abs/1804.01849)
- Johan Pauwels, Florian Kaiser, and Geoffroy Peeters, “Combining Harmony-Based and Novelty-Based Approaches for Structural Segmentation,” *ISMIR* (2013). [paper](https://archives.ismir.net/ismir2013/paper/000138.pdf)
