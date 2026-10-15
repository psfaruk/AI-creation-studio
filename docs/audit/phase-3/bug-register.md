# Phase 3 — Bug Register (delta)

Full Phase-0 register: `docs/audit/phase-0/bug-register.md` (17 entries).
This delta covers Phase-3 status changes only. Statuses: Confirmed / FIXED /
MITIGATED / DEFERRED / NOT RUN.

| ID | Title | Phase-2 status | Phase-3 status | Evidence |
|---|---|---|---|---|
| P0-BUG-01 | Bengali TTS fallback chain (single-engine failure drops all speech) | FIXED (3 of 4 call sites; `motion_video.ts:645` deferred as follow-up) | **FIXED — fully closed** (last call site now routes through the shared `synthesizeVerifiedSpeech` chain via the new `synthesizeVoiceoverChunks`; honest per-chunk fallback notes + actual-voice metadata; ASR cost unchanged `verify:false`) | REG-8a–g (7/7); REG-1 unchanged green |
| P0-BUG-02 | Final-mix loudness (−25.4 LUFS vs −16 target; QC only flags < −30) | open | **FIXED for the short-film finalization path** — `mixSoundLayers` now applies two-pass loudnorm (−16 LUFS / −1.5 dBTP) after the §8 layer merge, with honest silence/corrupt/layout handling and truthful report fields | REG-9a–g (7/7): −24.3 → −15.9 LUFS, TP −10.5 dBTP, duration/layout/sync preserved |
| P0-BUG-03 | Chat run refresh loses state / parallel run | FIXED | unchanged (kept green) | REG-2/REG-3/REG-7 |
| P0-BUG-04 | No AI-shot reuse across re-runs (full provider cost every run) | open (intentional deferral) | **FIXED** — cross-run shot cache at the `generateVideoClip` choke point: strict sha256 request-fingerprint keys, reuse-time re-validation, in-flight dedupe, eviction budget, honest counters + `ক্যাশ-হিট` labels | REG-10a–j (10/10) |
| P0-BUG-13 | Concurrency vs video gate | hypothesis | unchanged — concurrency invariants preserved; gate untouched (audit table in `latency-results.md`) | code-inspected |

## New findings this phase (found by the new tests, fixed immediately)

| Finding | Impact | Fix |
|---|---|---|
| First `shotCacheLookup` counted plain misses (ENOENT) as `invalid`, and decremented `entries` accordingly — misleading observability | metrics honesty (no functional loss) | lookup now distinguishes clean-miss (no entry) from corrupt-entry (evict + `invalid++`); REG-10b asserts `invalid === 0` across 5 clean misses |
| `mixSoundLayers` ran its raw mix through bare `execFileAsync` — outside the ffmpeg cancel-kill tracking system | a cancelled production waited out the mix encode instead of being killed | switched to `runFfmpeg` (identical exit-code contract, plus production tracking) |
| (tooling) ebur128 in ffmpeg 7.1.5 prints true-peak under `True peak:` with a dBFS label; loudnorm reports `input_i:"-inf"` for digital silence | measurement correctness for B | `measureLoudness` parses the section (+TPK fallback); silence handled before the filter (REG-9a/9d cover both) |

## Remaining open (unchanged by Phase 3, future-phase candidates)

- P0-BUG-02 scope note: `motion_video`'s `mixAudioTracks` and music-video paths have
  the same measures-but-doesn't-normalize shape; Phase-3 scope named the short-film
  finalization only. The helper (`normalizeLoudnessTwoPass`) is generic and ready.
- Build verification (`next build`) NOT RUN (sandbox rule) — carried from Phases 0–2.
- Live Edge-403 window verification, browser-E2E re-attach DOM harness — carried
  from Phase 2 (budget/tooling).
