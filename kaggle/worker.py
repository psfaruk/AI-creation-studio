"""AI Creation Studio — Kaggle GPU music worker (single-cell notebook script).

Paste this whole file into ONE Kaggle notebook cell and run it. In a Kaggle
notebook cell ``__name__`` IS ``"__main__"``, so the guard at the bottom fires
and the worker starts.

What it does, every cycle:
  1. GET   up to 3 pending jobs from the Supabase ``jobs`` table (oldest first)
  2. PATCH one job  pending -> running   (atomic claim, guarded by the status
     filter — proceed ONLY with the row this PATCH returns, never merely
     because the SELECT returned it)
  3. Generate music with Meta MusicGen on the GPU (chunked + continuation)
  4. Upload the WAV to the public ``outputs`` storage bucket
  5. PATCH the job  running -> done  (guarded)  or  running -> failed (guarded)

IMPORT SAFETY (important): this module must be importable with ONLY the Python
standard library installed — that is how ``kaggle/test_worker.py`` runs in CI.
torch / transformers / scipy / requests are therefore imported lazily INSIDE
the functions that need them; nothing heavy is imported at module import time.
Everything that talks to Kaggle or torch lives in functions called from
main(), which is guarded by ``if __name__ == "__main__":``.

SECRETS: SUPABASE_URL / SUPABASE_KEY are read from Kaggle Secrets
(UserSecretsClient) and are never printed, logged, or embedded in error
strings. sanitize_error() additionally scrubs the key value (and any
"Bearer <token>" fragment) from errors before they are stored.
"""

from __future__ import annotations

import gc
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from typing import Any, Callable, Protocol

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
POLL_INTERVAL_S = 15                # idle sleep between poll cycles
CHUNK_SECONDS = 20                  # target length of one MusicGen chunk
MAX_CHUNKS = 9                      # 9 * 20s = 180s = 3 minutes max
MIN_DURATION_S = 1                  # [duration=N] clamp, lower bound
MAX_DURATION_S = 180                # [duration=N] clamp, upper bound
OVERLAP_S = 10                      # continuation overlap (dropped on concat)
DEFAULT_DURATION_S = 180            # used when the prompt has no directive
MUSICGEN_PRIMARY = "facebook/musicgen-medium"
MUSICGEN_FALLBACK = "facebook/musicgen-small"  # CUDA-OOM fallback, once per job
ERROR_MAX_CHARS = 500               # cap for error strings stored in the DB
API_TIMEOUT = (10, 60)              # (connect, read) seconds for REST calls
UPLOAD_TIMEOUT = (30, 600)          # (connect, read) seconds for WAV uploads
JOBS_SELECT = "id,type,prompt,created_at"  # columns fetched for candidates
CLAIM_BATCH = 3                     # pending candidates fetched per cycle

# Loaded (model, processor) pairs, keyed by model name. MusicGen takes minutes
# to load — never reload per chunk (or per job). See unload_model().
_MODEL_CACHE: dict[str, tuple[Any, Any]] = {}

_DURATION_RE = re.compile(r"\[duration=(\d+)\]")
_BEARER_RE = re.compile(r"(?i)bearer\s+[A-Za-z0-9\-._~+/]+=*")


# ---------------------------------------------------------------------------
# Pure functions — stdlib only, fully unit-testable without torch/requests.
# (kaggle/test_worker.py imports this module with zero third-party packages.)
# ---------------------------------------------------------------------------


