# Recovery Phase 1–5 — Security & Diff Review (R-DOC-3)

Read-only review of the **uncommitted** recovery working tree (audit R-A1/A2/B/C/D/E →
R-FIX → R-WAVE4). All commands below were executed read-only on 2026-10-16 (post R-FIX,
post R-WAVE4). Baseline: local HEAD = `c7927f7` ("phase-5: cinematic director & camera shot
planning + review fixes") — **unchanged**: no commit, no push, no reset/amend during the
recovery round (verified: `git log -1` still resolves to c7927f7; all recovery work sits in
the working tree, awaiting the user's commit decision).

## 1. `git status --porcelain` — 44 entries, categorized

| Category | Count | Entries |
|---|---|---|
| Modified `src/**` | **30** | api: `chat/route.ts`, `runs/[id]/events/route.ts`; components: `security-gate.tsx`, `production-card.tsx`, `studio-view.tsx`; hooks: `use-config-panel.ts`; agent core: `edge_tts.ts`, `language_controller.ts`, `availability-matrix.ts`, `capabilities.ts`, `llm.ts`, `model-registry-data.ts`, `orchestrator.ts`, `registry.ts`, `tts-cache.ts`, `types.ts`; cinematic: `capability_map.ts`, `planner.ts`, `prompt.ts`, `types.ts`, `validate.ts`; intent: `classifier.ts`; pipelines: `audio.ts`, `motion_video.ts`, `music_video.ts`, `short_film.ts`, `voiceover.ts`; production: `runner.ts`; tools: `audio.ts`; video: `ai_video.ts` |
| Modified `tests/**` | **8** | t1, t2, t3, t8, t12, t13, t16, t18 |
| Untracked (new) source | **1** | `src/lib/agent/cinematic/lang-guard.ts` (D-F03 shared prompt-language contract — lead-authored) |
| Untracked (new) tests + fixture | **3** | `tests/regression/t20-bengali-language-integrity.test.ts`, `tests/regression/t21-dialogue-timing-contract.test.ts`, `tests/fixtures/` (contains only `language/defect-a-transcripts.json`) |
| Untracked (new) docs | **1** | `docs/audit/recovery-phase-1-5/` (findings a1/a2/b/c/d/e + this document set) |
| Modified log | **1** | `worklog.md` (append-only — see §5) |

`git diff --stat` (tracked modifications): **39 files changed, 2795 insertions(+), 475 deletions(-)**.

## 2. Secrets scan of the diff — NONE introduced

Command executed (read-only): `git diff | grep -iE 'token|secret|password|api[_-]?key' | head`
→ **19 matching lines, all verified benign**:

| Match class | Count | Verdict |
|---|---|---|
| `withStudioToken(...)` / `import { withStudioToken }` in `use-config-panel.ts` | 4 | function *names* (the existing `?st=` auth helper); no credential material |
| `topToken` / `tokens` in `language_controller.ts` | 8 | variable names inside the new `detectTrivialRepetition` (ASR transcript text tokens, nothing to do with auth) |
| `requireOwner(req, { allowQueryToken: true })` | 1 | **context line** (pre-existing API of the runs-events route; appears as hunk context in the A1-F02 diff) |
| `const TRUSTED_CLIENT_TOKEN = '6A5AA1D4…'` | 1 | **context line** in `edge_tts.ts` — the *public* Microsoft Edge-TTS trusted-client constant used in the WSS URL (`?TrustedClientToken=…`, `edge_tts.ts:31/145/238`), pre-existing, publicly documented by the edge-tts ecosystem, not a user credential and **not added by this diff** |
| `TOKEN_HEADER`-adjacent hunk lines | rest | header-name constants in pre-existing auth code paths |

**Conclusion:** no user credentials, provider API keys, passwords or secrets appear in the
diff — neither added nor removed. The remote access token lives only in `.git/config`
(never printed, never part of any diff). `storage/` and `db/` remain gitignored; no
artifact bytes or DB contents enter version control (the only promoted file is the
binary-free transcript JSON, §4).

## 3. Migrations, dependencies, unrelated changes

- **Prisma schema untouched:** `git diff --stat -- prisma/` → **empty** (0 files changed);
  `bunx prisma validate` → "The schema at prisma/schema.prisma is valid 🚀", exit 0
  (`/tmp/r-g-prisma.log`). **No migration was created or applied.**
- **No new dependencies:** `git diff --stat -- package.json bun.lock` → **empty**. The
  suite still runs on bun:test with zero added test frameworks (unchanged Phase-1 constraint).
- **Unrelated changes: none found.** Every modified file maps to a numbered finding from
  the six read-only audits (62 findings: 3×P0, ~8×P1, remainder P2/P3) and to the R-FIX
  worklog entry — e.g. `language_controller.ts` (RC-1…RC-5 rewrite), `short_film.ts`
  (+651 lines: B-F02/C-F03/C-F04/C-F07/D-F02/D-F05/E-F01/E-F03 fixes), `planner.ts`
  (D-F03/D-F04/A2-F03/A2-F05/A2-F06), `security-gate.tsx` (one 2-line defensive guard,
  §5), `runner.ts` (§4). No drive-by refactors, no formatting-only churn, no changes
  outside the finding-derived scope.

## 4. `runner.ts` origin-parity change — documented as security hardening (A2-F04)

The one change that tightens an authorization boundary:

```ts
// A2-F04 (R-FIX-4 — lead): প্রিভিউ-রাউটের সাথে উৎস-সমতা — শুধু নিজ
// কথোপকথনের আর্টিফ্যাকটই পাঠযোগ্য (নিরাপত্তা: অন্য কথোপকথনের আর্টিফ্যাকট
// নয় — REG-18c-শ্রেণির প্যারিটি); গান-ইনপুটে কেবল user_upload-অডিও।
if (artifact.conversationId && artifact.conversationId !== run.conversationId) { throw … }
if (opts?.requireUserUpload && artifact.origin !== 'user_upload') { throw … }
```

Before: the runner's `resolveArtifactFile` would read **any** artifact id (the plan-preview
route already enforced ownership + user_upload; the runner did not — the A2-F04 origin-parity
gap). After: cross-conversation artifact reads are rejected, and song inputs accept only
`origin === 'user_upload'` audio — parity with the route layer. This closes an
IDOR-class gap in production runs; no legitimate flow was weakened.

Related hardening in the same wave: the security-gate fetch wrapper's defensive guard
(§5), and `text_to_speech` tool bypass closed (B-F08 — the raw tool now routes through the
language controller instead of calling the SDK directly with a default Chinese voice).

## 5. worklog.md append-only — honored

`git diff --numstat -- worklog.md` → **133 insertions, 0 deletions**. The recovery entries
(R-A2, R-A1, R-C, R-D, R-E, R-B, R-FIX, R-WAVE4) are pure appends; no prior entry was
edited, reordered or deleted.

## 6. Explicit confirmations (master §13 items 12–14 context)

- **No commit, no push** — HEAD remains `c7927f7`; the entire recovery diff is uncommitted,
  awaiting the user's approval (their explicit next-decision gate).
- **No secrets** in the diff (§2); remote token confined to `.git/config`.
- **No unauthorized migration** — Prisma untouched (§3).
- **No paid-provider spend beyond the documented minimal Wave-4 set** (1× TTS en + 1× ASR +
  3× VLM + free Edge probe — `live-provider-test-requirements.md` §1.5).
- **No Phase 6 started** — recovery scope only; every fix maps to a numbered finding.
