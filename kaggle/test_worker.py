"""Stdlib-only test suite for kaggle/worker.py.

Run from the repository root:

    python3 kaggle/test_worker.py

This MUST pass (exit 0) with ZERO third-party packages installed — no torch,
no transformers, no scipy, no requests. That is exactly why worker.py keeps
every heavy import lazy (inside function bodies). The first test below asserts
that contract.
"""

from __future__ import annotations

import os
import sys
import unittest

# Make `import worker` work no matter the current working directory.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import worker  # noqa: E402  (imports cleanly with the standard library only)


class FakeCtx:
    """Minimal recording stand-in for the worker context (no torch needed)."""

    def __init__(self, generate_exc=None, upload_exc=None, patch_exc=None):
        self.generate_calls = []
        self.upload_calls = []
        self.patch_calls = []
        self._generate_exc = generate_exc
        self._upload_exc = upload_exc
        self._patch_exc = patch_exc

    def generate_music(self, job, clean_prompt, duration_seconds):
        self.generate_calls.append((job["id"], clean_prompt, duration_seconds))
        if self._generate_exc is not None:
            raise self._generate_exc
        return f"/tmp/music_{job['id']}.wav"

    def upload(self, job_id, wav_path):
        self.upload_calls.append((job_id, wav_path))
        if self._upload_exc is not None:
            raise self._upload_exc
        return f"https://example.supabase.co/storage/v1/object/public/outputs/{job_id}.wav"

    def patch_job(self, job_id, status, payload):
        self.patch_calls.append((job_id, status, dict(payload)))
        if self._patch_exc is not None:
            raise self._patch_exc
        return [{"id": job_id, "status": status}]


class WorkerImportTests(unittest.TestCase):
    def test_imports_without_third_party_packages(self):
        """worker.py must not import torch/transformers/scipy/requests at module level."""
        for module in ("torch", "transformers", "scipy", "requests"):
            self.assertNotIn(
                module,
                sys.modules,
                f"worker.py must keep '{module}' imports lazy (inside functions)",
            )

    def test_required_constants(self):
        self.assertEqual(worker.POLL_INTERVAL_S, 15)
        self.assertEqual(worker.CHUNK_SECONDS, 20)
        self.assertEqual(worker.MAX_CHUNKS, 9)
        self.assertEqual(worker.MIN_DURATION_S, 1)
        self.assertEqual(worker.MAX_DURATION_S, 180)
        self.assertEqual(worker.OVERLAP_S, 10)
        self.assertEqual(worker.MUSICGEN_PRIMARY, "facebook/musicgen-medium")
        self.assertEqual(worker.MUSICGEN_FALLBACK, "facebook/musicgen-small")
        self.assertEqual(worker.ERROR_MAX_CHARS, 500)


class ParseMusicPromptTests(unittest.TestCase):
    def test_no_directive_keeps_prompt_and_returns_default_180(self):
        prompt = "soft rainy lofi beat with piano"
        self.assertEqual(worker.parse_music_prompt(prompt), (prompt, 180))

    def test_integer_directive_parsed_and_stripped(self):
        self.assertEqual(
            worker.parse_music_prompt("upbeat folk [duration=120]"),
            ("upbeat folk", 120),
        )

    def test_duration_clamped_to_maximum(self):
        clean, duration = worker.parse_music_prompt("epic drums [duration=500]")
        self.assertEqual(clean, "epic drums")
        self.assertEqual(duration, 180)

    def test_duration_clamped_to_minimum(self):
        clean, duration = worker.parse_music_prompt("epic drums [duration=0]")
        self.assertEqual(clean, "epic drums")
        self.assertEqual(duration, 1)

    def test_non_integer_directive_is_ignored(self):
        prompt = "song [duration=abc] please"
        clean, duration = worker.parse_music_prompt(prompt)
        self.assertEqual(clean, prompt)  # non-matching text left as-is
        self.assertEqual(duration, 180)

    def test_directive_embedded_in_text_is_stripped_cleanly(self):
        clean, duration = worker.parse_music_prompt(
            "sad bengali folk [duration=45] with flute"
        )
        self.assertEqual(clean, "sad bengali folk with flute")
        self.assertEqual(duration, 45)