def utc_timestamp() -> str:
    """UTC timestamp for heartbeat log lines, e.g. 2026-10-18T12:00:00Z."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_music_prompt(prompt: str | None) -> tuple[str, int]:
    """Parse an optional ``[duration=<int>]`` directive out of a job prompt.

    Returns ``(clean_prompt, duration_seconds)``:

    - clean_prompt: the natural-language prompt with every *integer*
      ``[duration=N]`` directive removed and whitespace collapsed
    - duration_seconds: the FIRST directive's value clamped to
      ``[MIN_DURATION_S, MAX_DURATION_S]``; a missing or non-integer directive
      leaves the text exactly as-is and uses DEFAULT_DURATION_S (180)
    """
    if not prompt:
        return ("", DEFAULT_DURATION_S)
    text = str(prompt)
    matches = list(_DURATION_RE.finditer(text))
    if not matches:
        # No valid integer directive: leave non-matching text untouched.
        return (text, DEFAULT_DURATION_S)
    duration = int(matches[0].group(1))  # r"\d+" — always a valid integer
    text = _DURATION_RE.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    duration = max(MIN_DURATION_S, min(MAX_DURATION_S, duration))
    return (text, duration)


def build_chunk_plan(
    duration_seconds: int,
    chunk_seconds: int = CHUNK_SECONDS,
    max_chunks: int = MAX_CHUNKS,
) -> list[int]:
    """Split a (clamped) duration into ~chunk_seconds chunks, last one shorter.

    e.g. 180 -> [20]*9, 45 -> [20, 20, 5], 20 -> [20], 15 -> [15].
    The input is clamped to [MIN_DURATION_S, MAX_DURATION_S] first, the number
    of chunks never exceeds max_chunks, and sum(plan) always equals the
    clamped duration (any leftover that would exceed max_chunks is folded into
    the last chunk).
    """
    total = int(duration_seconds)
    total = max(MIN_DURATION_S, min(MAX_DURATION_S, total))
    plan: list[int] = []
    remaining = total
    while remaining > 0 and len(plan) < max_chunks:
        take = min(chunk_seconds, remaining)
        plan.append(take)
        remaining -= take
    if remaining > 0 and plan:
        # Only reachable with non-default arguments; keeps the two invariants.
        plan[-1] += remaining
    return plan


def sanitize_error(err: Any, secret: str) -> str:
    """Bound + de-secret an error message for the jobs.error column.

    - str(err) capped at ERROR_MAX_CHARS (500)
    - the given secret value and any "Bearer <token>" fragment -> "***"
    - masking happens BEFORE the cap, so a truncated message can never leak a
      partial secret
    - never raises, even for unprintable error objects
    """
    try:
        text = str(err)
    except Exception:
        text = f"<unprintable {type(err).__name__} error>"
    if secret:
        text = text.replace(secret, "***")
    text = _BEARER_RE.sub("Bearer ***", text)
    return text[:ERROR_MAX_CHARS]


def is_claimed(rows: Any) -> bool:
    """True only when a guarded claim PATCH returned exactly one row.

    0 rows -> another worker won the race (try the next candidate);
    >1 rows (should not happen with the id filter) -> refuse to proceed.
    A job is NEVER processed merely because a prior SELECT returned it.
    """
    return isinstance(rows, list) and len(rows) == 1


def should_apply_update(rows: Any) -> bool:
    """Same exactly-one-row semantics, guarding done/failed updates.

    Used after PATCHing ``status=eq.running`` rows: 0 rows means the job is no
    longer running (completed/failed elsewhere) and must NOT be overwritten.
    """
    return is_claimed(rows)


def _is_cuda_oom(err: BaseException) -> bool:
    """Best-effort, torch-free detection of a CUDA out-of-memory error."""
    name = type(err).__name__
    if "outofmemoryerror" in name.lower():
        return True
    text = str(err).lower()
    return "out of memory" in text


def local_wav_path(job_id: Any) -> str:
    """Local scratch path for a job's WAV (notebook working directory)."""
    safe_id = re.sub(r"[^A-Za-z0-9_\-]", "_", str(job_id))
    return os.path.join(os.getcwd(), f"music_{safe_id}.wav")


def _remove_local_wav(job_id: Any) -> None:
    """Best-effort cleanup of the job's local WAV after processing."""
    try:
        os.remove(local_wav_path(job_id))
    except OSError:
        pass


