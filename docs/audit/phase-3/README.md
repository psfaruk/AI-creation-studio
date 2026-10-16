# Phase 3 — Media Quality, Cost & Latency Optimization

Scope: 4 workstreams on `psfaruk/AI-creation-studio` —
**A** motion-video TTS fallback reliability (last P0-BUG-01 call site),
**B** final-mix loudness (~−16 LUFS / −1.5 dBTP, P0-BUG-02),
**C** successful-shot cache reuse (P0-BUG-04),
**D** stage-level latency metrics + retry/cancellation audit.

Docs: `implementation-design.md` (pre-implementation design, workflow Step 2) ·
`functional-test-results.md` · `media-quality-results.md` · `cache-reuse-results.md` ·
`latency-results.md` · `bug-register.md` · `phase-3-exit-report.md`.

Evidence classes used throughout: **code-inspected** / **unit-test** /
**local-integration** / **live-provider**. No live provider calls were made in this
phase; every provider-dependent claim is labeled accordingly.

---

## 1. Baseline & safety audit (Step 1) — including a sandbox snapshot-restore incident

### 1.1 Incident (detected, diagnosed, resolved losslessly)

**Expected** baseline: `2b0ef3e…` (Phase-2 Round 1, pushed to GitHub by the previous
session). **Found**: local HEAD `f5fe336` (2026-10-14 18:20, "deep-audit fix round"),
the `2b0ef3e` object absent locally, stale `origin/main` tracking ref, and 3 files
with uncommitted **mode-only** changes (100644→100755, 0 content diff).

**Diagnosis** (reflog evidence): this sandbox instance was restored to a snapshot
taken at the `f5fe336` state. The Phase 0→2 conversation ran in a different/continued
instance which pushed `4b628fa` → `8c472fb` → `2b0ef3e` to GitHub (persisted); its
local commits and an uncommitted worklog "P2-1-push" entry were lost with that
instance's runtime state. The worklog entry is reconstructed in `worklog.md` (P3-1).

**Resolution** (verified lossless before execution):
`git fetch origin main` → `origin/main = 2b0ef3ebc8d1d4e7a92343dd01772638c9bbfbf2`
(exact expected SHA); `merge-base` proves `f5fe336` **is an ancestor** (nested, zero
divergence — no history rewrite, nothing lost); the 3 local mode-only changes are
byte-identical to the mode changes committed inside `4b628fa`. Executed:
`chmod 644` the 3 content-identical files → `git merge --ff-only origin main` →
HEAD = `2b0ef3e`, working tree clean, full local deep-audit history preserved as
ancestors. **No force/reset/amend, no new commits, no push.**

### 1.2 Baseline state (after recovery)

| Check | Result |
|---|---|
| `bun run test` | **47/47 pass, exit 0** (10.3s) — matches Phase-2 end state |
| `bun run typecheck` / `bun run lint` / `bunx prisma validate` | all exit 0 |
| Dev server | Next.js 16.1.3 on :3000, healthy, clean recent `dev.log` |
| FFmpeg / ffprobe | **7.1.5** — `loudnorm` + `ebur128` filters available |
| Dev DB | schema-valid, **pristine** (0 rows everywhere) |
| `storage/` | absent (snapshot dropped gitignored runtime dirs; app self-heals via `mkdir recursive`) |

### 1.3 Environment deltas vs the planning conversation (honest record)

- The Phase-0/1 reference production `yrz3ymb7` and its 8 artifacts (incl. the
  −25.4 LUFS short-film MP4) existed only in the lost instance's runtime storage.
  **No real recorded media artifact exists in this sandbox** → Workstream B's
  "real local test artifact before/after" measurement is **NOT RUN** (regenerating
  it needs live provider budget). Real-codec synthetic fixtures provide the
  local-integration evidence instead (`media-quality-results.md`).
- DB md5 at baseline: `3cc4e8e58a3436c299f95f3661a03b58` (differs from the previous
  session's noted hash — different physical file after restore; schema validity and
  test isolation are what matter, and both hold).

### 1.4 Target recon (all file:line-verified)

- **A**: `motion_video.ts:645` — the only production TTS call still bypassing the
  Phase-2 shared fallback chain; no SRT in motion_video; cursor-based timing.
- **B**: `sound_design.ts:564` `mixSoundLayers` measures LUFS but never normalizes
  (only flags < −30) → the −25.4 LUFS recording passed QC silently (P0-BUG-02).
- **C**: `ai_video.ts:501` `generateVideoClip` = single choke point for all
  pipelines + prewarm; request = prompt/duration/quality/imageUrl/withAudio/size;
  `validateVideoBuffer` gates every clip; `tts-cache` = architectural template.
- **D**: `queueWaitMs` already wired (runner.ts:528); Phase-1 latency table is the
  evidence base (generate_shots = 1,079.7s of 1,436s ≈ 75%).
