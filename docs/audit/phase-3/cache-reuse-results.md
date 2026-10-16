# Phase 3 — Cache Reuse Results (Workstream C: successful-shot cache)

Fix under test: `generateVideoClip` (`ai_video.ts`) is now cache-aware — the single
choke point for all pipelines (motion/music/film), prewarm and multi-clip paths.
Cache module: `src/lib/agent/video/shot_cache.ts` (`storage/shot-cache/`,
tts-cache-style sharded hex paths). **No savings are claimed beyond the counters
below; real-world savings accrue only in future live runs.**

## 1. Cache-key schema (what is in / out, and why)

Key = SHA-256 over canonical JSON of the **full provider request**:
`{ v (schema), model, prompt (sliced+trimmed exactly as sent), durationSec
(clamped 5|10), quality, imageUrlSha256 (sha256 of exact data-URL bytes),
withAudio, size }`.

- **In**: every field that determines the provider output (REG-10b proves each of
  prompt/duration/withAudio/imageUrl flips the key → miss).
- **Out (deliberate, documented)**: `width/height/fps` — NOT provider inputs; they
  are the local ffmpeg normalization (`motion_video.ts` generateAiShot) which is
  deterministically re-applied on every hit, so a hit yields the identical final
  clip. Including them would only reduce reuse with zero safety gain.
- **Out**: `requestKey` (§10 idempotency identity — per-run, output-neutral),
  `onStatus`/`isCancelled` (behavioral callbacks).

## 2. Safety properties (each test-locked in REG-10)

| Property | Mechanism | Test |
|---|---|---|
| Path traversal impossible | on-disk name is the 64-hex fingerprint itself; non-hex rejected; directory tree contains only `[0-9a-f]{64}.(mp4|meta.json)` | REG-10h |
| Only completed+validated reused | store happens **after** `validateVideoBuffer` ok; lookup re-validates (ffprobe) on every hit | REG-10a/10d |
| Corrupt entries self-heal | meta-shape/size/media/validation failures → entry evicted, `invalid++`, caller regenerates | REG-10d |
| Concurrency safe | in-flight dedupe (2nd identical caller joins the running promise); `.tmp`→`rename` atomic writes | REG-10e |
| Cache ≠ temp | root `storage/shot-cache/` is outside `storage/productions/{id}`; per-run `rm -rf` can never touch it; only explicit eviction deletes entries | design + REG-10g |
| Disk budget | 512 MiB default cap; FIFO-by-storedAt eviction; `evictions`/`bytesStored`/`entries` counters | REG-10g |
| Bypass | `bypassCache` opt-out: provider called, nothing stored, counted separately | REG-10f |
| Honest labeling | `fromCache` → engine label `প্রকৃত AI (ক্যাশ-হিট, <model>)` + `ShotEngineRecord.cacheHit` — real AI output, reused, never mislabeled | REG-10a + code |

A real defect was caught by these tests and fixed: the first implementation counted
plain misses (ENOENT) as `invalid`; the fixed lookup distinguishes clean-miss from
corrupt-entry (REG-10b now asserts `invalid === 0` across 5 clean misses).

## 3. Counters (observability — the only basis for any savings claim)

`shotCacheStats()`: `{ hits, joined, misses, bypass, invalid, stores, evictions,
bytesStored, entries }` (globalThis/HMR-safe, mirrors `ttsCacheStats`). Wired into
the per-production metrics line as `video.*` fields (Workstream D) — so a real run
reports its own reuse truthfully at production end.

**Counter verification (mocked-provider, real fs/ffmpeg — REG-10j exact snapshot):**
scenario "miss+store → hit → different miss+store → bypass" yields
`{hits:1, joined:0, misses:2, bypass:1, invalid:0, stores:2, evictions:0,
bytesStored:2×fixture, entries:2}` — exactly the scripted ground truth.

## 4. Duplicate-submission behavior (acceptance criterion)

- **Same input** → validated disk hit, **no second provider submit** (REG-10a:
  submit-count stays 1; REG-10i: prewarm of a cached request also resolves without
  submitting).
- **Concurrent same input** → one submit, second caller joins (REG-10e).
- **Any changed input** → miss → real provider call (REG-10b).
- Provider-call metrics are the real counters above (mocked provider in tests;
  zero real provider calls were made in this phase — **no real-world savings are
  claimed yet**).

## 5. Honest trade-off

Identical requests return the identical previously-generated clip (no fresh
variation). Mitigations: the fingerprint is strict (any meaningful change → fresh
generation), reuse is re-validated, and `bypassCache` exists for forced fresh
variation. Documented in code and here.

## 6. NOT RUN / future evidence

| Item | Status |
|---|---|
| Real live-run hit/miss rates & provider-call savings | **NOT RUN** — requires live budget; counters are in place to measure it truthfully when runs happen |
| Full `generateAiShot` hit→normalize equivalence vs fresh→normalize (byte-level) | code-inspected (deterministic ffmpeg normalization of identical bytes); the clip-level equivalence is REG-10c-proven |
