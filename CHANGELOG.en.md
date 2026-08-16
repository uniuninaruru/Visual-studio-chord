# Changelog

[日本語](CHANGELOG.md) | [**English**](CHANGELOG.en.md)

Notable changes are recorded here. Dates use `Asia/Tokyo`. The
[Japanese changelog](CHANGELOG.md) contains the complete pre-0.4 history.

## Unreleased

### Changed — the five tools become one region with tabs

Below the two views of the piece the centre column ran on for another **two
thousand pixels**: a repair offer, a search box, a reharmoniser, a variation
list and the profile-and-history pair — **every one permanently expanded, and
never more than one in use.** Someone looking for the history scrolled past four
panels about something else to reach it. Measured after: the column is three
blocks instead of seven, and the tools occupy 180px.

They are modes, so they are tabs. Nothing is removed and nothing is more than
one press away.

**Hidden, not unmounted.** Every panel stays in the tree with `hidden`, which
takes it out of the accessibility tree and out of tab order while leaving its
state alone. A typed search query, a half-chosen comparison, a candidate
part-way through auditioning: all of it survives a trip to another tab, and
anything that queries the DOM still finds them. Unmounting would have been the
cheaper implementation and the wrong one.

**Content arriving from elsewhere takes the tab.** The variation list is filled
by the regeneration dock at the bottom of the screen, outside this region —
generating candidates and seeing nothing happen would be worse than the scroll
this replaces. That is the only automatic switch, and it fires on the **rising
edge only**, so a claim that is merely still true does not fight a deliberate
move away. A tab that only HAS content shows a marker and waits.

**The search lost its own disclosure.** It lived in a collapsed `<details>`, and
once the tab became the way it is reached that made two things to open before
anything was on screen.

Arrow keys move between tabs and wrap; only the selected tab is in the page's
tab order, because a tablist is one stop rather than one per tab.

### Changed — the two views of the piece side by side, and five readouts instead of seven

**The chord lane and the piano roll are the same music at two resolutions** —
the lane is the harmony, the roll is the notes inside it — and three panels sat
between them: a repair offer, a search box and a reharmoniser. A reader
scrolling from the chords to the notes passed all three, so **the thing being
edited never appeared on screen as one thing.** They are adjacent now and the
tools follow in the order they are reached for. Nothing left the column and
nothing was collapsed; this is the order changing, not the content.

**Two of the strip's seven items were not independent facts.**

Loop is gone: App rendered **the same string from the same variable** into the
transport bar forty pixels above. The prop went with it — the pending-loop note
compares against the committed label, and that comparison already happens in
App. My first attempt kept the prop with a comment claiming the pending note
needed it, which was not true.

Engine and Connection are one item: they describe **one subsystem**, where
inference runs and whether it is reachable. Both strings are kept, because
"offline" and "no server" are different states.

No information left the screen. At 375px the strip's scroll width goes from
1294 to 1002. `tests/projectStatusBar.test.tsx` pinned the duplicate and now
asserts its absence.

### Investigated — the async paths and editing during playback are both sound

Two areas left unverified, chased down. **Neither produced a code change.**

**Races in candidate generation (652 lines).** It carries an AbortController per
run, server-side cancellation, and **every await either passes the signal or is
followed by an `aborted` check**. The `finally` is guarded by
`controllerRef.current === controller`, so a stale run cannot clear the current
controller. The theory fallback takes the signal too. **No demonstrable race, and
no speculative "fix" written.**

**Editing during playback.** `applyImmediately` is
`status !== "playing" || timing === "immediate"`, so an edit made while stopped
always commits at once — the failure I suspected, where "apply immediately"
would wait for a tick that never comes, is already guarded. A deferred edit
stranded by pressing stop is committed by the stop. The tick callback re-reads
the committed composition imperatively and reschedules.

### Added — the left hand holds a shell instead of a single note

**This app had no left hand.** It voiced one chord and split it by pitch —
`pitches[0]` to the bass track, `pitches.slice(1)` to the chords — and a split by
lowest note can only ever hand the left one pitch. Measured across eight styles
and four seeds: **0 polyphonic left-hand onsets out of 102 each**, without a
single exception, in a band eleven semitones wide, while the whole texture
averaged 13.3 semitones against the 19 a corpus study gives to one hand.

A voicing is, by definition, "which notes are on the top or in the middle, which
ones are doubled, **which octave each is in**, and **which instruments or voices
perform each note**". This app decided the first three and let the fourth fall
out of the third.

**The interval is read off the bass.** Not from style. `LOW_INTERVAL_LIMITS`
already says how low each interval may be placed, and it lists nothing above an
octave — which is exactly why a tenth is what a left hand reaches for down there,
and why "no close four-note structure below C3" and "Powell's shells are R+3,
R+7, R+10" are the same statement. A bass at D2 can carry a seventh, whose limit
is D2, and cannot carry a third, whose limit is A2. **The bass itself never
moves**: dropping the foundation to make room trades one kind of mud for another.

Measured with it on: 432 of 825 chords take a partner, the intervals come out
{fifth 62, seventh 130, octave 236, minor tenth 4}, and the texture goes from
13.3 semitones to 16.3.

**Three things I got wrong on the way**, each caught by measuring: checking the
interval against the bass alone missed the pair the partner forms with the note
above it (13 violations) and the minor ninths it forms with right-hand tensions
chosen before it existed (10 more); a count of left-hand notes cannot express an
assignment where the partner sits above part of the right hand, which is what
reaching a tenth means; and widest-first put the octave — the one interval always
available — ahead of everything, 414 times out of 432, with the minor tenth
missing from the list entirely so a minor chord could never have one.

**What it collided with.** The arrangement checker called any left-hand note at
or above the lowest right-hand note a crossing: 73 errors. Those are two rules
that are indistinguishable while the left hand is one note. What has to hold is
that the bass is the bass and that the hands have not swapped; between those is a
hand position. The no-swap half is judged on the voicing rather than the instant,
because a comping figure striking only the lower part of the right hand does not
move anybody's hand.

### Fixed — a chord describing hands it no longer has

A hand assignment is a set of pitches, not an index, so it goes stale the moment
the notes change under it — and three paths changed the notes without touching
it. Measured: changing a chord's symbol left `leftHand: [43, 55]` on a chord
whose notes had become [57, 60, 64, 65]. The track builder removes the left
hand's pitches from the right by value, so a stale one sounds in the bass and
stays in the chord as well.

`withHands` re-decides the assignment from a chord's current notes, and both
generator paths go through it. `replaceChordSymbol` cannot — it has no access to
the bass register settings — so it drops the assignment, which is always valid.
The importer validates `leftHand` as a subset of `notes` whose lowest member is
the chord's lowest note.

### Investigated — the tenth and the section arc want the same register

The left hand cannot reach a tenth here: the partner would land between 52 and
64 and the right hand's top sits at 53 to 58. **3 tenths in 609 chords.**

The room exists — the gap between the accompaniment's top and the melody's bottom
has a median of **twelve semitones**, on every chord. Aiming a stated distance
under the melody instead of at a fixed pitch delivers: at a clearance of 18,
**tenths go from 3 to 34**, the texture widens to 18.9 semitones, shells rise
from 63% to 69% of chords, arrangement errors fall from 24 to 22, and the melody
stays the ceiling (52 chords reach it before, 61 after).