class JobContext(Protocol):
    """Dependency-injection interface used by process_job().

    The production implementation is built by make_real_context(); the test
    suite uses a small recording fake (no torch needed)."""

    def generate_music(self, job: dict, clean_prompt: str, duration_seconds: int) -> str:
        """Generate the audio and return the local WAV path."""
        ...

    def upload(self, job_id: str, wav_path: str) -> str:
        """Upload the WAV and return the public result URL."""
        ...

    def patch_job(self, job_id: str, status: str, payload: dict) -> Any:
        """Guarded status update (only touches a row that is still running)."""
        ...


# ---------------------------------------------------------------------------
# TODO(phase-2 video): video jobs are NOT implemented — they fail honestly.
# Planned implementation:
#   * Generate the video as a series of SHORT CLIPS from a suitable open
#     video model (text-to-video / image-to-video), driven by the shot plan.
#   * Generate and persist each clip SEPARATELY (local file plus a per-clip
#     progress record keyed by job id + clip index) so partial progress
#     survives.
#   * RESUME from completed clips after a Kaggle session interruption: on job
#     claim, check which clips already exist (local/remote) and generate only
#     the missing ones.
#   * STITCH the clips with FFmpeg (concat + re-encode + audio mux) — ffmpeg
#     is preinstalled on Kaggle images.
#   * Upload the final output to the outputs bucket and update the job with
#     the same guarded done/failed PATCHes the music path uses.
#   * Enforce the total duration limit and GPU-memory limits (unload the
#     video model between clips, chunk to fit VRAM, fall back to smaller
#     models on OOM).
# Until then, video jobs are marked failed with the exact message below.
# ---------------------------------------------------------------------------


def process_job(job: dict, ctx: JobContext, secret: str = "") -> bool:
    """Process one claimed job end-to-end via the injected context.

    ALWAYS returns True — the poll loop continues no matter what happens in
    here (errors are turned into a guarded "failed" PATCH; if that PATCH
    itself fails, we log and continue anyway). Only the caller decides when
    the loop stops.
    """
    job_id = job.get("id") if isinstance(job, dict) else None
    job_type = job.get("type") if isinstance(job, dict) else None

    # The jobs table CHECK constraint only allows ('music', 'video'), so any
    # non-music job is a video job. Video generation is NOT implemented yet:
    # fail the job honestly instead of pretending success.
    if job_type != "music":
        try:
            ctx.patch_job(job_id, "failed", {"error": "video worker not implemented yet"})
        except Exception as patch_exc:  # a patch failure must never propagate
            print(
                f"[{utc_timestamp()}] job={job_id} | could not mark video job failed "
                f"(continuing): {sanitize_error(patch_exc, secret)}"
            )
        return True

    try:
        prompt = job.get("prompt") if isinstance(job, dict) else None
        clean_prompt, duration_seconds = parse_music_prompt(prompt)
        wav_path = ctx.generate_music(job, clean_prompt, duration_seconds)
        result_url = ctx.upload(job_id, wav_path)
        ctx.patch_job(job_id, "done", {"result_url": result_url})
        print(f"[{utc_timestamp()}] job={job_id} | done | {result_url}")
    except Exception as exc:
        # Any failure marks the job failed with a sanitized, bounded error.
        # ctx.patch_job is guarded by status=eq.running in the real context,
        # so this can never overwrite a job completed/failed elsewhere.
        try:
            ctx.patch_job(job_id, "failed", {"error": sanitize_error(exc, secret)})
        except Exception as patch_exc:  # never propagate from the error path
            print(
                f"[{utc_timestamp()}] job={job_id} | could not mark job failed "
                f"(continuing): {sanitize_error(patch_exc, secret)}"
            )
    return True


# ---------------------------------------------------------------------------
# Heavy helpers — everything below imports torch / transformers / scipy /
# requests LAZILY, inside the function bodies, so importing this module stays
# dependency-free. These run only on the Kaggle GPU box, from main().
# ---------------------------------------------------------------------------


