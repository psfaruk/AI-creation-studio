# Kaggle GPU Music Worker

A free Kaggle T4 GPU notebook that acts as a background music-generation worker
for the AI Creation Studio job queue:

- The Next.js app inserts a row into the Supabase `jobs` table
  (`type='music'`, `status='pending'`).
- This worker (one Kaggle notebook cell running `worker.py`) polls that queue,
  atomically claims a job, generates music with Meta **MusicGen** on the GPU,
  uploads the WAV to the public `outputs` storage bucket, and marks the job
  `done` with the public result URL.
- Files here: `worker.py` (paste into ONE notebook cell) and `test_worker.py`
  (stdlib-only sanity tests — `python3 kaggle/test_worker.py` from the repo
  root, no GPU and no third-party packages needed, must exit 0).

## 1. One-time Kaggle setup

1. On kaggle.com: **Code → New Notebook**.
2. Right panel → **Settings → Accelerator → GPU T4 x2** (the worker uses a
   single CUDA device; T4 x2 is the free GPU option).
3. **Settings → Internet → On** — required for the one-time pip install, the
   Hugging Face model download, and the Supabase REST/Storage calls.
4. **Add-ons → Secrets → Add** — create both secrets with labels EXACTLY:

   | Label          | Value                                                        |
   | -------------- | ------------------------------------------------------------ |
   | `SUPABASE_URL` | `https://<project-ref>.supabase.co`                         |
   | `SUPABASE_KEY` | the **service_role** key (Supabase → Settings → API keys)    |

   Then **attach** both secrets to the notebook (toggle next to each).
5. Why service_role? RLS is enabled on `jobs` with no policies — only the
   service_role key can read/write the queue. The anon/public key gets
   401/403.
6. Never print the secrets. `worker.py` reads them via `UserSecretsClient`
   and never logs their values; error messages are scrubbed of the key before
   being stored.

## 2. Running the worker

1. Paste the full content of `worker.py` into a single cell (or upload the
   file via File → Import) and run that cell.
2. First run: pip-installs `transformers accelerate scipy requests` (once)
   and downloads the MusicGen model (a few GB — give it a few minutes).
3. Watch the heartbeat log lines:
   - idle: `[2026-10-18T12:00:00Z] idle | gpu=Tesla T4 | pending=0`
   - active: `[2026-10-18T12:01:30Z] job=<uuid> type=music | gpu=Tesla T4 | stage=generating chunk 3/9`
4. Keep the session running while you expect jobs. For a persistent
   background run use **Save & Run All (Commit)**. GPU quota is roughly
   **30 hours/week** — STOP the session when you are done.

## 3. Duration directive

Put `[duration=120]` (integer seconds) anywhere in the job prompt:

- clamped to 1–180 seconds; a missing directive means 180 s (3 minutes, the max)
- the directive is stripped from the text sent to the model
- example: `dreamy bengali folk instrumentation with sitar [duration=45]`

## 4. Models

- Primary: `facebook/musicgen-medium`, loaded in float16 on the GPU.
- On CUDA out-of-memory the worker automatically falls back — once per job —
  to `facebook/musicgen-small` (reloaded from scratch, fp16). If that also
  OOMs the job is marked failed; resubmit with a smaller `[duration=` value.

## 5. Chunking & continuation

Long tracks are generated in ~20-second chunks (max 9 chunks = 3 minutes):

- chunk 1 is generated from the text prompt only
- later chunks are continuations: the last 10 generated seconds are fed back
  in as audio prompt together with the text prompt
- the 10-second overlap is dropped when concatenating, so the total length is
  preserved
- small audible transitions between chunks are possible — that is inherent to
  chunked MusicGen continuation

## 6. Limitations (read this once)

- **Instrumental-style music/audio ONLY.** No guaranteed vocals, no Bengali
  lyrics, do not expect understandable singing.
- Maximum duration 3 minutes.
- Uploads go to the **public** `outputs` bucket. The result URL is unguessable
  (it contains the UUID job id), but anyone with the link can play the file.
- If the Kaggle session dies mid-job, the row stays `running`. The app treats
  running jobs older than 90 minutes as failed — restart the worker and
  resubmit the job.
- `type='video'` jobs are NOT implemented: they fail immediately with the
  exact error `video worker not implemented yet` (phase-2 scaffold inside
  `worker.py`).

## 7. Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `kaggle_secrets is unavailable` / `Required Kaggle secret(s) missing or empty` | Add both secrets under Add-ons → Secrets (labels exactly `SUPABASE_URL` / `SUPABASE_KEY`) and **attach** them to this notebook |
| Supabase 401 / 403 | Wrong key — it must be the **service_role** key, not the anon/public key |
| CUDA out of memory | Automatic fallback to `facebook/musicgen-small` happens by itself; if BOTH models OOM the job fails — retry with a smaller `[duration=` |
| No jobs picked up | Check the app actually queued a job and the heartbeat shows `pending>0`; confirm the secrets point at the right Supabase project |
| Worker stopped (session ended) | Restart the cell; stuck `running` rows are swept to failed by the app after 90 minutes — resubmit |
