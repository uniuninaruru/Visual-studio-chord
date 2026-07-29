#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_PYTHON="$PROJECT_DIR/.venv/bin/python"
PROBE_SCRIPT="$PROJECT_DIR/scripts/verify_acceleration.py"
SYSTEM="$(uname -s)"
MODE="${1:-auto}"

if [[ ! -x "$VENV_PYTHON" ]]; then
  printf 'Backend environment not found. Run ./scripts/setup.sh first.\n' >&2
  exit 1
fi

install_lock() {
  local lock_file="$1"
  "$VENV_PYTHON" -m pip install --upgrade \
    --requirement "$PROJECT_DIR/backend/$lock_file"
}

install_cpu() {
  "$VENV_PYTHON" -m pip uninstall -y onnxruntime-gpu onnxruntime-directml >/dev/null
  install_lock requirements-acceleration-cpu.lock
}

install_cuda() {
  "$VENV_PYTHON" -m pip uninstall -y onnxruntime onnxruntime-directml >/dev/null
  install_lock requirements-acceleration-cuda.lock
}

install_macos() {
  "$VENV_PYTHON" -m pip uninstall -y onnxruntime-gpu onnxruntime-directml >/dev/null
  install_lock requirements-acceleration-macos.lock
}

finish() {
  printf 'Acceleration setup finished. Restart ./scripts/dev.sh or ./scripts/serve-lan.sh.\n'
}

case "$SYSTEM" in
  Darwin)
    case "$MODE" in
      auto)
        install_macos
        if "$VENV_PYTHON" "$PROBE_SCRIPT" --require-torch-device mps; then
          finish
          exit 0
        fi
        printf 'Apple MPS did not pass the PyTorch tensor probe. Continuing with CPU fallback.\n' >&2
        "$VENV_PYTHON" "$PROBE_SCRIPT" --require-torch-device cpu
        ;;
      mps)
        install_macos
        if ! "$VENV_PYTHON" "$PROBE_SCRIPT" --require-torch-device mps; then
          printf 'MPS did not pass the PyTorch tensor probe. The basic app remains available on CPU.\n' >&2
          exit 2
        fi
        ;;
      cpu)
        install_cpu
        "$VENV_PYTHON" "$PROBE_SCRIPT" --require-torch-device cpu
        ;;
      *)
        printf 'Usage on macOS: ./scripts/setup-acceleration.sh [auto|mps|cpu]\n' >&2
        exit 2
        ;;
    esac
    ;;
  Linux)
    case "$MODE" in
      auto)
        if command -v nvidia-smi >/dev/null 2>&1; then
          printf 'NVIDIA driver detected; attempting pinned CUDA runtimes.\n'
          if install_cuda && "$VENV_PYTHON" "$PROBE_SCRIPT" --require-torch-device cuda; then
            finish
            exit 0
          fi
          printf 'CUDA did not pass the PyTorch tensor probe. Switching to pinned PyTorch CPU.\n' >&2
        fi
        install_cpu
        "$VENV_PYTHON" "$PROBE_SCRIPT" --require-torch-device cpu
        ;;
      cuda)
        install_cuda
        if ! "$VENV_PYTHON" "$PROBE_SCRIPT" --require-torch-device cuda; then
          printf 'CUDA did not pass the PyTorch tensor probe. The basic app remains available on CPU.\n' >&2
          exit 2
        fi
        ;;
      cpu)
        install_cpu
        "$VENV_PYTHON" "$PROBE_SCRIPT" --require-torch-device cpu
        ;;
      *)
        printf 'Usage on Linux: ./scripts/setup-acceleration.sh [auto|cuda|cpu]\n' >&2
        exit 2
        ;;
    esac
    ;;
  *)
    printf 'This launcher supports macOS and Linux. On Windows run .\\scripts\\setup-acceleration.ps1.\n' >&2
    exit 2
    ;;
esac

finish