**It also costs the section register arc, which is why it ships off.** The
clearance puts a ceiling under the melody that every section is pushed against,
and the arc is the distance between sections: the intro's accompaniment rose from
53.93 to 56.14 against a chorus at 56.95, turning a contrast of 2.67 semitones
into 0.81. Both are measured features wanting the same register, and choosing
between them is a judgement about how this app should sound rather than a defect
to fix — so the measurement and the setting are kept and the default is
unchanged.

### Fixed — Space was taking every button press in the app

The play/pause shortcut called `preventDefault` on Space unconditionally once
no text field had focus. Space is also **how a keyboard user presses a focused
button**, and preventDefault cancels that activation — so tabbing to 生成 and
pressing Space started playback and generated nothing. Verified in the running
app before the fix: with the generate button focused the event came back
`defaultPrevented` and the button never fired. **Every button in the app was
unreachable this way.**

Space belongs to whatever has focus if that thing answers to Space itself — a
button, a summary, a link, a checkbox, a radio, a range, or anything carrying
those roles — and to playback otherwise. The guard lists what DOES answer to
Space rather than what does not, so a merely focusable panel keeps the shortcut.

Read from `document.activeElement` rather than the event target, because the
listener is on window and a key pressed with nothing focused targets the body.

Escape now closes a mobile sheet as well, innermost first. That path had **no
keyboard exit at all**.

One of the new tests reported the typing guard broken when it was not:
dispatching a KeyboardEvent at window directly leaves `event.target` as window,
which no real keypress does.

### Added — one line saying what is selected

**Three selection concepts, and nothing said which was live.** The chord and the
notes are React state in App, the bar range is in the store, and each is read by
a different set of actions. A user could see a highlighted chord and a
highlighted range at once with no way to know that 選択範囲を再生成 would ignore
the chord.

One line under the piece title names what is selected, **ordered by narrowness
rather than importance**: notes sit inside a chord which sits inside a range, so
the narrowest live selection is where the user is actually looking. It states
what IS selected rather than what any one button would do to it, which is the
only version true for all of them.

Nothing selected is said positively — "選択なし — 操作は曲全体に働きます" — because
"nothing selected" alone leaves the reader to guess whether the next press does
nothing or does everything. It does everything.

**The chord lane is first now.** The Auto Fix card sat above it, so the first
thing in the column was an offer to repair something the reader had not been
shown yet. It stays on screen, under the chords.

**The progression search says what is behind it** — fifteen hundred
progressions and the one control that puts one into the piece — with the
destination following the selection.

### Added — a dark theme, and a colour system that can carry one

There was **no dark mode**: zero occurrences of `prefers-color-scheme` in 3389
lines of CSS. The reason it could not simply be added is that the token block
governed about **a seventh** of the colour decisions in the file. **154 literals
in 92 distinct values** lived outside it — 40 bare `white` keywords, 74 hex, 40
`rgb()` — and six more lived in TypeScript, applied as inline styles where no
stylesheet rule could ever reach them.

So this is one change: **every literal becomes a token, and the token set gains
a second value.**

**What moved, beyond a straight port:**

The **three harmonic-function colours** drive the chord lane, which is this
app's semantic core. Measured, all three sat within 2.5 of each other in L*, so
**the only channel separating them was red-green** — and simulated through
Viénot, **tonic and predominant collapsed to a CIE76 difference of 9.3 under
protanopia**, below the threshold for telling two colours apart at all. They are
carried on a 3px stripe, and the text label that would disambiguate them is
`display: none` the moment harmonic rhythm subdivides a bar. Rotating
predominant from violet toward magenta separates them along the blue-yellow
axis, which both protanopes and deuteranopes keep: **9.3 → 25.8** protan,
**18.1 → 45.3** deutan, every contrast ratio holding at or above 6.1.

The **six track colours** moved out of `src/music/*.ts`. **Four were already
under 3:1 on white** before dark mode was a question, and the `${track.color}99`
alpha concatenation only works on a hex literal — the same 60% over a dark
canvas is not the same colour as over a white one. Each track carries a tuned
`fill` token now. `fill` is optional so a project saved before today still
opens, and the JSON validator's colour check widened to hex-or-track-token
rather than to "any string": the value goes into a style attribute, so an
imported file must not be able to put arbitrary CSS there.

The **focus ring** went 20% → 35% alpha; a 3px ring at 20% is weak on light and
near-invisible on dark. The **playhead** went from `#eb4d5b`, which was 3.9:1
against the lane, to `#d92d3c`.

The **theme control** sits beside the mixer in the menu, for the reason the
mixer is there. Three options rather than a switch, because "follow the machine"
is a third state a switch cannot say — and that option reports **what the
machine says, not what is on screen**. `index.html` applies the stored theme
inline before first paint, because a module script runs after paint and a stored
dark theme would otherwise flash white on every load.

### Fixed — a type scale, and no more seven-pixel text

Measured: **twenty distinct rendered sizes, 273 elements below 11px, 195 of them
at 7px.** Seven pixels is not a small size, it is an unreadable one — Japanese
kana lose the strokes that tell them apart, and the Latin caps labels this UI
leans on stop being words and become texture. The label was costing pixels and
informing nobody.

Eight steps from 10px to 22px, 172 declarations remapped, **nothing below 10px**.
The smallest step is reserved for dense in-canvas labels where the alternative is
not showing the information at all.

**What raising them broke:** growing `.piano-note span` from 7px to 10px made 70
note names overflow. A clipped "C" where "C5" was meant is worse than no label —
it names a different note. So it is hidden rather than clipped on notes too
narrow to hold it (69 of 130 on screen), and the other 61 are legible where none
were before.

### Fixed — four layout breaks

**The transport bar declared three columns and had four children.** The fourth
wrapped onto an implicit second row and into the 350px first column: the bar
rendered 81px against its stated 72, "編集反映" broke to two characters per line,
and all of it sat under the hamburger rather than at the right where its own
`justify-content: flex-end` says it belongs.

**The status strip stuck 25px inside the transport bar on mobile** — two
hard-coded numbers in two places each, disagreeing with reality at the narrow
breakpoint. One `--transport-height` token feeds both now.

**The regeneration dock squeezed its selection label to 58px**: `1fr auto` gives
the auto column its content first, and the controls need 273 of 375. Measured,
"7–7 小節を選択中" rendered **58 wide and 125 tall**. It is the label that says
what the button beside it will act on.

**Four panel headings put their title in a column beside their own description.**

### Fixed — hit targets, contrast, and three mistakes in my own measurement

**186 controls rendered under 32px tall** — selects at 23, the settings tabs at
30, every `.text-button` at 27 because a later `min-height: auto` opted the
family out of its own 38px floor. One `--control-height` token now, with the
in-canvas objects (notes, bar locks, voice chips) named in a single explicit
exemption. **Controls under 32px outside the canvas: zero.**

Three contrast failures fixed: the bar number (2.59 light, 4.43 dark), the
explanation copy button I added earlier today which **had no background at all**
and rendered with the browser's own grey chrome, and the note name in a
secondary voice. **Failures in both themes: zero.**

**And a note on measurement, because three of my own audits were wrong.**
Reading `getComputedStyle` in the same JavaScript task as a theme switch returns
**interpolated** values — the transitions are 140ms and the colours are
mid-flight. That reported twelve failures where there was one, twice. And an
audit that reads an element's own `rgba()` background without compositing it
over its parent treats a 30% wash as opaque, which is what made the last figure
look like a failure when the composited value passes at 6.75.

