# Harmony-only private training policy

Status: repository policy for the first local training stage. This document is
not a legal opinion and does not certify that any particular dataset is lawful
to use.

## Purpose and boundary

The first learned weights are **private, local, harmony-only pretraining
artifacts**. They are not a melody-conditioned release model and must not be
published or committed to this repository.

The initial training representation may contain:

- canonical key-relative chord root, quality, inversion, bass, and extensions;
- harmonic rhythm expressed as integer ticks;
- key/mode, meter, and bar position;
- synthetic/source flags needed for evaluation and deduplication.

It must exclude:

- melody or counterpoint notes;
- audio and lyrics;
- raw MIDI and performance controls such as velocity or expressive timing;
- accompaniment, voicing, instrumentation, and track arrangement;
- song titles, artist names, and other work-identifying display metadata.

Reading an excluded format merely to discard it is outside this first-stage
pipeline. Its normalized input must already contain only the allowed harmony
representation.

The source-review scope and the content emitted for training are recorded as
separate fields:

- `reviewedSourceInputs`: `harmony`, `key`, `meter`, and `beatTiming`;
- `emittedTrainingContent`: `harmony`, `key`, and `meter`.

`beatTiming` honestly records that source beat anchors are reviewed and read to
derive meter and an integer-tick grid. Source beat times in seconds are not
emitted in normalized records or training rows.

## Dataset-level screening

Individual-song permission review is not the default gate for this
harmony-only stage. Each dataset or source subset must instead have one
documented provenance decision containing:

- stable source ID, version, canonical URL, and retrieval date in UTC;
- citation and attribution text;
- exact source-material/tree SHA-256 and normalized-input SHA-256;
- reviewed source inputs: harmony, key, meter, and beat timing;
- emitted training content: harmony, key, and meter only;
- review status and stated basis, such as license, public domain, contract,
  owner-provided data, or a documented statutory-training exception;
- permitted purpose: private local harmony-only training;
- removal/rebuild procedure.

For POP909, the source version must be a full 40-character Git commit rather
than an abbreviated hash or branch name. Each preparer run atomically writes a
`prepare-run.json` containing the preparer-script SHA-256, source commit,
gap/quantization options, counts and aggregate exclusion reasons, and the
source-material and normalized-record SHA-256 values. The ledger binds that run
record by SHA-256, and the compiler verifies its bytes through `--prepare-run`
before carrying the binding into the data manifest.

An “approved” status records a project decision; it is not a compiler-generated
legal conclusion. Pending, blocked, unclear-source, or checksum-mismatched
sources must not enter training.

## What may be committed

The repository may contain:

- policy, schema, tests, and extraction/compiler source code;
- dataset-level citations, source versions, review status, and SHA-256 values;
- aggregate counts and broad distributions that do not reveal ordered musical
  sequences or source-item identities.

Public summaries must not contain record/work/source-item IDs, ordered chord
sequences, rare high-order n-grams, local filesystem paths, authentication
material, or row-level split assignments.

The following stay local and untracked:

- raw and normalized source records;
- train, validation, and test rows;
- detailed ledgers or manifests containing source-item identifiers;
- optimizer state, training logs, evaluation rows, and run directories;
- checkpoints and converted model binaries.

Use ignored locations such as `datasets/raw/`, `datasets/processed/`,
`training/runs/`, `local-models/`, or a subdirectory of `models/`.

## Automated repository boundary

Run:

```bash
python scripts/check-private-artifacts.py
```

The check inspects `git ls-files`, so ignored local artifacts are allowed while
tracked MIDI/audio, weight binaries, private dataset directories, and nested
model artifact directories fail CI. It classifies paths only; it cannot prove
that a misleadingly named text file is non-reconstructive. Review of public
aggregate cards remains mandatory.

## Model capability and release boundary

A checkpoint trained under this policy must be described as harmony-only
pretraining. Feeding it melody at inference does not make it melody-conditioned.
The checkpoint must remain separate from a melody-conditioned runtime until a
future capability manifest, fine-tuning dataset, and evaluation gate explicitly
support that task.

Sharing weights, publishing a hosted service, adding melody/arrangement data, or
using the model commercially requires a new source and release review. The
application’s MIT license does not grant rights to datasets or trained weights.

## Risks that private weights do not remove

Local-only use reduces distribution exposure, but it does not by itself resolve:

- source acquisition terms, access controls, or database/contract restrictions;
- jurisdiction-specific rules for reproducing data or training models;
- annotation errors, provenance mistakes, and train/test leakage;
- memorization or outputs that are unusually similar to a source;
- confidential data, insecure local storage, or accidental backups/uploads;
- obligations triggered by later sharing of weights, outputs, or a service.

If a source is revoked or its provenance changes, stop new training, identify
affected runs by hash, remove the local artifacts, and rebuild from the
remaining approved sources.
