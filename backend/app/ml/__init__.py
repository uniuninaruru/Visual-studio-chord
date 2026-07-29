"""Research-preview neural harmony components.

The package is importable without PyTorch. Accelerator and checkpoint
dependencies are loaded only when a trained model is explicitly requested.
"""

from app.ml.contracts import HarmonyForgeConfig, load_model_config
from app.ml.tokenizer import TOKENIZER_SHA256, HarmonyTokenizer

__all__ = [
    "HarmonyForgeConfig",
    "HarmonyTokenizer",
    "TOKENIZER_SHA256",
    "load_model_config",
]