### Added — the A/B judgements now decide what gets generated

The preference model has been learning since the A/B panel existed and
**had never once changed what came out of the generator.** `generator.ts`
holds no reference to preference of any kind: every judgement went into
reordering five candidates that had already been drawn.

The model cannot compose. Its features measure a finished piece — how often
the melody leaps, what share of chords are sevenths, how wide the voicings sit
— and there is no inverse from a weight on `melody.leapRate` to a generator
setting. **What it can do is choose.** So generation draws several pieces and
keeps the one the model likes best: best-of-n, said plainly.

**Measured on seeds it was never trained on**, which is the only measurement
worth having. A model taught from twenty A/B pairs where the piece with more
sevenths won moves the seventh rate of twenty held-out seeds from **37.5% to
66.2%**, and reaches past the first draw in eighteen of them.

**Same seed, same piece survives intact.** The draws are seeds derived from the
one the user gave, and the winner carries the derived seed it was drawn from.
Generating `abc` with a trained model may hand back the piece whose seed is
`abc#3`, and `abc#3` reproduces it exactly, with no model, however much is
learned afterwards.

**Off by default, and doing nothing is not a special case.** An untrained model
has no weights and no bias, so every candidate scores zero, the tie goes to the
earliest draw, and the earliest draw is the seed as typed. Eight draws of a
thirty-two bar piece take 514ms, which is why the count is a setting and why it
is clamped rather than trusted.

### Added — a found progression can be used, and the piece explains itself

Two things the engine already did and the app never surfaced.

**"Use" in the progression search.** Fifteen hundred progressions listed and not
one of them could reach the piece: 試聴 sounded the first chord, and the panel's
`onApply` had no caller. A progression is a sequence of degrees, not of
durations, so **the bars keep their harmonic rhythm and their chord ids, and
only what each one spells changes.** Four steps over six chords cycles, which is
what a four-chord loop over eight bars already is.

Where it lands is named on the button (the selected section, failing that the
selected bars, failing that the whole piece). Replacing four bars of chorus when
one bar was expected is not a mistake anyone can see coming.

A rewritten section gives up the progression it recorded, and takes the new one
only when the caller has a catalogued name to give — a derived variant was never
written down under a name, so it hands over none. Without this the explanation
panel goes on calling a rewritten chorus the royal road, which is **the app
stating something false about itself** in the one place a reader goes to find
out what it did.

**The whole-composition explanation.** `explainComposition` assembled what each
section is for, which progression it was built from, where it modulates — and
nothing displayed any of it. Selecting a chord explained that chord; selecting
nothing explained nothing. The composition summary now carries the same
justification per section, with the prose form offered for copying.

### Added — a long piece can reach its 落ちサビ and its 大サビ

The verse-chorus form ran out at eight sections: intro, two cycles, outro. **It
could not state the shape it is named for** — a bridge after the second chorus,
then the sabi twice more, once stripped back and once at full height.

Eleven sections need forty-four bars to clear the four-bar floor, so the layout
is reachable only at the longest length the app offers. That is the point rather
than a limitation.

Both borrow the chorus's progression by construction. **Three progressions where
the form calls for one heard three ways would be three pieces of material, and
none of them would read as a return.** Everything separating them lives in the
per-kind tables, so the tests measure whether those tables actually separate
them. Pooled over six pieces: the 落ちサビ is the quietest thing in the piece at
46 velocity against the intro's 56, the 大サビ the loudest at 90 against the
choruses' 82, and the accompaniment midpoint goes 52.90 to 54.68 with the
choruses between them.

The remainder pass in `allocateBars` is rewritten as the largest-remainder
method it already claimed to be. Handing the whole remainder to the heaviest
kind that fits is the same fault as dumping it in the last section. The
eleven-section form leaves four spare and every kind rounds down to nothing, so
**the 大サビ took all four and the other ten sections got none.**

Two of these tests were written from one piece, which is one section per kind at
this length — **measured that way the register table could be replaced with any
other number and they still passed.** They read six pieces now, and neutralising
the 大サビ's register entry turns its 1.78-semitone lift into -0.29.

### Fixed — a one-bar pre-chorus is not a pre-chorus

Sixteen bars gave `intro(1) verse(3) preChorus(1) chorus(3) verse(3)
preChorus(1) chorus(3) outro(1)`. **Three of the eight sections were a single
bar.** That is a division of the bar count, not a form.

The floor is four bars, from this app's own `phrases.ts`: four bars is an
antecedent and a consequent, eight the full sentence. It applies twice — no
layout is chosen unless every section in it clears the floor, and the bars
inside are handed out floor-first — and **both were needed.** With only the
layout bound the weights redistributed underneath it and the pre-chorus fell to
two; weighting first and repairing after was worse, because the trim took bars
from the lightest kinds, which were exactly the ones at the floor.

Two things this exposed, both older than the change.

**The chorus did not arrive in its register, it climbed into it.** Voice leading
is measured from the previous chord and outweighs the register wish by design,
so the pull had to overcome it bar by bar. Across eight pop pieces, the chorus
midpoint by bar of its own section: 50.3, 51.4, 53.8, 54.7 — **the first two
bars sat below the verse that set it up**, and the section was half over before
the lift landed. It was invisible while sections were weighted, because a longer
chorus had bars left after the climb to carry its average. The reference is now
moved by the register change rather than discarded, so "smooth" keeps its
meaning at the new height. The chorus-verse gap is positive in all eight styles
(0.17 to 1.74).

**The key finder named keys that cannot spell the melody.** Krumhansl-Schmuckler
correlates against twelve numbers, so weight outside the scale costs a little
rather than ruling the key out. Two melodies in ten — **a C major tune with no
accidentals anywhere, called E natural minor**, a scale with no F in it, over an
F sounding seventeen times. Candidates are now ranked by how many sounded
pitches the key has no room for before correlation decides among equals: no
constant, and the old ordering exactly when the criterion has nothing to say.
Zero in ten now, and the imported-melody chord-tone rate matches what supplying
the key by hand gets.

**Four chords in 3297 sit under a low interval limit** where none did before.
Each is the same corner: **every voicing of that chord that clears the limits
would cover the melody.** Measured on one, twelve clean candidates exist and the
cheapest costs 57.2 for burying the line against 39.6 for the violation. The
test now states the claim it is entitled to — the section register adds no
violations, which measures identical with it on and off — rather than an
absolute zero that was a fact about particular pieces.

### Investigated — neither the cluster rate nor the missing pre-chorus templates is a defect

Two items recorded as unresolved, chased down. **Neither produced a code
change.** That is the third time this session a suspect I named turned out
innocent, after the hysteresis and the counting changes.

**Cluster rate, 2% against a reference of 12%.** The suspect was the `cluster`
weight -- 0.35 to 1.8 across styles, a fivefold spread I set by hand. Measured:

```
chords where a clustered candidate exists   56%
chords where the winner has one             2-3%

what that candidate pays more, of a 15.85 gap
  melodyCovering +5.50 (35%)   density +4.48 (28%)
  topVoice +1.85   melodyClash +1.48   cluster +1.23 (8%)
```

