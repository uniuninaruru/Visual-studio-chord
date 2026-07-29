"""Bounded background harmony jobs with cooperative, atomic cancellation."""

from __future__ import annotations

import hashlib
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from app.ml.backends.base import HarmonyGenerationResult
from app.ml.checkpoint import CheckpointInvalidError, CheckpointUnavailableError
from app.schemas.api import (
    HarmonyCandidate,
    HarmonyGenerateRequest,
    HarmonyJobError,
    HarmonyJobResponse,
)
from app.services.harmony_models import HarmonyModelManager

MAX_RETAINED_JOBS = 64


class HarmonyJobConflictError(RuntimeError):
    """A reused request id refers to different input or a terminal job."""


class HarmonyJobCapacityError(RuntimeError):
    """The bounded in-memory queue cannot safely accept another job."""


@dataclass(slots=True)
class _Job:
    request: HarmonyGenerateRequest
    payload_sha256: str
    manifest: dict[str, object]
    state: str = "queued"
    stage: str = "Queued"
    progress: int = 0
    created_at: float = field(default_factory=time.monotonic)
    stage_started_at: float = field(default_factory=time.monotonic)
    stage_timings_ms: dict[str, int] = field(default_factory=dict)
    cancel_event: threading.Event = field(default_factory=threading.Event)
    candidates: list[HarmonyCandidate] = field(default_factory=list)
    result: HarmonyGenerationResult | None = None
    error: HarmonyJobError | None = None


