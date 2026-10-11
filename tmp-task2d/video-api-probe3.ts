// প্রোব ৩: ধৈর্যশীল — (ক) i2v data URL সমর্থন, (খ) size প্যারামিটার, (গ) duration সীমা
// ৪২৯-এ ৪৫ সেকেন্ড অপেক্ষা করে পুনঃচেষ্টা
// চালাও: cd /home/z/my-project && bun tmp-task2d/video-api-probe3.ts
import ZAI from 'z-ai-web-dev-sdk';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile } from 'fs/promises';
const execFileAsync = promisify(execFileCb);

const zai = await ZAI.create();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function submitWithRetry(label: string, body: Record<string, unknown>, maxAttempts = 6) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await zai.video.generations.create(body as any);
      console.log(`[${label}] সাবমিট সফল (চেষ্টা ${i + 1}):`, JSON.stringify(res).slice(0, 250));
      return res as any;
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (/429|Too many/i.test(msg)) {
        console.log(`[${label}] 429 — ৪৫ সে. অপেক্ষা (চেষ্টা ${i + 1}/${maxAttempts})`);
        await sleep(45000);
        continue;
      }
      console.log(`[${label}] ব্যর্থ (৪২৯ নয়):`, msg.slice(0, 350));
      return null;
    }
  }
  console.log(`[${label}] সব চেষ্টা শেষ`);
  return null;
}

// পরীক্ষা-ছবি
await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=768x768:d=1', '-frames:v', '1', '/tmp/probe3-img.png']);
const imgBuf = await readFile('/tmp/probe3-img.png');
const dataUrl = `data:image/png;base64,${imgBuf.toString('base64')}`;
console.log('ছবি প্রস্তুত:', imgBuf.length, 'বাইট');

// ধাপ ১: i2v data URL
const i2v = await submitWithRetry('i2v-dataURL', {
  prompt: 'The scene comes alive with subtle motion and shifting light',
  image_url: dataUrl,
  duration: 5,
  quality: 'speed',
});

// ধাপ ২: ৯০ সে. পরে size সহ t2v (পোর্ট্রেট)
await sleep(90000);
const t2vSize = await submitWithRetry('t2v-size-720x1280', {
  prompt: 'A lantern festival at night, lanterns rising, vertical composition',
  size: '720x1280',
  duration: 5,
});

// ধাপ ৩: duration ১০ সে. (সীমা পরীক্ষা)
await sleep(90000);
const t2v10 = await submitWithRetry('t2v-duration-10', {
  prompt: 'A slow pan across a quiet village road in the morning mist',
  duration: 10,
});

// পোল-ফেজ
const tasks: { label: string; id: string }[] = [];
if (i2v?.id) tasks.push({ label: 'i2v-dataURL', id: i2v.id });
if (t2vSize?.id) tasks.push({ label: 't2v-720x1280', id: t2vSize.id });
if (t2v10?.id) tasks.push({ label: 't2v-10s', id: t2v10.id });
const t0 = Date.now();
for (const t of tasks) {
  let done = false;
  for (let i = 0; i < 90 && !done; i++) {
    await sleep(7000);
    try {
      const q: any = await zai.async.result.query(t.id);
      if (q.task_status === 'SUCCESS') {
        const url = q.video_result?.[0]?.url ?? q.video_url ?? q.url;
        let meta = '';
        if (url) {
          const r = await fetch(url);
          const buf = Buffer.from(await r.arrayBuffer());
          const f = `/tmp/probe3-${t.label}.mp4`;
          await writeFile(f, buf);
          const info = await execFileAsync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', f]).then(r => JSON.parse(r.stdout)).catch(() => null);
          const v = info?.streams?.find((s: any) => s.codec_type === 'video');
          const a = info?.streams?.find((s: any) => s.codec_type === 'audio');
          meta = `${buf.length}B | ${info?.format?.duration}s | ${v?.width}x${v?.height}@${v?.avg_frame_rate} | codec=${v?.codec_name} | অডিও=${a ? a.codec_name + '@' + a.sample_rate : 'নেই'}`;
        }
        console.log(`[${t.label}] ✓ SUCCESS ${((Date.now() - t0) / 1000).toFixed(0)}s | ${meta}`);
        done = true;
      } else if (q.task_status === 'FAIL') {
        console.log(`[${t.label}] ✗ FAIL:`, JSON.stringify(q).slice(0, 250));
        done = true;
      }
    } catch (err: any) {
      if (!/429/i.test(String(err?.message ?? err))) {
        console.log(`[${t.label}] পোল-ত্রুটি:`, String(err?.message ?? err).slice(0, 120));
      }
    }
  }
  if (!done) console.log(`[${t.label}] সময়শেষ — ফলাফল আসেনি`);
  await sleep(30000);
}
console.log('সম্পূর্ণ', ((Date.now() - t0) / 1000).toFixed(0) + 's');