**The cluster weight accounts for 8%.** It is the third parameter measured and
found near-inert, after `maxSpan` and `bassCrowding`. What actually suppresses
them is melodyCovering -- which is the voicer doing its job -- and `density`
(`|voice count change| × 2.8`, the only cost term with no profile weight).

Loosening density would move the number. The reference corpus is no longer to
hand and there is nothing to justify a value for how much a real player's voice
count varies, so it is left alone. **Tuning it on nothing would be the same
proxy-optimisation this session already got wrong once.**

**Zero pre-chorus templates.** Recorded as a gap, and that was wrong. A
pre-chorus draws from `preChorus`, then `verse`, then `any`, so the
fall-through covers it. Measured over 40 seeds and 2 styles:

| mode | intro | verse | **preChorus** | chorus | outro |
| --- | --- | --- | --- | --- | --- |
| major | 5 | 5 | **5** | 7 | 7 |
| naturalMinor | 7 | 6 | **7** | 8 | 8 |
| mixolydian | 9 | 9 | **9** | 5 | 5 |

**The same as the verse.** A hole in how the catalogue looks, not in what the
generator produces.

Further sourcing for pre-chorus progressions found nothing clearing the bar.
Of five a source lists for the section, two are progressions already in the
catalogue under other names, the rest and one other are single-sourced, and
individual song transcriptions are what this catalogue explicitly excludes.

### Fixed — a two-handed shape can now say that it is one

Found while chasing the eleven semitones of vertical room the accompaniment
leaves unused, and it is **a bug this branch introduced**.

The measurement that ended the search: a voicing twenty or more semitones wide
that clears the melody entirely exists for 69% of chords in pop and 74% in
ballad. **The melody is not what stops it.** What that candidate pays instead is
clarity 5.47, spacing 4.20, topVoice 3.69, motion 1.12.

`spacingInversion` infers where a voicing's hands divide by looking for a hole
of an octave or more, which is all the pitches can tell it. `twoHandClose` --
added on this branch precisely to supply the missing two-octave width -- has a
**nine-semitone** hole between a left hand on the root and fifth and a right
hand a fourth above the octave. Nine is under twelve, so it was judged as one
stack and charged four semitones of inversion **for the hole that makes it what
it is**. Ten, in pop, against a total gap of about fourteen.

Declared rather than inferred. The catalogue knows which shapes are built as two
hands; one that is not is unaffected, and the inference still runs for it.
Loosening the threshold would have changed every shape's score to fix one.

**What it does and does not do.** Span medians move 29 to 28, low interval
violations stay at zero across every style, melody cover is unchanged. Ballad
moves a long way -- 4.45 voices to 3.20, two-hand share 75% to 93% -- which is
**past** the classical reference rather than toward it, so on voice count that
style is now wrong in the other direction. Recorded rather than tuned away.

A mutation removing the selector's one argument -- leaving the metric fixed and
unused -- passed every test in the file. The wiring is now tested too.

### Added — the app says why it wrote what it wrote

It always knew. Every chord carries its roman numeral, its function, the mode it
was borrowed from and the degree it resolves to. Almost none was shown: of 171
chords of the shipped defaults, **44%** carried an `explanation` and the rest
carried none, because `validateComposition` only requires one where a chord is
not diatonic. The ones that existed read `"Slash chord: Em7 over B."` -- true,
mechanical, and silent about why that chord is there.

Computed rather than stored: it needs the whole piece to say anything useful,
and writing it into the composition would change the composition.

**Every statement names the body of theory it comes from.** That is the bar the
rest of this app is held to -- the progression catalogue admits nothing without
independent sources, the low interval limits cite the standard orchestration
table, the key finder names Krumhansl-Schmuckler -- and the first draft here was
my own paraphrase, which was not.

Checking against the literature changed two definitions. A tritone substitution
is not "contains a tritone" -- every dominant seventh does. The two chords share
the **same** tritone with the third and seventh exchanged, and the root a
semitone above the tonic is where the chromatic bass step comes from. The three
functions are stated as function theory states them: stability, departure,
tension seeking resolution.

Two things it got wrong before the tests: it printed "the 4th chord of a
three-chord progression", and it said nothing at all about a chromatic root the
engine had not labelled.

Noted and not fixed: the engine classifies a ♭II7 as tonic function. The
explanation reports that faithfully, which is how it was noticed.

### Added — a thousand progressions, and a way to find one

**There are not a thousand named progressions.** Hand-curating that many means
abandoning the bar or inventing the sources. Applying documented devices to
documented progressions does not: 1464 across five modes, each carrying the id
it came from and the devices applied, and the interface says so.

The devices are guarded by what they are named after, which is where this could
have gone wrong quietly. A tritone substitution is offered only for a V that
resolves to the tonic, and not for a V something else already points at. A
secondary dominant is not inserted between a chord and the one it is already
approaching. **Six such defects were found by the tests rather than by reading.**

Search takes one line and tries every reading at once: `4536`, `IV V iii vi`,
`王道`, `サブドミナントマイナー`, `b2`. Two bugs recorded: the roman parser read
`IVmaj7 V7 iii7 vi` as 4741 because numerals are not self-delimiting once their
separators are gone, and a two-character query matched the `-2` disambiguating
derived ids.

### Added — the minor catalogue, and more than one rhythm

Four minor progressions, each clearing the same bar as the rest of the file.
Minor bridges go from two distinct progressions to six. The tier threshold moves
with them: "widen a tier holding one" fixed a constant and left a coin toss, and
a minor chorus then had exactly two. Major output is byte-identical under either
threshold; mixolydian is not, which is worth saying because I first assumed it
would be.

`chordRhythms` gives the chord track more than one rhythm. With the arpeggio
off, every chord in every style was struck once on its own downbeat and held --
240 chords, 240 onsets. Ten comping figures written in beats from the bar line,
each declaring the meters it was written for. Onsets per chord: pop 1.60, jazz
2.00, edm 3.24, ballad 6.10.

### Removed — a cost term that could never have charged anything

`bassCrowding` never charged anything: no caller ever passed a bass. Wiring one
would not have helped, since the bass is taken from the chord's own lowest note,
so the gap is zero before `bassRegisterPitch` or a whole octave after -- a
constant added to the whole field either way. My own diagnostic reported a cost
of +2.09 for it, which was the diagnostic passing a bass the real pipeline does
not.

### Fixed — the voicings were never sounded as chords

Measured across eight seeds at sixteen bars of the shipped defaults, the chord
track had **1024 onsets and not one of them sounded with another**; its greatest
simultaneity was a single note.

The arpeggio was on by default and released each note before the next — a
216-tick note at a 240-tick step. Every voicing was played as a bare line, so
every cost term that reads a simultaneity (the clusters, the spacing inversion,
the low interval limits between chord voices) was deciding something that never
sounded.

`ArpeggioSettings.sustain` holds each note on to the chord's end, as under a
pedal, so the figure accumulates into the chord instead of replacing it.

| | Time with three or more notes sounding | Greatest simultaneity |
| --- | --- | --- |
| Before | 0% | 1 |
| After | **63%** | 4 |

A pitch is released when the figure strikes it again: two copies of one pitch
overlapping is a stuck note rather than a thicker chord. Off by default, and the
composition id only changes when it is asked for, so **anything that already
sounds a certain way keeps sounding that way**.

### Added — the accompaniment moves register with its section

