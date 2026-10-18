# Phase 1 — FFmpeg Runtime Requirements for the Railway Image

**Task ID:** 1-c · **Scope:** capability inventory (code-verified) → runtime-image spec → verification checklist
**Builds on:** Phase 0 report §5 (Dockerfile), §7 B-D4 ("ffmpeg missing from any default runtime image")
**Nothing has been deployed** — all "verified" claims below refer to the sandbox environment or to code greps, never to Railway.

> কোডবেসে ffmpeg কোথায় কী কাজে লাগে — সেই ইনভেন্টরি থেকে রানটাইম-ইমেজের ন্যূনতম ক্ষমতা-সেট বের করা হয়েছে। ডিপ্লয় হয়নি — সব রেফারেন্স মান স্যান্ডবক্সের।

---

## 1. Invocation map (who calls ffmpeg, and how)

| Site | Mechanism | Notes |
|---|---|---|
| `src/lib/media/ffmpeg.ts` | **Central wrapper** | `runFfmpeg()` (execFileAsync; when called inside `runWithFfmpegTracking` it `spawn()`s so children are killable per-production — cancellation), `ffprobeJson()`, `mediaInfo()`, `audioQuality()` (3 direct execFileAsync calls: astats / silencedetect / ebur128), `measureLoudness()`, `normalizeLoudnessTwoPass()` |
| 9 files call `runFfmpeg()` | 36 call-sites total | `tools/video.ts` (9), `film-helpers.ts` (8), `tools/audio.ts` (4), `pipelines/audio.ts` (3), `pipelines/{short_film,music_video,motion_video}.ts` (2 ea.), `audio/sound_design.ts` (2), `ffmpeg.ts` itself (4) |
| `src/lib/system-info.ts:37,43,228` | Direct `execFileAsync('ffmpeg'/'ffprobe')` | Runtime capability probes: `ffmpeg -version`, `ffprobe -version`, `ffmpeg -filters` (feeds the model-registry hardware report) |
| `src/lib/agent/local-frames.ts:413` | Direct `execFileAsync('ffmpeg', args)` | Procedural 8-layer fallback frame generator (filter_complex only) |
| `src/lib/agent/audio/music_engine.ts:1164` | Direct ffmpeg | Reads raw PCM back (`-f s16le -ar 16000 -ac 1`) for energy analysis |
| `src/lib/agent/sdk-helpers.ts:226` | runFfmpeg-style args | ASR preprocessing: `-f segment -segment_time 28` chunking of long audio |

**Conclusion:** any process that runs the production pipelines needs ffmpeg+ffprobe on `PATH`. In the Phase 0 §3 target that is **both** the web service (single-service start) and the future worker service — the image spec below applies to whichever image executes `src/lib/agent/production/*` or the chat tools (`tools/video.ts`, `tools/audio.ts`).

---

## 2. Capability inventory — feature → where → why

### 2.1 Encoders / muxers / demuxers