class HarmonyJobManager:
    def __init__(
        self,
        model_manager: HarmonyModelManager,
        *,
        worker_count: int = 1,
    ) -> None:
        self._model_manager = model_manager
        self._jobs: dict[str, _Job] = {}
        self._lock = threading.RLock()
        self._executor = ThreadPoolExecutor(
            max_workers=worker_count,
            thread_name_prefix="harmony-preview",
        )

    def submit(self, request: HarmonyGenerateRequest) -> HarmonyJobResponse:
        payload_hash = hashlib.sha256(
            request.model_dump_json(by_alias=True).encode("utf-8")
        ).hexdigest()
        with self._lock:
            existing = self._jobs.get(request.request_id)
            if existing is not None:
                if existing.payload_sha256 != payload_hash:
                    raise HarmonyJobConflictError(
                        "requestId is already associated with different input"
                    )
                return self._response(existing)
        # A first validation may hash a newly installed checkpoint. Do that
        # outside the job lock, then retain immutable provenance per job so
        # polling and cancellation never touch artifact files.
        manifest = self._model_manager.manifest(request.model_id)
        with self._lock:
            existing = self._jobs.get(request.request_id)
            if existing is not None:
                if existing.payload_sha256 != payload_hash:
                    raise HarmonyJobConflictError(
                        "requestId is already associated with different input"
                    )
                return self._response(existing)
            self._trim_terminal_jobs()
            if len(self._jobs) >= MAX_RETAINED_JOBS:
                raise HarmonyJobCapacityError(
                    "The harmony generation queue is currently full"
                )
            job = _Job(
                request=request,
                payload_sha256=payload_hash,
                manifest=dict(manifest),
            )
            self._jobs[request.request_id] = job
            self._executor.submit(self._run, request.request_id)
            return self._response(job)

    def get(self, request_id: str) -> HarmonyJobResponse:
        with self._lock:
            job = self._jobs.get(request_id)
            if job is None:
                raise KeyError(request_id)
            return self._response(job)

    def cancel(self, request_id: str) -> HarmonyJobResponse:
        with self._lock:
            job = self._jobs.get(request_id)
            if job is None:
                raise KeyError(request_id)
            if job.state in {"completed", "failed"}:
                raise HarmonyJobConflictError("A terminal harmony job cannot be cancelled")
            if job.state == "cancelled":
                return self._response(job)
            job.cancel_event.set()
            job.state = "cancelRequested"
            self._transition(job, "Cancel requested", max(job.progress, 1))
            return self._response(job)

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)

    def _run(self, request_id: str) -> None:
        with self._lock:
            job = self._jobs[request_id]
            if job.cancel_event.is_set():
                self._cancelled(job)
                return
            job.state = "running"
            self._transition(job, "Loading checkpoint", 5)
        try:
            backend = self._model_manager.backend(job.request.model_id)
            result = backend.generate(
                job.request,
                cancel_event=job.cancel_event,
                on_progress=lambda stage, progress: self._progress(
                    request_id,
                    stage,
                    progress,
                ),
            )
            with self._lock:
                if job.cancel_event.is_set():
                    self._cancelled(job)
                    return
                # Atomic publication: no candidate is retained before the full
                # backend result has completed and cancellation is rechecked.
                job.result = result
                job.candidates = list(result.candidates)
                job.state = "completed"
                self._transition(job, "Client theory validation", 95)
                self._transition(job, "Complete", 100)
        except InterruptedError:
            with self._lock:
                self._cancelled(job)
        except CheckpointUnavailableError as exc:
            with self._lock:
                self._failed(job, "MODEL_UNAVAILABLE", str(exc))
        except CheckpointInvalidError as exc:
            with self._lock:
                self._failed(job, "CHECKPOINT_INVALID", str(exc))
        except Exception:
            with self._lock:
                self._failed(
                    job,
                    "INFERENCE_FAILED",
                    "Harmony generation failed safely; the composition is unchanged.",
                )

    def _progress(self, request_id: str, stage: str, progress: int) -> None:
        with self._lock:
            job = self._jobs.get(request_id)
            if job is None or job.state not in {"running", "cancelRequested"}:
                return
            if job.cancel_event.is_set():
                return
            self._transition(job, stage, progress)

    def _transition(self, job: _Job, stage: str, progress: int) -> None:
        now = time.monotonic()
        elapsed = max(0, round((now - job.stage_started_at) * 1000))
        if job.stage != stage:
            job.stage_timings_ms[job.stage] = (
                job.stage_timings_ms.get(job.stage, 0) + elapsed
            )
            job.stage_started_at = now
        job.stage = stage
        job.progress = min(100, max(job.progress, progress))

    def _cancelled(self, job: _Job) -> None:
        job.candidates = []
        job.result = None
        job.state = "cancelled"
        job.error = HarmonyJobError(
            code="CANCELLED",
            message="Harmony generation was cancelled; the composition is unchanged.",
        )
        self._transition(job, "Cancelled", 100)

    def _failed(self, job: _Job, code: str, message: str) -> None:
        job.candidates = []
        job.result = None
        job.state = "failed"
        job.error = HarmonyJobError(code=code, message=message)  # type: ignore[arg-type]
        self._transition(job, "Failed", 100)

    def _response(self, job: _Job) -> HarmonyJobResponse:
        result = job.result
        manifest = job.manifest
        is_mock = bool(manifest["mock"])
        return HarmonyJobResponse(
            request_id=job.request.request_id,
            state=job.state,  # type: ignore[arg-type]
            stage=job.stage,  # type: ignore[arg-type]
            progress=job.progress,
            elapsed_ms=max(0, round((time.monotonic() - job.created_at) * 1000)),
            model_id=job.request.model_id,
            device=("cpu" if is_mock else None) if result is None else result.device,
            backend=(
                "mock"
                if is_mock
                else "pytorch"
                if result is None
                else result.backend
            ),
            dtype=("float32" if is_mock else None) if result is None else result.dtype,
            mock=is_mock if result is None else result.mock,
            trained=bool(manifest["trained"]) if result is None else result.trained,
            checkpoint_sha256=(
                manifest["checkpointSha256"]
                if result is None
                else result.checkpoint_sha256
            ),
            tokenizer_sha256=(
                str(manifest["tokenizerSha256"])
                if result is None
                else result.tokenizer_sha256
            ),
            source_commit=None if result is None else result.source_commit,
            batch_size=(
                1
                if result is None
                else result.batch_size
            ),
            candidate_count=job.request.candidate_count,
            deterministic=True if result is None else result.deterministic,
            cpu_fallback_used=(
                False if result is None else result.cpu_fallback_used
            ),
            fallback_reason=None if result is None else result.fallback_reason,
            stage_timings_ms=dict(job.stage_timings_ms),
            candidates=list(job.candidates),
            error=job.error,
        )

    def _trim_terminal_jobs(self) -> None:
        if len(self._jobs) < MAX_RETAINED_JOBS:
            return
        terminal = sorted(
            (
                (request_id, job)
                for request_id, job in self._jobs.items()
                if job.state in {"completed", "cancelled", "failed"}
            ),
            key=lambda item: item[1].created_at,
        )
        for request_id, _job in terminal[
            : max(1, len(self._jobs) - MAX_RETAINED_JOBS + 1)
        ]:
            del self._jobs[request_id]