`dynamics` already claims that a chorus is louder than the verse that set it up.
Nothing made the same claim about where the hands sit, and measured, nothing
did: across every style, every section and every piece, the lowest note of the
accompaniment had a median of **MIDI 43** — one register for all of it — and the
chorus sat **2.4 semitones below** the verse.

`SECTION_REGISTER` gives each kind an offset, shaped like `SECTION_INTENSITY`
including the bridge sitting under the verse (a bridge contrasts rather than
climbs, and one arriving above the chorus would spend the arrival it exists to
set up). Written as a pull rather than a bound: the melody and the low interval
limits outweigh it by an order of magnitude.

Two things had to be measured rather than assumed.

**The anchor is 52, not middle C.** This app's accompaniment sits with its middle
at 52 once the melody, the bass and the limits have had their say, so a target of
60 asks for a move no candidate can make — the term then adds a constant to every
candidate and decides nothing. With 60 the chorus-verse gap went from -2.4 to
-1.4 and every whole-piece figure was identical. With 52 it reaches **+1.16**, a
swing of three and a half semitones, and the chorus rises rather than the verse
merely dropping.

**The trade is real and there is no free point on it.** Sweeping the offsets,
melody cover rises monotonically with the arc — 10.2% at rest, 11.3% at four
tenths, 13.3% at full — with no knee to sit on. Raising the accompaniment moves
it toward the melody because the melody is above it; that is arithmetic, not a
tuning failure. Full strength is kept and **the 13.3% figure is written into the
test**, so the cost is stated rather than discovered later. Low interval
violations stay at zero across all eight styles.

### Fixed — the most ordinary piano voicing could not be generated

Chasing why weight tuning could not move the voicings toward a classical piano
reference: **the target width was ungenerable**. Measured across three styles, of
roughly three thousand candidates offered per style:

```
offered  <12: 21%  12-17: 41%  18-23: 24%  [24-29: 0%]  30-35: 12%
```

Two octaves is the median width of the reference — 974 files, engraved and
performed, agreeing — and it is the first shape a hand finds. The catalogue could
not make one: `twoHandVoicing` lifts the right hand a rigid two octaves above the
root, which puts everything it makes at 30 or more, and an octave lower lands at
19-22. Nothing bridged them.

`twoHandClose` does: left hand root and fifth, right hand holding the chord from
its third an octave and a fourth up. **C3-G3 under E4-G4-C5.** The width comes
from inverting rather than transposing — the root ends up on top instead of
underneath the hand — which is also why it is not reachable by sliding an
existing shape.

**What it fixes, and what it does not.** A candidate 20-28 semitones wide now
exists for every chord, against 94% before, and the shape is chosen three or four
times per style. The distance to the reference moves by 0.002 to 0.025 depending
on style, and one style gets slightly worse. The chosen median span is still
**12** — and setting that 12 beside the reference's 24 was a mistake, as below.

So the hole was necessary and nowhere near sufficient. A 20-28 candidate sits at
the 21st percentile of the cost ranking, meaning a fifth of all candidates still
beat the best wide one.

**This entry originally said that hysteresis in four connection terms was what
held the texture still. Measured, it is not.** Making `motion`, `retention`,
`density`, `coherence` and `topVoice` free moves the chosen width from 13.55 to
14.09 in pop. The best candidate ignoring them entirely already sits at the 5th
to 6th percentile of the real ranking. The connection terms account for 1.57 of
the winner's mean cost against 3.52 for everything else.

**And the comparison itself was wrong.** The reference median of 24 semitones is
the width of a solo piano's *whole texture*; 13.4 is this app's *accompaniment
alone*. Measured the same way — every track together — this app is **29**
semitones against the reference's **24**. It is wider, not narrower.

Nor is the accompaniment's width forced. There are **24-25 semitones of room**
between the top of the bass and the bottom of the melody; the accompaniment uses
**56%** of it and comes within two semitones of the melody on only **15-22%** of
chords. Eleven semitones sit unused. What holds it there is not yet known.

Also removes a guard in the new shape that nothing can reach: the gap above the
left hand is seven semitones at its narrowest by construction. A mutation test
left it standing, which is how it was found.

### Added — a menu with a guide, release notes, credits and volume

Four things that had nowhere to live. The guide only existed as a first-run
tutorial nobody could get back to once dismissed; there was no statement of what
changed between versions; the licences of the dependencies were in
`package.json` and nowhere a user could see; and **there was no volume control at
all, at any level**.

The panel slides from the left rather than centring, because everything in it is
read beside the work rather than instead of it — playback keeps running while the
faders move.

The mixer is master, per-track and reverb, stored as fractions and converted at
the edge.

- **Faders are squared on the way to a gain.** Loudness is roughly logarithmic,
  so a linear slider spends most of its travel barely changing anything
- **Zero is real silence** rather than a very small gain: -60 dB is still audible
  on headphones at night, and a fader at the bottom should be off
- **Kept outside the project** and out of exported JSON, since the volume someone
  listens at is a property of their room rather than of the piece

The transport holds the values until it has synths to apply them to, so a volume
set before the first play is not discarded — and a fader moved during playback
reaches the nodes rather than only the label beside it. **Both are tested, the
second because a mutation removing the live path left the first one passing.**

### Fixed — fitted the voicing profiles to classical piano, and kept none of it

974 classical piano MIDI files — Mutopia's engraved scores and MAESTRO's recorded
performances, 487 to fit against and 487 held back — against a coordinate descent
minimising `voicingDistance` over the 72 numbers in the profile table. **The
fitted values were measured and discarded.** What the exercise established is
worth more than they were.

**Weight tuning cannot reach the reference.** Held-back reference: median span 24
semitones, 3.95 voices, seconds sounding 12% of the time, inverted spacing 58%.
This app before: 29 / 4.47 / 2% / 86%. After a full fit: 28 / 4.42 / 2% / 87%.
The composite distance fell 4-9% and **not one property a listener could name
moved**. The weights are not what holds the output there — the candidate
generator and the shape of the cost are. Same finding as `maxSpan` never binding,
from the other direction.

**Optimising a proxy is dangerous in proportion to how hard it is pushed.** The
distance reads ten geometric properties and cannot see whether the melody is
still audible. Unconstrained, the search cut it by 25% and **buried the melody
under the accompaniment on half of all chords, against a tenth before**. Freezing
the melody weight did not help: the cost is a weighted sum, so a neighbour
allowed to grow fiftyfold demotes a frozen weight just as surely, and burial
still reached a third. Only bounding every weight and refusing any candidate that
buried more melody kept it honest — and that is the version that gained 4-9% and
changed nothing.

**Classical piano's geometry transfers; its texture does not.** Two independent
bodies of it agree closely on span, voice count and spacing despite sharing no
provenance, so what they describe is real. But solo piano carries its own melody:
a chord tone above the tune is ordinary inner-voice writing there and a buried
vocal here.

Kept: `voicingDistance`, so the next attempt is measured rather than argued, and
a comment on `VOICING_PROFILES` recording that a relationship which looks
arbitrary was given the chance to be overturned and was not.

### Added — measuring the transition prior against progressions it never saw

Every earlier figure for this prior was circular. It is counted from the
progression catalogue, and 30% of the four-bar windows this app produces are
literally template sequences, so scoring the app's output against it asked the
catalogue whether it agreed with itself. Leave-one-out removes that.