| Capability | Where (file) | Why |
|---|---|---|
| **libx264** H.264 encode (`-preset fast`, `-crf 20/21`, `-pix_fmt yuv420p`) | `tools/video.ts` (7 sites), `film-helpers.ts` (160,216,235,245,403), `pipelines/motion_video.ts` (213,631), `pipelines/music_video.ts` (694,755) | Every final/normalized video output; subtitle burn-in re-encode |
| **native AAC** encode (`-b:a 128k/160k`) | `tools/video.ts` (300,409,433,593,651,661), `film-helpers.ts:381` (muxAudio), `pipelines/music_video.ts:756` | Audio in MP4 outputs |
| **libmp3lame** MP3 encode (192k) | `tools/audio.ts:610,835`, `pipelines/audio.ts:72,448` | TTS/instrumental MP3 deliverables |
| **pcm_s16le** WAV encode (44.1 kHz) | `ffmpeg.ts:451` (loudnorm apply), `tools/audio.ts:836,975`, `pipelines/audio.ts:69`, `pipelines/short_film.ts:2115`, `sound_design.ts:642`, `film-helpers.ts:263,355` | Master WAV mixes, dialogue/narration layers |
| WAV/PCM + **MP3 decode** (Google-TTS returns MP3; Edge-TTS MP3; AI-video MP4 inputs) | `tts-cache.ts` chain, `pipelines/audio.ts`, `film-helpers.ts` mix inputs | Mixed-source audio pipelines |
| Raw **s16le** demux input | `music_engine.ts:1164` | PCM energy analysis of procedural music |
| **concat demuxer** (`-f concat -safe 0 -i list`) | `film-helpers.ts:245`, `tools/video.ts`, `pipelines/{music_video,audio}.ts` | Shot/timeline assembly |
| **concat filter** (`concat=n=2:v=1:a=1`) + `anullsrc` silent pad | `tools/video.ts` (5 chain sites) | Video+audio joining with silence padding |
| **segment muxer** (`-f segment -segment_time 28`) | `sdk-helpers.ts:226` | ASR input chunking (28-s segments) |
| **image2 input** (PNG/JPEG; `-loop 1` still-image video) | `film-helpers.ts` (`-loop 1`), pipelines (storyboard frames), `local-frames.ts` (writes PNG frames) | Image→video segments, frame-based cinema fallback |
| **lavfi sources**: `anullsrc`, `color=`, `gradients=` | `tools/video.ts`, `film-helpers.ts`, `local-frames.ts` (gradients source ×4) | Silent audio, solid/procedural backgrounds |
| `null` muxer (analysis passes) | `ffmpeg.ts` (astats/silencedetect/ebur128/loudnorm/vidstabdetect passes), `tools/video.ts` | Measurement-only runs |

### 2.2 Video filters

| Filter | Where | Why |
|---|---|---|
| `subtitles=…:force_style='FontName=Noto Sans Bengali,…'` (**libass**) | `film-helpers.ts:402` `burnSubtitles()` — the **only** burn site; `tools/video.ts` `generate_subtitles` only *creates* SRT text | Bengali subtitle burn-in (short_film / music_video). **drawtext is NOT used** (0 grep matches) |
| `scale=`, `fps=`, `crop=`, `format=yuv420p` | `tools/video.ts` (scale ×4, fps ×4, crop ×4), `film-helpers.ts`, pipelines | Normalization to target geometry/fps |
| `fade` (in/out), `xfade` (transition=fade) | `film-helpers.ts` (xfade ×4, fade ×11), `tools/video.ts` | Cinematic transitions |
| `eq=`, `unsharp`, `hqdn3d` | `tools/video.ts:743,747,750` (enhance_video) | Brightness/saturation/contrast, sharpen, denoise |
| `vidstabdetect` + `vidstabtransform` (2-pass) | `tools/video.ts:758+` (enhance_video stabilize) | Stabilization — **requires a libvidstab-enabled ffmpeg build** |
| `minterpolate` (fps interpolation) | `tools/video.ts` (mldiff/aobmc) | Slow-motion / fps conversion |
| `blend` (screen/multiply/softlight), `noise`, `gblur`, `geq`, `lutrgb`, `threshold`, `gradients=` source, `format=rgb24` | `local-frames.ts` (8-layer procedural frame) | Cloud-image 429 fallback — deterministic local frames |

### 2.3 Audio filters

`loudnorm` (2-pass EBU R128, `ffmpeg.ts:384–466` + `tools/audio.ts` + `pipelines/audio.ts`), `ebur128=peak=true` (loudness measurement), `astats`, `silencedetect` (−45 dB, 1.2 s), `aformat`, `aresample`, `volume=`, `adelay` (all=1), `afade`, `apad`, `amix` (normalize=0), `alimiter`, `asplit`, `sidechaincompress` (ducking), `lowpass`, `aecho`, `atrim`, `asetpts`.
(`acrossfade` — **not used**; 0 grep matches. The earlier Phase 0 diagram mention of "mix/loudness" is covered by the above.)

---

## 3. Required capability set for the runtime image (derived)