def gpu_summary() -> str:
    """Short GPU description for heartbeat lines. Never raises."""
    try:
        import torch

        if torch.cuda.is_available():
            return torch.cuda.get_device_name(0)
        return "cpu"
    except Exception:
        return "unavailable"


def install_dependencies() -> None:
    """One-time pip install of the heavy deps (called at the top of main())."""
    cmd = [
        sys.executable, "-m", "pip", "install", "-q",
        "transformers", "accelerate", "scipy", "requests",
    ]
    print(f"[{utc_timestamp()}] installing dependencies (one-time): {' '.join(cmd[5:])}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        tail = (result.stderr or result.stdout or "").strip()[-300:]
        raise SystemExit(f"pip install failed with exit code {result.returncode}: {tail}")
    print(f"[{utc_timestamp()}] dependencies ready")


def load_secrets() -> tuple[str, str]:
    """Read SUPABASE_URL / SUPABASE_KEY from Kaggle Secrets. Values never logged."""
    try:
        from kaggle_secrets import UserSecretsClient
    except ImportError as exc:
        raise SystemExit(
            "kaggle_secrets is unavailable — this worker must run inside a Kaggle "
            "notebook with the SUPABASE_URL and SUPABASE_KEY secrets attached."
        ) from exc
    client = UserSecretsClient()
    values: dict[str, str] = {}
    for name in ("SUPABASE_URL", "SUPABASE_KEY"):
        try:
            values[name] = str(client.get_secret(name) or "").strip()
        except Exception:
            values[name] = ""
    missing = [name for name in ("SUPABASE_URL", "SUPABASE_KEY") if not values[name]]
    if missing:
        raise SystemExit(
            "Required Kaggle secret(s) missing or empty: " + ", ".join(missing)
            + ". Add them under Add-ons -> Secrets (labels exactly SUPABASE_URL / "
            "SUPABASE_KEY) and attach them to this notebook. Values are never printed."
        )
    return values["SUPABASE_URL"], values["SUPABASE_KEY"]


def load_model(model_name: str) -> tuple[Any, Any]:
    """Load (and cache) a MusicGen model + processor pair.

    fp16 on CUDA when available, fp32 on CPU. Fails loudly if the model
    cannot be loaded. The cache means we never reload per chunk or per job.
    """
    import torch
    from transformers import AutoProcessor, MusicgenForConditionalGeneration

    cached = _MODEL_CACHE.get(model_name)
    if cached is not None:
        return cached
    if torch.cuda.is_available():
        device, dtype = "cuda", torch.float16
    else:
        device, dtype = "cpu", torch.float32
    try:
        try:
            model = MusicgenForConditionalGeneration.from_pretrained(model_name, torch_dtype=dtype)
        except TypeError:
            # Newer transformers renamed `torch_dtype` to `dtype`.
            model = MusicgenForConditionalGeneration.from_pretrained(model_name, dtype=dtype)
        model.to(device)
        model.eval()
        processor = AutoProcessor.from_pretrained(model_name)
    except Exception as exc:
        raise RuntimeError(f"failed to load model '{model_name}' on {device}: {exc}") from exc
    _MODEL_CACHE[model_name] = (model, processor)
    return _MODEL_CACHE[model_name]


def unload_model(model_name: str | None = None) -> None:
    """Delete the cached model (or the whole cache) and free CUDA memory."""
    if model_name is None:
        _MODEL_CACHE.clear()
    else:
        _MODEL_CACHE.pop(model_name, None)
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass  # torch not importable in this process — nothing to free


def free_gpu_memory() -> None:
    """Release GPU memory between jobs (models stay in the cache)."""
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def _generate_audio(
    model: Any,
    processor: Any,
    job: dict,
    clean_prompt: str,
    plan: list[int],
) -> tuple[Any, int]:
    """Run the chunk loop and return (mono float32 numpy audio, sampling_rate)."""
    import numpy as np
    import torch

    job_id = job.get("id")
    total_chunks = len(plan)

    enc_cfg = getattr(model.config, "audio_encoder", None)
    sr = getattr(enc_cfg, "sampling_rate", None) if enc_cfg is not None else None
    if not sr:
        # Expected value for MusicGen is 32000 Hz — but never hardcode silently:
        # if the config shape ever changes we must fail loudly, not write a
        # garbage-sample-rate WAV.
        raise RuntimeError(
            "model config is missing audio_encoder.sampling_rate "
            "(expected 32000 for MusicGen)"
        )
    frame_rate = getattr(enc_cfg, "frame_rate", None) if enc_cfg is not None else None
    if not frame_rate:
        frame_rate = 50.0  # MusicGen default token frame rate; only sizes max_new_tokens

    on_cuda = torch.cuda.is_available()
    acc: Any = None  # np.float32 mono accumulator
    continuation_ok = True  # flips to False if the processor rejects audio= inputs

    for idx, chunk_target in enumerate(plan):
        use_continuation = continuation_ok and idx > 0
        overlap = OVERLAP_S if use_continuation else 0
        max_new_tokens = int(round((overlap + chunk_target) * frame_rate))

        if use_continuation:
            # Continuation: feed the LAST 10s of accumulated audio back in as
            # prompt audio, together with the text prompt.
            prompt_audio = np.ascontiguousarray(acc[-int(OVERLAP_S * sr):], dtype=np.float32)
            try:
                inputs = processor(
                    audio=prompt_audio,
                    sampling_rate=sr,
                    text=clean_prompt,
                    return_tensors="pt",
                    padding=True,
                )
            except (TypeError, AttributeError, ValueError) as exc:
                # FALLBACK: the installed Transformers processor does not
                # accept audio= continuation inputs (older/newer signature).
                # Fall back to TEXT-ONLY chunking for the WHOLE job: every
                # chunk is generated from the text prompt alone, with no
                # continuation prompt and no overlap drop. The job still
                # completes — do not crash it over a processor signature.
                print(
                    f"[{utc_timestamp()}] job={job_id} | WARNING: processor rejected "
                    f"audio continuation ({type(exc).__name__}); switching to text-only "
                    f"chunking for the rest of this job"
                )
                continuation_ok = False
                use_continuation = False
                overlap = 0
                max_new_tokens = int(round(chunk_target * frame_rate))
                inputs = processor(text=clean_prompt, return_tensors="pt")
        else:
            inputs = processor(text=clean_prompt, return_tensors="pt")

        # MANDATORY device/dtype cast. NOTE (owner-documented bug): skipping
        # this crashes continuation generation with
        #   "Input type (float) and bias type (c10::Half) should be the same"
        # because the model weights are fp16 on CUDA while processor outputs
        # are fp32. Every floating-point tensor MUST become cuda+float16 and
        # every non-floating tensor (input_ids, attention_mask, ...) moves to
        # cuda with its dtype untouched.
        if on_cuda:
            inputs = {
                k: (v.to("cuda", torch.float16) if v.is_floating_point() else v.to("cuda"))
                for k, v in inputs.items()
            }
        else:
            # On CPU: move to CPU without changing dtypes.
            inputs = {k: v.to("cpu") for k, v in inputs.items()}

        audio_values = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=True,
            guidance_scale=3.0,
        )

        audio = np.squeeze(np.asarray(audio_values[0].cpu().float().numpy(), dtype=np.float32))
        if audio.ndim == 2:
            # Output came back 2-D as (samples, channels): keep channel 0
            # (documented choice — MusicGen is mono, channel 0 is the mix).
            audio = audio[:, 0]
        actual_s = len(audio) / sr

        if use_continuation:
            # Drop the overlap region (the first ~10s) before appending so the
            # continuation overlap is not duplicated in the final track.
            drop = min(int(OVERLAP_S * sr), max(len(audio) - 1, 0))
            audio = audio[drop:]

        acc = audio if acc is None else np.concatenate([acc, audio])

        # Per-chunk validation: never assume max_new_tokens produced exactly
        # the target duration — print actual vs target.
        print(
            f"[{utc_timestamp()}] job={job_id} type=music | gpu={gpu_summary()} | "
            f"stage=generating chunk {idx + 1}/{total_chunks} | "
            f"generated {actual_s:.1f}s for a {overlap + chunk_target:.0f}s target "
            f"(kept {len(audio) / sr:.1f}s)"
        )
        del inputs, audio_values  # free tensors promptly

    return acc, sr


