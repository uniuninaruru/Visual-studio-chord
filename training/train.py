"""CLI for deterministic HarmonyForge reference training."""

from __future__ import annotations

import sys
from pathlib import Path

PROJECT_DIRECTORY = Path(__file__).resolve().parents[1]
BACKEND_DIRECTORY = PROJECT_DIRECTORY / "backend"
if str(BACKEND_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIRECTORY))


def main() -> int:
    from app.ml.cli import train_main

    return train_main()

if __name__ == "__main__":
    raise SystemExit(main())