class BuildChunkPlanTests(unittest.TestCase):
    def test_180s_is_nine_full_chunks(self):
        self.assertEqual(worker.build_chunk_plan(180), [20] * 9)

    def test_45s_is_two_full_chunks_plus_remainder(self):
        self.assertEqual(worker.build_chunk_plan(45), [20, 20, 5])

    def test_20s_is_single_full_chunk(self):
        self.assertEqual(worker.build_chunk_plan(20), [20])

    def test_15s_is_single_short_chunk(self):
        self.assertEqual(worker.build_chunk_plan(15), [15])

    def test_sum_always_equals_clamped_duration(self):
        for duration in (1, 7, 19, 20, 21, 41, 45, 100, 179, 180, 181, 200, 1000, 0, -5):
            plan = worker.build_chunk_plan(duration)
            clamped = max(1, min(180, duration))
            self.assertEqual(sum(plan), clamped, msg=f"duration={duration}")
            self.assertTrue(all(c >= 1 for c in plan), msg=f"duration={duration}")

    def test_length_never_exceeds_max_chunks(self):
        for duration in range(1, 181):
            self.assertLessEqual(
                len(worker.build_chunk_plan(duration)), 9, msg=f"duration={duration}"
            )


class SanitizeErrorTests(unittest.TestCase):
    def test_long_messages_are_capped_at_500_chars(self):
        result = worker.sanitize_error("e" * 600, "")
        self.assertEqual(len(result), 500)
        self.assertEqual(result, "e" * 500)

    def test_secret_value_is_masked(self):
        secret = "super-secret-service-key-123"
        message = f"Supabase rejected request with key {secret} (HTTP 403)"
        result = worker.sanitize_error(message, secret)
        self.assertNotIn(secret, result)
        self.assertIn("***", result)

    def test_bearer_token_fragment_is_masked(self):
        result = worker.sanitize_error(
            "401 Unauthorized: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
            "a-different-secret",
        )
        self.assertNotIn("eyJhbGciOiJIUzI1NiJ9.payload.sig", result)
        self.assertIn("Bearer ***", result)

    def test_non_string_errors_are_stringified_safely(self):
        self.assertEqual(worker.sanitize_error(12345, ""), "12345")
        self.assertEqual(worker.sanitize_error(ValueError("no digits"), ""), "no digits")
        self.assertEqual(worker.sanitize_error(None, ""), "None")


class IsClaimedTests(unittest.TestCase):
    def test_empty_list_is_not_claimed(self):
        self.assertFalse(worker.is_claimed([]))

    def test_single_row_is_claimed(self):
        self.assertTrue(worker.is_claimed([{"id": "a", "status": "running"}]))

    def test_two_rows_is_not_claimed(self):
        rows = [{"id": "a"}, {"id": "b"}]
        self.assertFalse(worker.is_claimed(rows))

    def test_non_list_is_not_claimed(self):
        self.assertFalse(worker.is_claimed(None))
        self.assertFalse(worker.is_claimed({"id": "a"}))
        self.assertFalse(worker.is_claimed("one row"))
        self.assertFalse(worker.is_claimed(1))


class ShouldApplyUpdateTests(unittest.TestCase):
    def test_empty_list_is_not_applied(self):
        self.assertFalse(worker.should_apply_update([]))

    def test_single_row_is_applied(self):
        self.assertTrue(worker.should_apply_update([{"id": "a", "status": "done"}]))

    def test_two_rows_is_not_applied(self):
        rows = [{"id": "a"}, {"id": "b"}]
        self.assertFalse(worker.should_apply_update(rows))

    def test_non_list_is_not_applied(self):
        self.assertFalse(worker.should_apply_update(None))
        self.assertFalse(worker.should_apply_update({"id": "a"}))
        self.assertFalse(worker.should_apply_update("one row"))