| | Score |
| --- | --- |
| Its own training data | 0.351 |
| **Held out (unseen)** | **0.435** |
| Random sequences | 0.698 |

The gap between the first two is the circularity; the gap between the last two is
the prior's real claim. It is now a test rather than a diagnostic, so more data
or added context can be measured instead of argued about.

The counting changes that prompted it are reverted, because held-out measurement
says they were not worth anything:

```
wrap 1.0, unnormalised (kept)  0.270
wrap 0.5                       0.268
normalised per template        0.268
both                           0.268
wrap not counted at all        0.258
```

Sample-scaled smoothing likewise: the held-out separation was unchanged and the
gap between the commonest move and an unseen one widened from 6.7 to 20, which
states far more confidence than 129 observations support. It also broke two
existing tests, which were right. They survive as options at their measured-best
settings, with the figures recorded, so the same reasoning is not retried from
scratch.

### Fixed — selecting a chord stopped the stop button giving the piece back

Selecting a bar in the chord lane narrowed the loop to it, and pressing ■ then
returned to the head of the selection rather than the head of the piece. `stop()`
now widens the loop to the whole piece without clearing the selection.

### Changed — CI runs on every branch, not only on main

CI fired on pushes to `main` and on pull requests, and nothing else, so **a branch
worked on for days before it opens a pull request ran no checks at all**. Five
commits sat on `feat/melody-aware-voicing` with a browser end-to-end test broken
by the defaults being switched on, and the first run able to catch it was the
pull request, three days later.

Pushing to any branch now runs the same suite.

A pull request fires both events for one branch. **Cancelling the duplicate was
the first attempt and it was wrong**: a cancelled run still reports its checks
against the commit, so every pull request carried **twelve cancelled checks**
beside its twelve real ones — measured on this branch, 12 SUCCESS and 12
CANCELLED on the same SHA. `gh pr checks` counts cancelled as failure, so a green
pull request read as half red.

A gate job now asks whether the branch already has an open pull request and, if
it does, the rest of the workflow **does not start**. The pull request runs the
suite; the push says it has nothing to add in one step rather than twelve
cancellations. Concurrency is keyed per event, so repeated pushes still supersede
each other.

### Fixed — the published build talked about a server the visitor never had

Everyone who opened the published site was told **the local AI server is
stopped**. That is accurate for someone running the Docker setup who forgot to
start it, and wrong for a visitor who only opened a link: they never had a local
AI server, and "stopped" reads as something broken, or as something they are
expected to start.

The same build also probed `/api/health`, `/api/device`, and `/api/models`
**twelve times across fourteen seconds** looking for a backend that cannot
exist. The backoff gives up, so it was harmless — and pointless.

A build-time `VITE_PUBLIC_BUILD` flag now makes the published build:

- issue **no probe at all**, settling the connection state immediately;
- report a `browser-only` reason — retries key off `unreachable`, so
  distinguishing the two stops the retry schedule by itself;
- say only what is true for the reader: the app runs entirely in the browser and
  the song is never sent anywhere.

**The Docker and native setups are unchanged**, and someone who forgot to start
the backend still gets told exactly that. Checked against the built bundles: the
published build contains neither the old message nor the probing code, and the
normal build contains neither the new message nor the flag.

Four tests in `frontend/tests/browserOnlyBuild.test.ts`. Removing the early
return, restoring the old message, and reusing the `unreachable` reason each
make them fail.

### Added — nothing to install; it runs in the browser 🎹

**<https://uniuninaruru.github.io/Visual-studio-chord/>**

**No Docker. No terminal, no ZIP, no commands.** Open the link and a chord
progression and melody are generated on the spot, on a phone or tablet just as
well.

Until now the first thing asked of anyone who wanted to try it was "install
Docker Desktop". For someone who only wanted to hear one progression that is far
too much, and most of them were lost there.

**Technically the server was never needed.** Generation, editing, playback, and
MIDI export are all browser-side TypeScript, and `useBackendConnection` degrades
to browser-only rather than failing when no backend is present. Served as a
static site, it needs no server at all.

Having no server removes, rather than fixes, everything a public deployment
would have had to guard:

- the process-wide `PreferenceStore`, which would have returned one visitor's
  chord progressions in another visitor's response;
- a shared token that stops being a secret the moment the frontend is public;
- the absent rate limiting;
- TLS termination.

The only thing the published version lacks is **candidate ordering** by the
909-song empirical model. That changes which of A/B/C is shown first; the music
is identical. Neural harmony was already unavailable, since no checkpoint ships.

The Docker and native setups remain for anyone who wants a GPU or the neural
feature.


### Fixed — a metric whose name did not match what it computed

`primaryMeanNormalizedNll` performed **no normalization**. It was a plain mean,
and it averaged incommensurable quantities: root/quality/bass/inversion are
multi-class cross-entropy in nats, while extensions is a per-label binary
cross-entropy. Untrained, extensions sits at 0.048 and root at 2.01 — two orders
of magnitude apart. `scripts/export-public-training-receipts.py` publishes this
number, so the mismatch between name and content reached public receipts.

- `meanActiveHeadNll` records the **same value** the old key did, under a name
  that describes it. Nothing about the number changed, so earlier measurements
  remain comparable.
- `meanNormalizedActiveHeadNll` performs the normalization the old name
  promised: each head's NLL divided by the NLL of a uniform predictor over that
  head's vocabulary (`log k`, and `log 2` for the binary extensions labels),
  then averaged.
- Each head also records its own `normalizedNll`.

The key was renamed rather than redefined so that two different quantities never
appear under one name. The new field is **optional** in the receipt exporter, so
a run recorded before this change can still be exported.

Measured on a real checkpoint (epoch 8): the mean is 0.2936, while `root` — the
head that actually has to be learned — sits at 0.757 of maximum uncertainty.
Normalizing is what makes visible that four trivially-solved heads were pulling
the headline down.

### Not fixed — the declared training objective disagrees with the implementation

`configs/models/harmonyforge-bimask-base-v1.yaml` declares
`objective: mean_normalized_active_head_cross_entropy`, but
`factorized_active_head_loss` computes an unnormalized mean and mixes the
extensions binary cross-entropy into it. **The same mismatch the metric had
exists in the loss.**

Changing it alters training behaviour and would make existing measurements
incomparable, so it is left as a decision to take deliberately.


### Fixed — the determinism record is now an observation, not a declaration

`deterministic` in `training-run.json` was the constant `True` in the writer
while the reader demanded `True`. **It was a tautology: it could not be wrong,
and so it said nothing.** Publishing a manifest instead of weights — so a third
party can recompute the same hash and verify the reproduction — depends on that
field describing what actually happened.

- `deterministic` is now derived from whether a non-deterministic kernel was
  actually used. The evidence differs by mode: under strict mode torch raises,
  so **completing the run is itself the proof**; under `warn_only` the proof is
  that **nothing warned**. Both come from the run rather than from an assertion.
- Added `--allow-nondeterministic`, which continues instead of stopping when an
  operation has no deterministic kernel. Apple Metal has no deterministic
  embedding backward (`index_put_with_accumulate_mps`), so this is the only way
  to train on that GPU. **The flag does not make a run non-deterministic; it
  only lets one proceed**, and what actually happened is recorded and decides
  what the artifact may become.