def generate_music(job: dict, clean_prompt: str, duration_seconds: int) -> str:
    """Generate ``duration_seconds`` of music for ``job``; return the WAV path.

    Heavy (torch/transformers/scipy/numpy imported lazily). On CUDA OOM the
    primary model falls back to MUSICGEN_FALLBACK ONCE per job (reloaded from
    scratch, fp16); if the fallback also fails the exception propagates and
    process_job() marks the job failed.
    """
    import numpy as np

    job_id = job.get("id")
    plan = build_chunk_plan(duration_seconds)
    try:
        print(
            f"[{utc_timestamp()}] job={job_id} | gpu={gpu_summary()} | "
            f"stage=loading model {MUSICGEN_PRIMARY}"
        )
        model, processor = load_model(MUSICGEN_PRIMARY)
        acc, sr = _generate_audio(model, processor, job, clean_prompt, plan)
    except Exception as exc:
        if not _is_cuda_oom(exc):
            raise
        print(
            f"[{utc_timestamp()}] job={job_id} | CUDA out of memory on "
            f"{MUSICGEN_PRIMARY} — falling back to {MUSICGEN_FALLBACK} (once per job)"
        )
        unload_model(MUSICGEN_PRIMARY)
        print(
            f"[{utc_timestamp()}] job={job_id} | gpu={gpu_summary()} | "
            f"stage=loading model {MUSICGEN_FALLBACK}"
        )
        model, processor = load_model(MUSICGEN_FALLBACK)
        acc, sr = _generate_audio(model, processor, job, clean_prompt, plan)

    if acc is None or len(acc) == 0:
        raise RuntimeError("MusicGen produced no audio")

    # Trim to the requested duration. Clamp defensively: the plan was built
    # from the clamped duration, so this must never exceed MAX_DURATION_S.
    total_seconds = max(MIN_DURATION_S, min(MAX_DURATION_S, int(duration_seconds)))
    acc = acc[: int(total_seconds * sr)]
    wav = np.ascontiguousarray(np.squeeze(acc), dtype=np.float32)
    from scipy.io import wavfile

    wav_path = local_wav_path(job_id)
    wavfile.write(wav_path, sr, wav)
    print(
        f"[{utc_timestamp()}] job={job_id} | stage=encoded | wrote {wav_path} "
        f"({len(wav) / sr:.1f}s @ {sr} Hz)"
    )
    return wav_path


