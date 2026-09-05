# TIS bar-level tension reranking

Status: **implemented browser-local adaptation**. The feature compares eight
bar-level alternatives produced by the existing functional-harmony generator.
It does not add a Transformer, trained model, model weights, or the hierarchical
tree term from the 2020 model.

## What is selected

For each newly evaluated automatic group/section, `generateSectionedChords`
evaluates exactly eight candidates from the existing cadence/grammar-valid
`generateProgression` when functional harmony and TIS reranking are enabled,
there is no top-level `settings.progressionId`, and the composition is not an
assembled arrangement. A compatible repeated section in the same planner
group reuses the cached result and therefore does not make eight new calls.
Candidate 0 uses the current section `progressionId` (the planner's catalog
baseline) and original section seed. Candidates 1–7 explicitly set
`progressionId: undefined` and use deterministic derived streams, so they are
functional-harmony alternatives. With `style: random`, candidates 1–7 are
pinned to candidate 0's resolved concrete style; cadence may differ, but every
candidate remains valid under the existing generator.

When the user supplies a top-level `settings.progressionId`, it is the
effective progression for every planned section (including a song form), and
the complete sectioned path bypasses TIS. This is the explicit named-template
contract; it is not merely a toggle that happens to leave a planner-selected
ID in place. Repeated planner groups sharing a progression ID reuse the same
derived candidate streams, resolved style, and selected original candidate
index. Compatible repeated sections reuse the selected result itself, so AABA
and returning verse/chorus material remains a restatement.

Candidates are deduplicated by root + quality sequence plus their actual
sounding tick positions, durations, sorted MIDI note lists, and bass. Fewer
than two unique candidates, an empty/non-finite curve, or any metric exception
keeps candidate 0 exactly. A top-level named progression and user-assembled
`arrangementPlan` sections bypass the reranker; planner-internal catalog IDs do
not. A normally evaluated section receives `tonalTensionApplied: true`: if the
catalog baseline wins, its catalog ID remains; if a functional candidate wins,
the output section removes that ID. Range-based partial regeneration deliberately
uses candidate 0 and removes the TIS marker only from sections where at least
one unlocked bar is actually replaced; a range that overlaps a fully locked
section retains its marker. Untouched sections retain their marker. A touched
range is not claimed to be a newly evaluated full-section result.

## TIS representation and profile

MIDI pitches (or pitch classes) become a 12-dimensional chroma count `c(n)`. We
compute weighted complex DFT bins for `k=1..6`, normalized by total chroma mass:

`T(k) = w_k / Σc(n) · Σ[n=0..11] c(n) exp(-j 2πkn/12)`

The symbolic weights are `[2, 11, 17, 16, 19, 7]`; complex values are plain
`{real, imag}` records. Zero-vector angles are defined as 0 and cosine inputs
are clamped to `[-1, 1]`.

- TIS Euclidean distance: `sqrt(Σ(real difference² + imag difference²))`;
- key distance: angle between chord TIV and the active key/mode scale TIV;
- function distance: minimum angle between chord − key and tonic,
  subdominant, and dominant − key directions;
- dissonance: `clamp(1 − ||T|| / sqrt(Σw_k²), 0, 1)`;
- chord-to-chord distance: Euclidean distance divided by **64.8757**.

Function templates double the tonic root, use the current scale's diatonic
tonic/subdominant, and use a major dominant even in minor. Dorian and
Mixolydian use the same symbolic convention, but the underlying perceptual
evaluation was mainly major/minor and short progressions.

For the pitch-class voice-leading feature, equal cardinalities use the minimum
circular mapping over rotations, evaluated from right rotation 1 and visiting
the unrotated order last so exact ties have the same deterministic choice as
the reference. Different cardinalities use a deterministic
minimum mapping over sorted, rotated pitch-class sequences with endpoint
repetition allowed. Pair pitch/key/function terms are accumulated and passed to
`exp(-0.05 * semitoneCost * pairTerm)`. The complete profile is:

`chordDistance + 1.58·keyDistance + tonalFunctionDistance + 30.3·dissonance + 2.71·voiceLeading`

The first chord has zero chord-distance and voice-leading. Every component is
returned for audit.

The dissonance denominator is computed from the exact `sqrt(sum(weights²))`
value in this implementation. The reference implementation rounds its
published maximum to approximately `32.8631`; this project therefore does not
claim bit-for-bit parity with that rounded constant.

## Bar curves and ranking

Chord profile totals are averaged into bars using the integer tick overlap each
chord occupies. The target is the existing `planSectionEnergy` /
`energyAtBar` shape, converted to a local `start → peak → end` array. This is
shape guidance for this product, not a claim that the target's absolute scale
matches raw TIS totals.

When both candidate and target variance are at least `1e-3`, ranking uses
Pearson correlation. Otherwise it uses a deterministic fallback without raw
means: two flat curves score `1`; a flat target scores candidates by
`1 / (1 + candidate variance)`; a non-flat target scores a flat candidate
`-1`; and otherwise Pearson is used. Strict ties retain candidate 0. During
partial regeneration, only a fully replaced section-wide beam is not claimed
or applied; a section loses its old TIS marker only when a selected unlocked
bar actually changes its chords, while untouched metadata is retained.

All calculations are dependency-free, deterministic, offline, and local to the
browser. The target is section-local shape guidance: it does not optimize a
cross-section absolute tension level, and it does not guarantee a match after
later pivot/transition insertion, hand assignment, or revoicing. The selected
pre-voicing curve is therefore a section-local guide, not a guarantee about the
final postprocessed sound. Top-level explicit templates remain byte-for-byte
bypasses. User-assembled arrangements do not enter this reranking path at all;
their source sections are generated independently and assembled afterward,
rather than being handled by an arrangement-specific branch inside the
reranker. The persisted `tonalTension: { enabled }` field is
optional, so old JSON remains valid; shipped defaults enable it while
`MINIMAL_GENERATOR_SETTINGS` leaves it absent/off.

## Claim boundary

- This is not a Transformer, a trained model, or inference-time model weights.
- The 2020 hierarchical-tree / long-term structure term is not implemented.
- Listening improvement for this app has not been demonstrated; a blind
  listening study is still needed.
- Published perceptual evaluation was mostly on major/minor keys and short
  progressions.
- This is an adaptation to the existing generator, not a faithful reproduction
  of the 2025 paper's complete dual-level beam-search decoder.

## References

- Bernardes et al. (2016), “A Multi-Level Tonal Interval Space for Modelling Pitch Relatedness and Musical Consonance,” [DOI](https://doi.org/10.1080/09298215.2016.1182192)
- Navarro-Cáceres et al. (2020), “A Computational Model of Tonal Tension Profile of Chord Progressions in the Tonal Interval Space,” [DOI](https://doi.org/10.3390/e22111291)
- Ebrahimzadeh et al. (2025), “Explicit Tonal Tension Conditioning via Dual-Level Beam Search for Symbolic Music Generation,” [arXiv:2511.19342](https://arxiv.org/abs/2511.19342)
- Official 2025 implementation (profile coefficients/constants cross-check): [tension-beamsearch](https://github.com/MaraalE/tension-beamsearch)
- TIVlib (DFT/TIS background): [TIVlib](https://github.com/aframires/TIVlib)
