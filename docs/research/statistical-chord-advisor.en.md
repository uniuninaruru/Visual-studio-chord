# Statistical chord advisor: design research

Updated: 2026-08-24

## Conclusion

The reusable part of Hooktheory's page is not a list of progressions or its numbers. It is the idea of ranking a next-chord choice by raw observed frequency and interpolated probability, while exposing familiarity and novelty as separate, inspectable dimensions. This implementation is offline-first: it does not connect to Hooktheory, scrape it, copy its statistics, or train on its data.

## References and boundary

- [Hooktheory Popular chord progressions](https://www.hooktheory.com/theorytab/popular-chord-progressions): a reference for presenting common transitions as a discovery aid.
- [Hooktheory API Trends documentation](https://www.hooktheory.com/api/trends/docs): a reference for the shape of a contextual trends API. Authentication, rate limits, and scope mean this app does not call it.
- [Hooktheory Terms of Service](https://www.hooktheory.com/terms) and [TheoryTab contributor documentation](https://www.hooktheory.com/support/tabs): restrictions on unlicensed scraping, bulk retrieval, redistribution, and model use informed the decision to keep the provider local.
- POP909 Dataset, whose provenance is already recorded by the tracked `models/harmony-corpus-v1.json`.

The sources were checked on the date above. No long text, song analysis, or site-specific statistics are copied; only general product concepts are described.

## Local corpus and reproducibility

The browser artifact is built by `scripts/build-browser-harmony-statistics.mjs`.

- source: POP909, 909 songs / 1,131 tonal sequences / 93,904 tokens
- model: `harmony-corpus-ngram-v1`, source model version `local-corpus-v1`
- source SHA-256: `dfa28603b2aa0247abe5265a6975ae8267042a91e72e8c1ddd2221e2624209ae`
- browser orders: 1, 2, and 3 (the source model's order 4 and 5 counts are not shipped to the browser)
- raw song data: `bundled: false`

The builder resolves repository-relative paths, validates schema, model ID, provenance, contiguous orders, gram shapes, and positive counts. It writes canonical TypeScript through a temporary sibling followed by rename. `pnpm stats:check` detects stale output.

## Probability model

Tokens use root semitones relative to the active key plus quality, for example `0:major` and `9:minor`. Candidates are deduplicated steps from the existing mode-compatible `PROGRESSION_TEMPLATES` and materialized by `createStepChordEvent`. Statistics therefore cannot override the existing theory validator.

The 1-gram uses the same additive smoothing as the backend:

```text
P1(x) = (count(x) + 1) / (totalTokens + vocabularySize)
```

Orders 2 and 3 recursively interpolate maximum likelihood with the shorter suffix model using observed context frequency:

```text
lambda = contextCount / (contextCount + vocabularySize)
P_n(x|c) = lambda * count(c,x)/contextCount
         + (1-lambda) * P_(n-1)(x|suffix(c))
```

An unseen context backs off to the shorter model. The UI separates raw maximum-likelihood frequency actually observed at the selected order from interpolated probability, which combines direct evidence with shorter-context and global tendencies. It also shows exact gram count, context count, order, and `-log2(P)` surprisal bits. Counts are occurrences, not unique songs: repetitions within a song contribute repeatedly. The 909 song count describes corpus coverage and is not the denominator of each probability. Probability is corpus evidence, not a quality or correctness score.

Profiles use deterministic stable sorting:

- familiar: descending probability;
- balanced: candidates nearest the median surprisal, then descending probability;
- adventurous: removes unseen grams and orders observed candidates by descending surprisal. No arbitrary zero-support chord is invented.

## Whole-piece metrics

- geometric-mean conditional probability: geometric mean of the interpolated probability for each **eligible same-key/mode transition after the first chord**; a range with zero eligible transitions is unavailable;
- mean surprisal: `-mean(log2(P))` over that same transition set; lower means more frequent in this corpus, not better;
- supported-transition rate: fraction of that same transition set whose selected-order exact gram count is positive; key/mode boundary pairs are excluded from statistical transitions;
- complex-chord rate: `(extensions + non-diatonic + advanced qualities) / (3 × chord count)`, with the three components also exposed;
- duration-weighted melody non-chord tension: melody notes are clipped to the scope and split at every overlapping sounding-chord boundary; duration outside each active chord's pitch classes divided by total duration for which an active chord exists. A chord that began before the scope and sustains into it is active;
- actual-bass stepwise-motion rate: consecutive sounding lowest notes within two semitones divided by comparable transitions;
- syncopation rate: **melody** onsets inside the scope that are not on a `ticksPerBeat` boundary, divided by melody onsets inside the scope. Chord and bass rhythm are not claimed by this metric.

Empty and one-chord pieces, and empty melodies, return safe zero/default metrics without NaN or Infinity.

## Provider seam

`HarmonyStatisticsProvider` is a small contract containing `probability(tokens)` and provenance. `LocalCorpusHarmonyProvider` is the only current implementation. A future provider with explicit permission could implement the same contract without coupling UI to its source. No Hooktheory provider is implemented or rendered.

## UX and application safety

The 統計 tab names its analysis scope and offers familiar / balanced / adventurous as keyboard-accessible pressed buttons. Audition is preview-only. Applying requires one explicitly selected chord and preserves that chord's exact start and duration; with no selected chord, the whole piece can still be analyzed and song-end continuation candidates can be auditioned, but nothing can be modified. Locked tick spans, Store no-ops, and failures produce written feedback. Suggestions never overwrite the formal composition automatically.

## Bias and limitations

POP909 is one public corpus with J-pop-oriented coverage and transcription, key-estimation, and chord-label biases. Low frequency is not badness; high frequency is not universality or creativity. Statistics rank root+quality only; voicing, tensions, inversions, and section-transition smoothness remain theory/arrangement decisions. Context resets at key/mode boundaries, and cross-section smoothness remains the responsibility of the existing theory validator, voice-leading checks, melody tension, and bass metrics rather than a falsely learned cross-key n-gram.

## Test plan

`frontend/tests/music.statisticalHarmony.test.ts` covers artifact provenance, a backend-parity interpolation fixture, fail-closed invalid snapshots, finite empty input, deterministic profiles, mode-safe materialization, unigram evidence, adventurous support, key/mode boundaries, and metrics. UI regression covers source/metrics/profile display, audition, disabled apply without a selection, locked-tick messaging, and explicit single-chord apply/toast behavior. Artifact freshness is checked by `pnpm stats:check` or `npm run stats:check`; typecheck, lint, build, and the full test suite run through `pnpm check` or `npm run check`.
