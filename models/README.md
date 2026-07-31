# Local models

`harmony-corpus-v1.json` is the built-in empirical harmony language model. It
contains aggregate key-relative chord n-gram counts only. It does not contain
MIDI, audio, lyrics, song titles, or raw chord annotation files.

The checked-in model was produced from the 909-song
[POP909 Dataset](https://github.com/music-x-lab/POP909-Dataset) checkout at
commit `d83e6edba6872a704f5d3b8b32f5cb540088dae6`:

```bash
python3 scripts/train-harmony-corpus.py \
  --pop909 /path/to/POP909-Dataset \
  --output models/harmony-corpus-v1.json \
  --max-order 5
```

Tracked artifact:

- size: `3,202,973` bytes
- SHA-256: `dfa28603b2aa0247abe5265a6975ae8267042a91e72e8c1ddd2221e2624209ae`
- observations: 909 songs / 1,131 key regions / 93,904 normalized chord tokens

The trainer normalizes every chord relative to the active key, splits
modulations into separate sequences, collapses repeated chord annotations, and
writes orders 1 through 5 atomically. The runtime uses frequency-derived
recursive interpolation. It does not add subjective hand-tuned style weights.

The original POP909 paper and repository must be cited when retraining or
redistributing a derived model. Review the dataset repository's current license
and the rights applicable to your intended distribution before publishing a
new model.

## Optional HarmonyForge checkpoint

v0.4 includes the HarmonyForge-BiMask architecture and inference boundary, but
it does **not** include a trained checkpoint. A model is discovered only at the
allowlisted location below:

```text
models/
  harmonyforge-bimask-base-v1/
    current.json
    versions/<manifest-sha256>/
      manifest.json
      data-manifest.json
      training-run.json
      harmonyforge-bimask-base-v1.safetensors
```

### Declared training objective

`manifest.task` declares what the weights were trained to do. Two values exist:

- `melody_conditioned_variable_rhythm_harmonization` — the product objective,
  and **the only one the inference path will load**.
- `harmony_only_pretraining` — weights from harmony-only pre-training. Local and
  research use only.

The distinction matters because it is invisible to every other check. A
pre-training checkpoint has the same architecture, the same tokenizer, and the
same config, so it satisfies the whole integrity chain — the declared objective
is the only thing that separates a model which can harmonize a melody from one
that has never been conditioned on a melody. Serving it would make the
application's stated capability false.

The refusal is therefore not configurable. It is checked before every other
gate and it does not consult research mode: `MTC_ENABLE_RESEARCH_CHECKPOINT=1`
relaxes release status only, and release status is a separate question from
which objective the weights were trained at. Training, export, and evaluation
accept a pre-training artifact — that is how it is warm-started, measured, and
promoted — but no environment variable or setting makes one loadable for
inference. Promotion happens by training at the melody-conditioned objective and
exporting a new artifact that declares it, not by re-labelling an old one.

The manifest must declare the architecture, actual config, checkpoint, and
`data-manifest.json` and `training-run.json` file SHA-256 values, the fixed
tokenizer digest, training and evaluation status, supported precision, and
minimum application/API versions. The loader verifies allowlisted filenames,
actual file hashes, the tokenizer, and architecture. The training pipeline must
separately validate dataset rights/leakage. Before export, the compiler verifies
the data manifest’s ledger and the hashes of its split, vocabulary, and
statistics artifacts; runtime then verifies the exact exported manifest file
hash. Missing, untrained, unevaluated, malformed, or checksum-mismatched
artifacts are rejected before PyTorch deserialization. SafeTensors is the only
accepted weight format.
The writer stages and validates an immutable version before atomically updating
`current.json`. The older direct root-level layout remains read-only
compatibility and is not emitted by the v0.4 training pipeline.

Research-only artifacts also require
`MTC_ENABLE_RESEARCH_CHECKPOINT=1`. That flag relaxes only the release-status
gate: it does not bypass schema, size, checksum, architecture, or compatibility
checks. `MTC_ENABLE_NEURAL_MOCK=1` enables a deterministic integration fixture,
not a music model. Mock responses remain labeled `mock: true`,
`trained: false`, and `evaluationStatus: notEvaluated`.

The CPU Docker image installs the optional neural runtime, but HarmonyForge is
still unavailable until a valid trained checkpoint directory is mounted
read-only at `/app/models`. The optional CUDA Compose overlay additionally
requires a compatible NVIDIA driver and NVIDIA Container Toolkit.

See the
[English architecture and provenance note](../docs/neural-harmony-architecture.en.md)
or its
[Japanese version](../docs/neural-harmony-architecture.ja.md)
before producing or distributing a checkpoint. No dataset or model license is
implied by the application’s MIT license.