class ProcessJobTests(unittest.TestCase):
    def test_music_success_marks_job_done(self):
        ctx = FakeCtx()
        job = {"id": "j-1", "type": "music", "prompt": "calm sitar melody [duration=45]"}
        self.assertTrue(worker.process_job(job, ctx))
        # prompt parsed, directive stripped, duration 45
        self.assertEqual(ctx.generate_calls, [("j-1", "calm sitar melody", 45)])
        self.assertEqual(ctx.upload_calls, [("j-1", "/tmp/music_j-1.wav")])
        self.assertEqual(len(ctx.patch_calls), 1)
        job_id, status, payload = ctx.patch_calls[0]
        self.assertEqual((job_id, status), ("j-1", "done"))
        self.assertEqual(
            payload,
            {"result_url": "https://example.supabase.co/storage/v1/object/public/outputs/j-1.wav"},
        )

    def test_music_generation_failure_marks_job_failed_with_sanitized_error(self):
        ctx = FakeCtx(generate_exc=RuntimeError("boom " + "x" * 600))
        job = {"id": "j-2", "type": "music", "prompt": "loud drums"}
        self.assertTrue(worker.process_job(job, ctx))  # loop continues
        self.assertEqual(ctx.upload_calls, [])
        self.assertEqual(len(ctx.patch_calls), 1)
        job_id, status, payload = ctx.patch_calls[0]
        self.assertEqual((job_id, status), ("j-2", "failed"))
        error = payload["error"]
        self.assertTrue(error.startswith("boom "))
        self.assertLessEqual(len(error), 500)

    def test_upload_failure_marks_job_failed(self):
        ctx = FakeCtx(upload_exc=RuntimeError("storage exploded"))
        job = {"id": "j-3", "type": "music", "prompt": "gentle rain"}
        self.assertTrue(worker.process_job(job, ctx))
        self.assertEqual(len(ctx.patch_calls), 1)
        job_id, status, payload = ctx.patch_calls[0]
        self.assertEqual((job_id, status), ("j-3", "failed"))
        self.assertIn("storage exploded", payload["error"])
        self.assertLessEqual(len(payload["error"]), 500)

    def test_video_job_fails_with_exact_phase2_message(self):
        ctx = FakeCtx()
        job = {"id": "v-1", "type": "video", "prompt": "cinematic b-roll of dhaka at dusk"}
        self.assertTrue(worker.process_job(job, ctx))
        self.assertEqual(ctx.generate_calls, [])  # never pretends to generate video
        self.assertEqual(ctx.upload_calls, [])
        self.assertEqual(
            ctx.patch_calls,
            [("v-1", "failed", {"error": "video worker not implemented yet"})],
        )

    def test_video_patch_failure_does_not_raise(self):
        ctx = FakeCtx(patch_exc=RuntimeError("db down"))
        job = {"id": "v-2", "type": "video", "prompt": "x"}
        self.assertTrue(worker.process_job(job, ctx))  # must not raise

    def test_music_patch_failure_on_error_path_does_not_raise(self):
        ctx = FakeCtx(generate_exc=RuntimeError("boom"), patch_exc=RuntimeError("db down"))
        job = {"id": "j-4", "type": "music", "prompt": "x"}
        self.assertTrue(worker.process_job(job, ctx))  # must not raise

    def test_music_patch_failure_on_done_path_does_not_raise(self):
        ctx = FakeCtx(patch_exc=RuntimeError("db down"))
        job = {"id": "j-5", "type": "music", "prompt": "y"}
        self.assertTrue(worker.process_job(job, ctx))  # must not raise


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromModule(
        sys.modules[__name__]
    )
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    total = result.testsRun
    failures = len(result.failures) + len(result.errors)
    if failures:
        print(f"\n{failures}/{total} TESTS FAILED")
        return 1
    print(f"\nALL {total} TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
