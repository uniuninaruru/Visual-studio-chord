# McGill Billboard external evaluation report

Updated: 2026-08-25

## Purpose and scope

This report records a local evaluation of the tracked statistical chord language
model on an external corpus that the application does not use at runtime or for
training. McGill Billboard annotations are fetched only on the machine running
the evaluation. The result measures next-token prediction on this corpus; it is
not a measure of the app's musical quality.

The official entry point is [The McGill Billboard Project (Chord Analysis Dataset)](https://ddmal.ca/research/The_McGill_Billboard_Project_%28Chord_Analysis_Dataset%29/).
The official page describes the annotations as CC0, and describes 890 slots / 740
distinct songs. Raw audio is not distributed, and the annotations use SALAMI
format. This report links to the official description without making an
additional legal determination.

## Acquisition and reproduction

The fetch URLs are fixed in `scripts/fetch-mcgill-billboard.py`. The raw dataset
is never tracked by Git. Run these commands from the repository root. Fetch only
on the first acquisition; if the target is already present, skip fetch and rerun
only evaluate. The fetcher intentionally refuses to overwrite an existing
non-empty target, so repeating the same fetch fails by design. On a POSIX system,
run:

```bash
python3 scripts/fetch-mcgill-billboard.py
python3 scripts/evaluate-mcgill-billboard.py \
  --output docs/research/evaluations/mcgill-billboard-v2-harmony-language-model-v1.json
```

On Windows PowerShell, run:

```powershell
python .\scripts\fetch-mcgill-billboard.py
python .\scripts\evaluate-mcgill-billboard.py `
  --output .\docs\research\evaluations\mcgill-billboard-v2-harmony-language-model-v1.json
```

The [tracked machine-readable evaluation JSON](evaluations/mcgill-billboard-v2-harmony-language-model-v1.json)
is a tracked aggregate evaluation report containing aggregate values only.
Raw data, song titles, artists, absolute paths, and individual sequences are not
written to the report or to a tracked JSON file. If fetched material is kept,
keep it in the local external-evaluation directory only.

## Input identity

The evaluated input and intermediate results use
`parserVersion: mcgill-salami-v2-normalizer-1` and are pinned by these five
SHA-256 values.

| Item | SHA-256 |
| --- | --- |
| source archive | `a22e32bf24c8a18859ce18427c6501a7a72520185cddd6d882ceb3c61d02ec75` |
| portable tree | `312a0e6478ca018aef44291e799434cc2096c0ea4a0e2568ef0ac90020ebb503` |
| tracked aggregate model | `dfa28603b2aa0247abe5265a6975ae8267042a91e72e8c1ddd2221e2624209ae` |
| normalized evaluation input | `f0ceb26872322f3e867d0d6ba9c4523c0bd057efed9799769a6208993cc21fdb` |
| canonical tokenizer script (strict UTF-8 + LF) | `b524df19323c5fbc28c30e90960a8dec3d17e0d7b2e22c774647693fd947a28d` |

## Normalization protocol

`parserVersion: mcgill-salami-v2-normalizer-1` reads
`scripts/train-harmony-corpus.py` as strict UTF-8, canonicalizes CRLF and lone CR
to LF, and uses that canonical snapshot for both hashing and compile/exec. The
normalization fixes these boundaries:

- Roots are tonic-relative semitones; slash bass is not tokenized. Extensions are normalized into the existing quality classes.
- Adjacent identical tokens collapse; `.` expands the preceding token within the phrase; official `xN` repeats are expanded. Elision markers are counted and then removed.
- `N`, `*`, `&pause`, `Z`, `silence`, `end`, unknown quality, missing tonic, and key changes reset context. Meter changes do not cut context.
- Timestamp, rhythm, and duration are not evaluation metrics.

The measured object is therefore distributional fit over context-contiguous
normalized token sequences. SALAMI time positions, musical rhythm and duration,
and slash-bass inversion / bass-note identity are outside the evaluation target.

## Corpus and normalization aggregates

Only the following aggregate values are retained in the tracked aggregate evaluation report.

| Aggregate | Count |
| --- | ---: |
| annotations | 890 |
| musical phrases | 23,392 |
| expanded bars | 91,343 |
| normalized raw lexemes | 122,314 |
| unsupported lexemes | 5,668 |
| collapsed tokens | 82,294 |
| sequences | 2,487 |
| transitions | 79,807 |
| section-boundary transitions | 5,160 |

OOV is `191 / 79,807 = 0.2393%`. Its denominator is all transitions, not songs
or annotations. The candidate set is all 106 model unigrams, not the UI template
advisor subset. These results must therefore not be read as a direct evaluation
of the on-screen candidate ranking.

## Overall results

NLL is in bits, PPL is perplexity, and each Top-k value is the fraction whose
correct token appeared among the top k candidates. These are order 1–3
comparisons on the same external evaluation input, not a trained-model quality
or listening evaluation.

| order | NLL (bits) | PPL | Top-1 | Top-3 | Top-5 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 4.7870988083 | 27.6096 | 0.2006967 | 0.3369003 | 0.5536231 |
| 2 | 4.2734057583 | 19.3385 | 0.2289774 | 0.5168344 | 0.6025787 |
| 3 | 4.1642300235 | 17.9291 | 0.2593131 | 0.5211824 | 0.6496924 |

Compared with order 2, order 3 lowers NLL by 0.1091757 bits and raises Top-1 by
0.0303357, Top-3 by 0.0043480, and Top-5 by 0.0471137. Compared with order 1,
it lowers NLL by 0.6228688 bits and raises Top-1 by 0.0586164, Top-3 by
0.1842821, and Top-5 by 0.0960693. The limited claim is that order 3 improves
distributional fit and overall Top-k on this aggregate McGill Billboard input.

## Formal section-boundary definition

Following the McGill specification, `sectionBoundary` is not an inferred generic
"section-like" break. A capital letter plus optional primes (for example, `A` or
`B'`) marks the start of a high-level structural segment. The evaluated
section-boundary transition is from the immediately preceding context to the
first valid token in the phrase carrying that marker. `Z` is non-musical and
resets context. A plain-text function label alone is not included in this formal
boundary slice.

## Section-boundary results

When only section-boundary transitions are separated, Top-1 is:

| order | boundary Top-1 |
| ---: | ---: |
| 1 | 0.4040698 |
| 2 | 0.3288760 |
| 3 | 0.3381783 |

Order 3 is 0.0658915 below order 1 and 0.0093020 above order 2 on boundary
Top-1; it does not exceed order 1. In the additional comparisons, order 3
boundary NLL is 0.523604 bits lower than order 1 and 0.0221492 bits lower than
order 2, while boundary Top-3 is 0.0102713 below order 2. Therefore, the
3-gram cannot be said to improve section-boundary ranking uniformly. Section
connections remain a weakness in this evaluation.

## Conclusion and unevaluated claims

The defensible conclusion is limited to this: the 3-gram improves distributional
fit and overall Top-k on the external corpus, while section-boundary ranking does
not improve uniformly. This is not evidence of better music, listening quality,
the whole UI advisor, voicing, melody, rhythm, or audio.

- McGill Billboard is centered on US Billboard material from 1958–1991 and is not representative of all commercial music.
- The evaluation uses all 106 model unigrams, not the UI template advisor subset, and does not evaluate melody, voicing, rhythm, audio, or listening.
- The tracked aggregate model has no song IDs, so it does not prove complete song-identity exclusion relative to POP909.
- Raw data, song titles, artists, absolute paths, and individual sequences are not included in the report or tracked JSON.

This is a limited language-model evaluation against an external corpus. It does
not replace the application's runtime/training data boundary or a future
musical evaluation.

## References

- [The McGill Billboard Project (Chord Analysis Dataset)](https://ddmal.ca/research/The_McGill_Billboard_Project_%28Chord_Analysis_Dataset%29/): official dataset description and annotation specification.
- Burgoyne, J. A., Wild, J., & Fujinaga, I. (2011), ISMIR 2011 paper: 1958–1991 sampling and corpus description. [paper](https://ismir2011.ismir.net/papers/OS8-1.pdf)
- de Haas, W. B., & Burgoyne, J. A. (2012), parser report: SALAMI annotation parser description. [report](https://ics-archive.science.uu.nl/research/techreps/repo/CS-2012/2012-018.pdf)
- Harte, C. et al. (2005), chord syntax paper: chord-symbol syntax basis. [paper](https://ismir2005.ismir.net/proceedings/1080.pdf)