1. ffmpeg built with: **libx264**, **libmp3lame**, **libass** (subtitles filter), **libvidstab** (vidstabdetect/vidstabtransform), native **aac**; all filters above are long-standard core filters.
2. Decoders: H.264/AAC (MP4 in), MP3, WAV/PCM s16le, PNG/JPEG (image2).
3. Muxers/demuxers: mp4, concat, segment, image2, s16le, null; lavfi sources anullsrc/color/gradients.
4. **A Bengali font reachable by fontconfig** (`Noto Sans Bengali` — see §7 finding) for libass `force_style` **and** for the SVG brand-text rendered by `sharp` in `tools/image.ts:200–210`.

## 4. Runtime image recommendation (Railway, Phase 2)

```dockerfile
# runtime stage (planned; final Dockerfile is Phase 2 deliverable, owner-gated)
FROM node:22-slim            # Debian bookworm-slim base; trixie-slim equally valid
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg fonts-noto-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*
```

- **Why Debian's ffmpeg:** the Debian package is built `--enable-libx264 --enable-libmp3lame --enable-libass --enable-libvidstab` (configuration string recorded from the sandbox binary below) — i.e. every capability in §3 in one install. Alpine's ffmpeg **does not** ship libvidstab → alpine images would break `enhance_video stabilize` (unverified claim about today's Alpine; avoid by using Debian).
- **Measured size (sandbox, Debian 13):** `ffmpeg` 2.7 MB + libavcodec 16.6 MB + libavfilter 14.2 MB + libavformat 3.0 MB + x264 1.9 MB + mp3lame/ass/vidstab/fontconfig/freetype/harfbuzz/fribidi chain ≈ **51 MB installed** (dpkg Installed-Size sum) — modest for a Hobby-plan image.
- `fonts-noto-core` adds the Noto script families (intended to include Noto Sans Bengali — **to be verified in the built image with `fc-list :lang=bn`**, see §7).
- ffprobe ships in the same package (`ffmpeg` depends on it) — the code calls both.
- Image must ship for **web and (future) worker** alike (see §1).

## 5. Reference versions (sandbox, the environment all 266 tests + live E2E ran against)

```
$ ffmpeg -version | head -3
ffmpeg version 7.1.5-0+deb13u1 Copyright (c) 2000-2026 the FFmpeg developers
built with gcc 14 (Debian 14.2.0-19)
configuration: … --enable-gpl --enable-libass --enable-libmp3lame --enable-libvidstab --enable-libx264 … (Debian 13/trixie package)

$ ffprobe -version | head -2
ffprobe version 7.1.5-0+deb13u1 Copyright (c) 2007-2026 the FFmpeg developers
built with gcc 14 (Debian 14.2.0-19)

$ ffmpeg -encoders 2>/dev/null | grep -E 'libx264|aac'
 V....D libx264    libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 A....D aac        AAC (Advanced Audio Coding)          (+ libmp3lame, pcm_s16le also present)
```
Filter presence check: 27/27 required filters **OK** in this build (vidstabdetect, vidstabtransform, subtitles, loudnorm, ebur128, astats, silencedetect, gradients, geq, gblur, lutrgb, threshold, noise, blend, xfade, amix, adelay, afade, apad, aformat, aresample, sidechaincompress, alimiter, anullsrc, acrossfade(present/unused), drawtext(present/unused)).
OS: Debian GNU/Linux 13 (trixie); binaries at `/usr/bin/{ffmpeg,ffprobe}`.

These are the **reference versions the code is tested against** (version-dependent behavior is already handled in code: `ffmpeg.ts:345–351` parses the ffmpeg-7.x "True peak:" summary layout). A different major version in the image is *planned to work* but is **to be verified** by the §6 checklist — pinning the Debian release in `FROM` keeps this deterministic.

## 6. Post-deploy verification checklist (run in the deployed container, Phase 2)

1. `ffmpeg -version` → starts with `ffmpeg version 7.x` (or the chosen pin); `ffprobe -version` likewise.
2. `ffmpeg -encoders | grep -E 'libx264|aac|libmp3lame'` → 3 lines.
3. `ffmpeg -hide_banner -filters | grep -E 'vidstab|subtitles|loudnorm'` → present.
4. `fc-list :lang=bn` → at least one Bengali-capable family (target: Noto Sans Bengali).
5. **Smoke encode** (mirrors pipeline operations: lavfi video+audio in → libx264+aac MP4 out). Executed in the sandbox at doc-writing time — **exit code 0**, 18,974-byte MP4, ffprobe `format_name "mov,mp4,…"`, duration 1.000000 s:
   ```
   ffmpeg -hide_banner -y -f lavfi -i testsrc=duration=1:size=320x240:rate=30 \
          -f lavfi -i sine=frequency=440:duration=1 \
          -c:v libx264 -c:a aac -t 1 -f mp4 /tmp/studio-smoke.mp4 ; echo $?
   → EXIT_CODE=0
   ```
6. App-level: hit `/api/hardware` (runs the `system-info.ts` probes) and confirm `ffmpegVersion`/`ffprobeVersion` are non-null in the response.
7. One real production of each type (image/audio/motion_video) on the staging URL before trusting the image (Phase 5 flow).

## 7. Finding the main agent should know (honest, new)

- **"Noto Sans Bengali" is NOT installed in the current sandbox.** `fc-list :lang=bn` returns only FreeSans/FreeSerif/Unifont. The code assumes the font (`film-helpers.ts` comment "system-installed"; `force_style FontName=Noto Sans Bengali`; `tools/image.ts` SVG `font-family="Noto Sans Bengali"`), so today's renders fall back to a fontconfig default — Bengali glyphs still render (FreeSans covers Bengali) but **typographic quality of burned subtitles/SVG text is unverified**. The tests never assert glyph shapes. The deployed image should install `fonts-noto-core` (or bundle the TTF with the app) and re-verify with `fc-list`. No code change needed unless the fallback proves visually unacceptable — flag for Phase 4/5 human review.

---

## Appendix — Evidence (grep commands + counts, run at doc-writing time)

```
rg "execFileAsync\(['\"](ffmpeg|ffprobe)" src/  → 4 matches: system-info.ts:37,43,228; local-frames.ts:413
rg -c 'runFfmpeg\(' src/                        → 9 files, 36 call-sites (video 9, film-helpers 8, ffmpeg.ts 4, tools/audio 4, pipelines/audio 3, short_film/music_video/motion_video/sound_design 2 ea.)
rg 'runWithFfmpegTracking' src/                 → callers: runner.ts (wraps pipeline execution)
rg 'libx264' src/     → 20 sites (tools/video, film-helpers, pipelines/{motion_video,music_video})
rg "'-c:a', 'aac'"    → 11 sites;  rg 'libmp3lame' → 5;  rg 'pcm_s16le' → 11
rg 'drawtext' src/    → 0 matches (subtitles/libass is the burn path, film-helpers.ts:402 only)
rg 'subtitles=' src/  → 1 filter site (film-helpers.ts:402); other "subtitles" hits are SRT text/spec fields
rg 'acrossfade' src/  → 0 matches
rg "'-f', 'segment'"  → 1 (sdk-helpers.ts:226);  "'-f', 'concat'" → 3 files;  "'-loop', '1'" → 1 (film-helpers.ts)
per-filter counts (top): subtitles 33*, loudnorm 27, ebur128 17, amix 11, afade 11, xfade 10, adelay 8, aformat 10, vidstabdetect/transform 1 each, gradients= 4, geq/gblur/lutrgb/threshold/noise present (local-frames)
  * includes non-filter text occurrences (spec fields/UI labels)
ffmpeg -version / ffprobe -version / -encoders / -filters: output recorded in §5 (sandbox, Debian 13, ffmpeg 7.1.5-0+deb13u1)
Smoke encode in /tmp: EXIT_CODE=0 (output: 18,974-byte MP4, ffprobe-verified format+duration)
dpkg Installed-Size sum of ffmpeg+libav+x264+mp3lame+ass+vidstab+font stack ≈ 51 MB
fc-list :lang=bn → 8 entries (FreeSans, FreeSerif, Unifont families) — no Noto Sans Bengali (§7)
```

— END OF PHASE 1 FFMPEG RUNTIME REQUIREMENTS —
