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