- **A non-deterministic run may only produce a `harmony_only_pretraining`
  artifact.** A run that cannot support the reproduce-from-recipe claim cannot
  become the published inference artifact. Together with the task boundary, two
  independent gates keep such weights out of the serving path.
- Ambient warning suppression (`-W ignore`, `PYTHONWARNINGS`, a pytest
  filterwarnings entry) would drop the warning and record a non-deterministic
  run as deterministic. That failure was reproduced against a real MPS kernel
  before being overridden with `simplefilter("always")`.

Twelve tests in `backend/tests/test_training_determinism_record.py`. Reverting
the record to a constant, removing the guard, dropping strict mode, dropping the
boolean check, and dropping the filter override each make them fail.


### Added — a harmony-only, private-local training pipeline

The first weights this project trains are a **private, local-only harmony
pretraining artifact**, not a publishable melody-conditioned model. The
repository distributes no part of the POP909 corpus, no normalized or processed
rows, no split assignments, and no trained weights. Whoever runs it obtains
POP909 from the upstream source themselves and prepares, compiles, and trains
locally.

**Fetch and extract.** `scripts/fetch-pop909.py` clones the canonical GitHub
repository without credentials using a blob filter and a non-cone sparse
checkout, materializing only LICENSE and each song's `beat_audio.txt`,
`chord_audio.txt`, and `key_audio.txt`. MIDI, audio, archives, weights, and
normalized derivatives are never requested into the working tree.
`scripts/prepare-pop909-harmony-only.py` emits only key-relative chord root,
quality, inversion, bass, and extension; harmonic rhythm in integer ticks;
key/mode, meter, and bar position. Melody, audio, lyrics, raw MIDI, performance
expression, voicing, arrangement, and identifying metadata are **not written at
the normalization step**, rather than read and discarded afterwards.

**Compile.** Dataset schema v2 adds a `harmonyOnlyV1` content profile, reachable
only under the `privateLocalHarmonyOnlyTraining` purpose and pinned to a
`privateLocalOnly` distribution scope. Provenance is recorded per dataset or
source subset rather than per song: stable source id, version, canonical URL,
UTC retrieval date, citation, SHA-256 of both the source tree and the normalized
input, the content scope actually reviewed, and the basis for the decision.
`approved` is a project record, not a legal finding; `pending`, `blocked`,
unknown-origin, and checksum-mismatched sources never enter training. When a
ledger declares a preparation descriptor, `--prepare-run` requires the
hash-bound `prepare-run.json` that matches it.

**Atomic installs.** Neither prepare nor compile can damage the last known good
set by failing partway. Each writes its whole output into a staging directory
and publishes it with a single directory rename. An existing non-empty directory
is never an overwrite target — a new versioned directory is required. The
staging directory is flushed before the rename and the parent after it, and file
contents are flushed as they are written, so a bundle cannot appear under its
final name while its bytes are still only in the page cache.

**Docker build-context audit.** The audit now covers not only "stays out of Git"
but "stays out of what Docker uploads". A remote daemon receives the build
context over the network and cache layers can be pushed to a registry, so
careful `COPY` statements are not sufficient. Raw data, trained weights, and
MIDI/audio material are excluded at the context level in `.dockerignore`, with
contract tests. `scripts/check-private-artifacts.py` enforces the boundary in CI
and in `scripts/test.sh`.

**What may be published.** `scripts/export-public-training-receipts.py` verifies
the content-addressed binding between a private checkpoint and its compiled data
and then writes only non-reconstructive receipt JSON — never weights, split
assignments, record ids, source-item ids, raw content, or local paths. The
[data card](docs/research/pop909-harmony-only-data-card.en.md) records the recipe
and contract along with aggregate counts and hashes for a pinned upstream
checkout.

**Not measured.** Full neural training time, cost, convergence, and musical
quality are unmeasured. The data card's source-review status is `pending` per
run for whoever fetches the corpus.

### Added — a safety boundary keeping harmony-pre-trained weights out of inference

The trainer is fixed at melody-conditioned variable-rhythm harmonization.
Weights produced by harmony-only pre-training share the architecture, the
tokenizer, and the config, so **every structural check the loader performs —
tokenizer match, architecture match, SHA-256 of every file — passes on them**.
The declared objective is the only thing separating the two. Loading such
weights as the product model would make the capability the interface advertises
untrue.

There were three gaps.

- **No vocabulary for an honest declaration.** `manifest.task` was a `Literal`
  admitting exactly one value, and the writer hardcoded that same string. A
  harmony-only checkpoint could not be described at all except by claiming to
  be melody-conditioned — the schema compelled the misstatement.
- **The boundary rode on release status.** `MTC_ENABLE_RESEARCH_CHECKPOINT=1`
  reaches the production serving path as `allow_research`. "Not yet evaluated"
  and "trained at a different objective" are independent axes, but they were
  collapsed onto one flag, so a single environment variable admitted the wrong
  kind of model.
- **Nothing surfaced it.** The backend manifest response omitted `task`, leaving
  clients no way to tell the two apart.

What changed:

- `manifest.task` accepts `harmony_only_pretraining`, so pre-training weights
  can be declared honestly. The writers (`save_trained_artifact`,
  `publish_checkpoint_manifest`, `train_reference_model`) take a `task`.
- The loader checks `task` ahead of every other gate and refuses anything but
  the inference objective. **That check does not consult `allow_research`.** A
  dedicated `permit_pretraining_task` argument defaults to `False`, and only the
  training, export, and evaluation paths pass it. The serving path
  (`TorchHarmonyBackend`) never mentions the argument, so **no setting and no
  environment variable can open the boundary**.
- The declared objective is also recorded in `training-run.json`, which is
  hashed into the manifest — putting it inside the verified provenance chain
  rather than beside it.
- `evaluate_checkpoint` can still evaluate pre-training weights, since that is
  how they earn promotion, but its result now names the `task` so a number
  measured on one objective cannot be read as evidence about the other.
- The backend manifest response reports `task`; a rejected artifact appears as
  `available: false` with the declared objective in its reason.

Eight tests in `backend/tests/test_harmony_pretraining_boundary.py`. Both
removing the boundary and folding it into `allow_research` make them fail; the
latter is caught by the test that exists to hold the two axes apart.
### Documentation — README split by audience

- Added a first-time-user path that begins by choosing Docker, Apple GPU,
  Windows CUDA, Linux CUDA, or same-LAN phone access.
- Explained how to open a terminal in the project directory, recognize
  successful and failed startup states, generate the first song, and export
  MIDI without assuming prior infrastructure or ML knowledge.
- Preserved the GPU, neural-model, API/data-contract, security, testing, and
  research material in a separately labeled technical reference.
- Kept the Japanese and English README launch paths aligned.

### Fixed — the adopt button could no longer be reached by its visible text (`browser-e2e` failure)

An `aria-label` added to the "この候補を採用" button on each candidate card replaced
the visible text rather than adding to it. Because `aria-label` **overrides** the
accessible name, the button was named `候補 A のプレビューを採用して履歴へ保存` and
could not be found by the words printed on it.

- This is a **WCAG 2.5.3 "Label in Name"** violation: a voice-control user saying
  what they can see cannot operate the button they are looking at.
- `browser-e2e` failed on all three platforms (ubuntu/chromium, macos/webkit,
  windows/chromium), because the end-to-end test looks the button up by its
  visible text.
