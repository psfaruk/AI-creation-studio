// Sprint-2 probe (নতুন মাস্টার প্ল্যান §৪ + §৭.১):
//  A) SDK-র images.search.create মেথড কাজ করে কি না (এখন CLI ব্যবহৃত হয়)
//  B) video.generations.create + with_audio:true → আসল অডিও-স্ট্রিম আসে কি না
//  C) request_id (idempotency key) গ্রহণ করে কি না
// ফলাফল JSON হিসেবে stdout-এ — registry-র lastTestedAt ডেটায় বসবে।
import ZAI from 'z-ai-web-dev-sdk';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const zai = await ZAI.create();
  const out: Record<string, unknown> = { startedAt: new Date().toISOString() };

  // ---------- Probe A: images.search.create (SDK) ----------
  try {
    const t0 = Date.now();
    const r = await zai.images.search.create({ query: 'sunset over river', count: 3, gl: 'us', rank: false } as any);
    out.imageSearchSdk = {
      ok: true,
      latencyMs: Date.now() - t0,
      success: (r as any)?.success,
      count: Array.isArray((r as any)?.results) ? (r as any).results.length : 0,
      sample: Array.isArray((r as any)?.results) ? (r as any).results.slice(0, 2).map((x: any) => ({ url: String(x?.original_url ?? '').slice(0, 90), caption: x?.caption })) : [],
    };
  } catch (err: any) {
    out.imageSearchSdk = { ok: false, error: String(err?.message ?? err).slice(0, 300) };
  }

  // ---------- Probe B+C: t2v with_audio + request_id ----------
  const requestId = `probe-audio-${Date.now()}`;
  let taskId = '';
  try {
    const t0 = Date.now();
    // ৪২৯-এ ধৈর্যশীল সাবমিট (৬০ সে. ব্যাকঅফ × ৫)
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const res = await zai.video.generations.create({
          prompt: 'Gentle rain falling on a quiet riverside at dusk, ripples on water, soft ambient sound of rain',
          duration: 5,
          quality: 'speed',
          with_audio: true,
          watermark_enabled: false,
          request_id: requestId,
        } as any);
        taskId = String((res as any)?.id ?? '');
        out.videoSubmit = { ok: taskId.length > 0, taskId, requestIdEcho: (res as any)?.request_id, latencyMs: Date.now() - t0, attempt };
        break;
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (attempt === 5) throw new Error(`সাবমিট ব্যর্থ: ${msg.slice(0, 200)}`);
        if (!/429|Too many|\b5\d{2}\b|timeout/i.test(msg)) throw err;
        console.error(`[submit 429/5xx] attempt ${attempt}: ${msg.slice(0, 120)} — 60s ব্যাকঅফ`);
        await sleep(60_000);
      }
    }
  } catch (err: any) {
    out.videoSubmit = { ok: false, error: String(err?.message ?? err).slice(0, 300) };
  }

  if (taskId) {
    // পোল — সর্বোচ্চ ৭ মিনিট
    const t0 = Date.now();
    let url = '';
    let statusLog: string[] = [];
    while (Date.now() - t0 < 7 * 60_000) {
      await sleep(8_000);
      try {
        const q: any = await zai.async.result.query(taskId);
        const st = String(q?.task_status ?? '');
        statusLog.push(st);
        if (st === 'SUCCESS') {
          url = q.video_result?.[0]?.url ?? q.video_url ?? q.url ?? q.video ?? '';
          out.videoResult = { status: 'SUCCESS', hasUrl: !!url, pollMs: Date.now() - t0, coverUrl: q.video_result?.[0]?.cover_image_url ?? null };
          break;
        }
        if (st === 'FAIL') { out.videoResult = { status: 'FAIL', raw: JSON.stringify(q).slice(0, 300) }; break; }
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (!/429|Too many|timeout/i.test(msg)) { out.videoResult = { status: 'POLL_ERROR', error: msg.slice(0, 200) }; break; }
      }
    }
    if (!out.videoResult) out.videoResult = { status: 'TIMEOUT', statuses: statusLog.slice(-6) };

    if (url) {
      try {
        const res = await fetch(url);
        const buf = Buffer.from(await res.arrayBuffer());
        const tmp = await mkdtemp(path.join(os.tmpdir(), 'probe-av-'));
        try {
          const f = path.join(tmp, 'clip.mp4');
          await writeFile(f, buf);
          const { stdout } = await execFileAsync(
            'ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', f], { timeout: 20_000 }
          );
          const j = JSON.parse(stdout);
          const v = (j.streams ?? []).find((s: any) => s.codec_type === 'video');
          const a = (j.streams ?? []).find((s: any) => s.codec_type === 'audio');
          out.videoValidation = {
            bytes: buf.length,
            durationSec: Number(j.format?.duration ?? 0),
            video: v ? `${v.width}x${v.height}@${v.avg_frame_rate} ${v.codec_name}` : null,
            audioStream: a ? { codec: a.codec_name, sampleRate: a.sample_rate, channels: a.channels } : null,
            hasAudio: !!a,
          };
        } finally { await rm(tmp, { recursive: true, force: true }).catch(() => {}); }
      } catch (err: any) {
        out.videoValidation = { ok: false, error: String(err?.message ?? err).slice(0, 200) };
      }
    }
  }

  out.finishedAt = new Date().toISOString();
  console.log('===PROBE-RESULT===');
  console.log(JSON.stringify(out, null, 2));
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
