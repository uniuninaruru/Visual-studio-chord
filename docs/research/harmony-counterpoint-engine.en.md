# Harmony and counterpoint centered generation engine v2

Status: implementation design. See the [open textbook register](harmony-counterpoint-sources.en.md). This design targets new compositions, with jazz as the initial default. Loading a saved project must retain its stored notes and chords.

## Problem and contract

Today `jazzHarmony.ts` selects chords bar by bar, `jazzMelody.ts` writes a lead over finished chords, `jazzArrangement.ts` adds bass and comping, and optional counterpoint comes later. This sequence cannot jointly plan the harmonic transition, lead, bass, and second line. The current counterpoint checker compares coincident attacks and can miss a held note against a new chord.

New compositions use an explicit `jazz.version: 2`; saved `version: 1` settings regenerate through their existing path. V2 retains the `GeneratedComposition` contract: PPQ 480, integer ticks, MIDI 21–108, chord/lead/voice/section/lock data, shared tracks, MIDI and JSON export. It needs no model, network, or GPU.

## Planning order

```text
settings and sections
  → phrase cadences, tension and modulation targets
  → functional harmony path and chord candidates (named progressions constrain it)
  → joint bass, inner-guide-tone, lead and optional counterline skeleton
  → rhythm, counterline detail and classified embellishments
  → inspect actual sound across all tracks at integer-tick boundaries
  → GeneratedComposition, DAW tracks and rule-level diagnostics
```

The search state tracks current/previous harmony, bass, two inner voices, lead, optional counterline, and phrase position. The algorithm must not optimize each chord separately. A fixed seed orders candidates reproducibly; bounded candidate counts and beam width control cost.

| Rule | Strict species | Common-practice tonal | Jazz / blues / modal |
| --- | --- | --- | --- |
| Ranges, timing, identified parts | Required | Required | Required |
| Unintended crossing | Forbidden | Strong penalty | Penalize with instrument/hand context |
| Accent targets | Consonant | Strongly prefer chord tones | Prefer 3rd/7th and declared tensions |
| Parallel fifths/octaves | Forbidden | Strong penalty | Penalize independent lines; permit intended parallel voicings |
| Weak dissonance | Stepwise passing in second species; contextual neighbors in third | Admit verified context | Also admit approaches, enclosures and declared color tones |
| Suspension | Consonant preparation, hold, stepwise resolution | Prefer same grammar | Allow style-specific delayed resolution |
| Cadence | Verify declared type | Verify phrase ending | Also support ii–V–I, substitution, blues and modal endings |

Chord membership comes from the actual chord symbol, including sus, sixths, ninths and alterations, rather than membership in a scale. First-species consonance is not applied as a hard filter to jazz tensions. Source rule IDs: `CP-1/2/3/4`, `H-FORM`, `J-GUIDE`, `J-BLUES`, `J-MELODY` in the textbook register.

## Module boundaries

1. `theoryRules`: pure functions for chord members, metric accent, two-line motion, perfect parallels, and contextual non-chord tones. Diagnostics carry rule ID, tick, voice, severity and reason.
2. `theoryHarmony`: plan section cadences first, then beam-search candidate T→PD→D→T paths. Blues I7/IV7, modal stasis and named progressions use distinct grammars. A chord list alone does not prove cadence or modulation.
3. `theoryVoices`: jointly score structural bass, inner voices, lead and optional counterline at common harmonic boundaries. Consider third/seventh continuity, contrary/oblique motion, range, phrase contour and leap recovery.
4. `theoryOrnaments`: place note values and passing, neighboring, approach and suspension notes between anchors. Admit each non-chord tone to canonical data only after its adjacent-note grammar is verified.
5. `theoryEngine`: wire v2 into `generator.ts` and `regenerateRange`, adapting results to existing `GeneratedComposition`. `compositionTracks.ts` remains the shared sounding-track boundary for playback and export.

V1 and v2 are not assumed to reproduce the same music for an identical seed. Imported projects retain their stored notes. Range regeneration preserves locks and all out-of-range events, then solves new lines against the retained harmony. If no valid solution exists, discard the candidate and return the original with a diagnostic.

## UI and acceptance gates

- Basic exposes “Generate from harmony and voices” and style; Advanced exposes strictness, counterline independence and candidate count. Explain each rule in Japanese and English.
- Display bass, chords, lead and counterline separately, with a selectable tick for each problem. Playback and editing continue during generation, and results remain previews until adopted.
- Gates: deterministic seed, twelve-bar blues, named progression, minor ii–V–i, 3/4–4/4–6/8, all keys, piano range, positive/negative strong-beat/weak-beat/suspension examples, held notes over chord changes, crossing and parallels, locked range regeneration, MIDI/JSON round trips.
- A passing score is not proof of good music. Compare v1/v2 blind at matched timbre, level and tempo, scoring harmonic transitions, independence and melodic naturalness separately. Record rule and audio evidence for failures before tuning coefficients.

Implement in the textbook order. Do not call the engine complete or claim improved musical quality until its gates and listening comparison are finished.