- The label is now `候補 A: この候補を採用して履歴へ保存`, which keeps the added
  context while containing the visible words.

**Why the fast test layer missed it**: a unit test asserted that the `aria-label`
contained `"プレビューを採用して履歴へ保存"` — it pinned the wording, so it moved
with the wording. It now asserts the contract that matters, that the accessible
name contains the visible text.

### Fixed — setup rebuilds a virtual environment whose interpreter has gone (`e8546cc`)

`.venv/bin/python` is a symlink. When the Python it points at is upgraded or
uninstalled — an Xcode or system Python is the usual case — the link dangles and
every script that uses the environment fails with a file-not-found error naming
a path that plainly exists.

Running setup again did not help. `venv` will not touch a directory that already
exists: **with pip it exits non-zero, and without pip it exits zero having
repaired nothing**, so a script checking the return code is told it succeeded.

Setup then fell through to its next check and reported `The existing .venv uses
an unsupported Python`. That is the wrong diagnosis and it sends the reader
somewhere useless: the environment does not use an unsupported Python, it has no
Python at all, and installing one will not fix it.

- `scripts/setup.sh` and `scripts/setup.ps1` now rebuild in place with `--clear`
  when the interpreter is missing and the directory exists, and say so while
  doing it. `--clear` discards the environment and never the project.
- If a rebuild still leaves no interpreter, the message says to delete the
  directory rather than blaming the Python version.
- The version complaint is now reachable **only when there really is a working
  interpreter of the wrong version**.
- `scripts/tests/test_setup_venv_repair.py` pins the `venv` behaviour the
  workaround exists for, that each script rebuilds, and the order of the two
  messages. It asserts the outcome rather than the return code, because that
  varies with pip. Removing `--clear` from either script fails the suite.

**Verified** by reproducing the failure and repairing this checkout's own
`.venv`, which had been pointing at a removed Xcode Python: 154 tests pass from
the repository root and 133 from `backend/`, and `import app` works from an
unrelated directory again.

## 0.4.0 — Major update: HarmonyForge neural-harmony research preview (2026-07-28)

This major update turns the research plan into an executable model, artifact,
API, and UI-safety foundation. It does **not** bundle a trained checkpoint or
claim completed musical-quality evaluation. Normal users continue to have the
empirical corpus and deterministic theory engine.

### Added — HarmonyForge-BiMask

- Added a deterministic tokenizer that aligns melody, metre, form, edit masks,
  and locked harmony to sixteenth-note frames.
- Implemented a 12-layer, hidden-768, 12-head, FFN-4096, pre-norm/GELU
  single-encoder Transformer with factorized event, root, quality, inversion,
  bass, extension, function, and cadence heads.
- The implemented module has **104,567,874 parameters**. v0.4 uses learned
  window-position and bar/metrical-position embeddings plus a bias-free
  8→768 projection for existing-extension multi-hot conditioning.
  Rotary/relative attention remains a future comparison experiment.
- One forward processes one tokenizer window at batch size 1. The requested
  1–32 candidates are seeded samples from shared logits; candidate count is not
  execution batch size.
- The same checkpoint runs on CUDA, Apple Metal/MPS, or CPU. Device selection
  now uses real tensor probes and records dtype, device, and explicit
  accelerator-to-CPU fallback provenance. v0.4 does not shrink batches on OOM.

### Added — strict artifacts and API v2

- Only the fixed `manifest.json`, `data-manifest.json`, and
  `harmonyforge-bimask-base-v1.safetensors` location is accepted. Architecture,
  actual config/checkpoint/data-manifest-file SHA-256 values, the fixed
  tokenizer digest, training/evaluation status, PyTorch/app/API versions, and
  precisions are checked before loading. Before export, the compiler also
  verifies the ledger and split/vocabulary/statistics artifact hashes. Dataset
  rights and leakage review remain separate training gates.
- Added `POST /api/v2/harmony/generate`,
  `GET /api/v2/jobs/{requestId}`,
  `POST /api/v2/harmony/cancel/{requestId}`, and
  `GET /api/v2/models/{modelId}/manifest`.
- Jobs publish candidates atomically. Cancellation, timeout, rejected
  checkpoints, or inference errors do not leave partial candidates. Responses
  keep request, seed, model, checkpoint, and device provenance.
- Research-only checkpoints require
  `MTC_ENABLE_RESEARCH_CHECKPOINT=1`. The deterministic development fixture
  requires `MTC_ENABLE_NEURAL_MOCK=1` and remains labeled `MOCK`,
  `trained: false`, and `notEvaluated` in both API and UI.

### User workflow and safety

- Select a ChordLane range, choose chords-only plus Auto / MPS / CUDA / CPU,
  and the editor requests three A/B/C proposals as a background job. Playback
  and manual editing remain available. The status area exposes progress,
  elapsed time, real device, fallback reason, and Cancel. Accelerator failure
  offers a CPU retry for the same range.
- Server candidates arrive with `hardRuleValidation: pendingClient` and
  `adoptable: false`. Only candidates accepted by the existing schema, theory,
  voicing, 88-key/hand, and all-track validators become previews.
- Auditioning a preview does not change the project. Only explicit Apply writes
  a validated candidate into project history, where it can be undone.
  Compatible newer edits are rebased/revalidated and labeled `Rebased`;
  context-stale results, cancellation, or failure leave the song unchanged.
- Without a trained HarmonyForge checkpoint, generation safely falls back to
  the empirical corpus, browser ranking, and deterministic theory paths.

### Distribution, CI, and known limitations

- The normal backend lock and CI job stay torch-free. A separate neural CPU job
  uses pinned optional dependencies to test model construction, checkpoint
  rejection, API/cancel/mock behavior, and the preview contract.
- CPU, CUDA, and macOS acceleration locks pin PyTorch 2.13.0 and SafeTensors
  0.8.0. DirectML is an ONNX-ranker runtime, not a v0.4 HarmonyForge device.
- The normal `setup.sh` / `setup.ps1` flow now installs pinned PyTorch too,
  probes macOS MPS, NVIDIA CUDA, or CPU with a real tensor operation, and keeps
  CPU plus Browser/Theory fallback available when acceleration fails.
- The CPU Docker image contains the optional neural runtime, but HarmonyForge
  is available only when a valid trained checkpoint is mounted read-only. The
  optional CUDA Compose overlay also requires a host NVIDIA driver and NVIDIA
  Container Toolkit.
- Dataset compilation, closed-test evaluation, ablations, CUDA/MPS/CPU parity,
  and listening studies remain release gates. A mock response or parameter
  count is not evidence of musical quality.
- Primary references are AutoHarmonizer, ReaLchords, Stochastic Control
  Guidance, and full-to-full curriculum masking. Architecture diagrams,
  adopted ideas, repository-specific integration, and the complete primary
  bibliography are documented in
  [English](docs/neural-harmony-architecture.en.md) and
  [Japanese](docs/neural-harmony-architecture.ja.md).

## 0.3.0 — Research-grounded engine and empirical harmony (2026-07-27)

v0.3 replaced undocumented scalar heuristics with separated hard theory
constraints, empirical POP909 n-gram likelihood, and explicit user preference.
It also added the retrainable corpus boundary, advanced harmony/rhythm/form
features, multi-track validation, responsive LAN use, and release evidence
gates. See the [complete Japanese entry](CHANGELOG.md)
for the detailed historical record.