def make_supabase_request(base_url: str, api_key: str) -> Callable[..., Any]:
    """Build the supabase_request helper. The secrets stay in this closure.

    supabase_request(method, path, *, params=None, json_body=None, data=None,
                     extra_headers=None, timeout=API_TIMEOUT) -> parsed JSON

    - headers: {apikey, Authorization: Bearer, Content-Type: application/json}
      (extra_headers override)
    - base URL: SUPABASE_URL stripped of its trailing slash
    - retries ONLY idempotent GETs on transient failures (connection errors,
      429/5xx), max 2 retries with a small backoff; POST/PATCH are NEVER
      blind-retried
    - non-2xx raises RuntimeError (message never contains the key)
    """

    base = base_url.rstrip("/")

    def supabase_request(
        method: str,
        path: str,
        *,
        params: dict | None = None,
        json_body: dict | None = None,
        data: bytes | None = None,
        extra_headers: dict | None = None,
        timeout: tuple[int, int] = API_TIMEOUT,
    ) -> Any:
        import requests  # lazy — not needed at import time

        headers = {
            "apikey": api_key,
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        if extra_headers:
            headers.update(extra_headers)
        url = f"{base}{path}"
        method_upper = method.upper()
        retries_left = 2 if method_upper == "GET" else 0
        attempt = 0
        while True:
            attempt += 1
            try:
                resp = requests.request(
                    method_upper,
                    url,
                    params=params,
                    json=json_body,
                    data=data,
                    headers=headers,
                    timeout=timeout,
                )
            except requests.RequestException as exc:
                if retries_left > 0:
                    retries_left -= 1
                    delay = 2.0 * attempt
                    print(
                        f"[{utc_timestamp()}] transient network error on GET {path} "
                        f"— retrying in {delay:.0f}s"
                    )
                    time.sleep(delay)
                    continue
                raise RuntimeError(
                    f"Supabase request failed: {method_upper} {path}: "
                    f"{type(exc).__name__}: {exc}"
                ) from exc
            if 200 <= resp.status_code < 300:
                if not resp.content:
                    return None
                try:
                    return resp.json()
                except ValueError:
                    return None
            if retries_left > 0 and resp.status_code in (429, 500, 502, 503, 504):
                retries_left -= 1
                delay = 2.0 * attempt
                print(
                    f"[{utc_timestamp()}] Supabase GET {path} -> HTTP {resp.status_code} "
                    f"— retrying in {delay:.0f}s"
                )
                time.sleep(delay)
                continue
            body = (resp.text or "")[:300]
            raise RuntimeError(
                f"Supabase request failed: {method_upper} {path} -> "
                f"HTTP {resp.status_code}: {body}"
            )

    return supabase_request


def make_real_context(supabase_request: Callable[..., Any], base_url: str) -> JobContext:
    """Build the production context used by process_job().

    generate_music -> real MusicGen; upload -> Supabase Storage POST;
    patch_job -> guarded REST PATCH (only ever touches a 'running' row).
    """
    base = base_url.rstrip("/")

    class RealContext:
        def generate_music(self, job: dict, clean_prompt: str, duration_seconds: int) -> str:
            return generate_music(job, clean_prompt, duration_seconds)

        def upload(self, job_id: str, wav_path: str) -> str:
            with open(wav_path, "rb") as fh:
                wav_bytes = fh.read()
            supabase_request(
                "POST",
                f"/storage/v1/object/outputs/{job_id}.wav",
                data=wav_bytes,
                extra_headers={"Content-Type": "audio/wav", "x-upsert": "true"},
                timeout=UPLOAD_TIMEOUT,
            )
            # The 'outputs' bucket is PUBLIC, so this is the final result URL
            # (it contains the unguessable UUID job id, but no credentials).
            public_url = f"{base}/storage/v1/object/public/outputs/{job_id}.wav"
            print(f"[{utc_timestamp()}] job={job_id} | stage=uploaded | {public_url}")
            return public_url

        def patch_job(self, job_id: str, status: str, payload: dict) -> Any:
            body = dict(payload)
            body["status"] = status
            # Guarded update: only ever touches a row that is still 'running',
            # so a late done/failed can never overwrite a job that was already
            # completed or failed elsewhere.
            rows = supabase_request(
                "PATCH",
                "/rest/v1/jobs",
                params={"id": f"eq.{job_id}", "status": "eq.running"},
                json_body=body,
                extra_headers={"Prefer": "return=representation"},
                timeout=API_TIMEOUT,
            )
            if not should_apply_update(rows):
                print(
                    f"[{utc_timestamp()}] job={job_id} | no longer running — "
                    f"'{status}' update skipped (not overwriting)"
                )
            return rows

    return RealContext()


def run_forever(supabase_request: Callable[..., Any], ctx: JobContext, secret: str) -> None:
    """Outer poll loop — NEVER terminates because a job failed.

    Per-job processing is wrapped in try/except; only KeyboardInterrupt /
    SystemExit (BaseException, not caught by `except Exception`) end the loop
    cleanly. GPU memory is freed between jobs.
    """
    while True:
        candidates: list = []
        try:
            rows = supabase_request(
                "GET",
                "/rest/v1/jobs",
                params={
                    "select": JOBS_SELECT,
                    "status": "eq.pending",
                    "order": "created_at.asc",
                    "limit": str(CLAIM_BATCH),
                },
                timeout=API_TIMEOUT,
            )
            candidates = rows if isinstance(rows, list) else []
        except Exception as exc:
            print(f"[{utc_timestamp()}] poll error (continuing): {sanitize_error(exc, secret)}")

        active: dict | None = None
        for candidate in candidates:
            if not isinstance(candidate, dict) or not candidate.get("id"):
                continue
            # ATOMIC CLAIM: PATCH guarded by status=eq.pending. Proceed ONLY
            # with the row this PATCH returns — NEVER process a job merely
            # because the SELECT above returned it (another worker may have
            # claimed it in between).
            try:
                claimed = supabase_request(
                    "PATCH",
                    "/rest/v1/jobs",
                    params={"id": f"eq.{candidate['id']}", "status": "eq.pending"},
                    json_body={"status": "running"},
                    extra_headers={"Prefer": "return=representation"},
                    timeout=API_TIMEOUT,
                )
            except Exception as exc:
                print(
                    f"[{utc_timestamp()}] claim error for job {candidate['id']} "
                    f"(trying next candidate): {sanitize_error(exc, secret)}"
                )
                continue
            if is_claimed(claimed):
                active = claimed[0]
                break
            # 0 rows -> another worker claimed it -> try the next candidate.
            print(
                f"[{utc_timestamp()}] job {candidate['id']} already claimed by "
                f"another worker — skipping"
            )

        if active is None:
            # pending count is capped by the query limit (CLAIM_BATCH).
            print(f"[{utc_timestamp()}] idle | gpu={gpu_summary()} | pending={len(candidates)}")
            time.sleep(POLL_INTERVAL_S)
            continue

        job_id = active.get("id")
        print(
            f"[{utc_timestamp()}] job={job_id} type={active.get('type')} | "
            f"gpu={gpu_summary()} | stage=claimed"
        )
        try:
            process_job(active, ctx, secret=secret)
        except Exception as exc:
            # process_job is designed never to raise, but the loop must
            # survive anything (KeyboardInterrupt/SystemExit are
            # BaseException and are NOT caught by `except Exception`).
            print(
                f"[{utc_timestamp()}] job={job_id} | unexpected processing error "
                f"(continuing): {sanitize_error(exc, secret)}"
            )
        finally:
            _remove_local_wav(job_id)
            free_gpu_memory()
        # Loop immediately — more pending jobs may be waiting.


def main() -> None:
    """Kaggle entry point: install deps once, load secrets, poll forever."""
    install_dependencies()
    base_url, api_key = load_secrets()
    supabase_request = make_supabase_request(base_url, api_key)
    ctx = make_real_context(supabase_request, base_url)
    print(
        f"[{utc_timestamp()}] worker started | gpu={gpu_summary()} | "
        f"polling every {POLL_INTERVAL_S}s | primary={MUSICGEN_PRIMARY} "
        f"(fallback={MUSICGEN_FALLBACK})"
    )
    run_forever(supabase_request, ctx, secret=api_key)


if __name__ == "__main__":
    # In a Kaggle notebook cell __name__ IS "__main__", so paste-and-run works.
    try:
        main()
    except KeyboardInterrupt:
        # Only KeyboardInterrupt (here) / SystemExit (from main) end cleanly.
        print(f"[{utc_timestamp()}] KeyboardInterrupt — worker stopped cleanly")
