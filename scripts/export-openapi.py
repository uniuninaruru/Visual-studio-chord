#!/usr/bin/env python3
"""Export the deterministic FastAPI contract for generated frontend types."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_ROOT = PROJECT_ROOT / "backend"
OUTPUT_PATH = BACKEND_ROOT / "openapi.json"

sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402


def rendered_schema() -> str:
    schema = create_app(Settings(inference_model="linear")).openapi()
    return json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail when the committed schema is stale")
    arguments = parser.parse_args()
    rendered = rendered_schema()
    if arguments.check:
        try:
            current = OUTPUT_PATH.read_text(encoding="utf-8")
        except OSError:
            current = ""
        if current != rendered:
            print("backend/openapi.json is stale; run the API type generator.", file=sys.stderr)
            return 1
        return 0
    OUTPUT_PATH.write_text(rendered, encoding="utf-8", newline="\n")
    print(OUTPUT_PATH)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
