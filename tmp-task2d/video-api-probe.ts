// SDK ভিডিও-জেনারেশন API অন্বেষণ — নতুন মাস্টার প্ল্যান §৪-এর ভিত্তি-পরীক্ষা
// চালাও: cd /home/z/my-project && bun tmp-task2d/video-api-probe.ts
import ZAI from 'z-ai-web-dev-sdk';

const zai = await ZAI.create();
const t0 = Date.now();

async function trySubmit(label: string, body: Record<string, unknown>) {
  try {
    const res = await zai.video.generations.create(body as any);
    console.log(`[${label}] সফল:`, JSON.stringify(res));
    return res;
  } catch (err: any) {
    console.log(`[${label}] ব্যর্থ:`, String(err?.message ?? err).slice(0, 500));
    return null;
  }
}

// ধাপ ১: ন্যূনতম প্যারামিটার দিয়ে সাবমিট
let res =
  (await trySubmit('minimal+duration', {
    prompt: 'A fluffy orange cat slowly walking across a warm sunlit wooden floor, gentle camera dolly, cinematic, soft light through window',
    duration: 5,
  })) ??
  (await trySubmit('with-size-fps', {
    prompt: 'A fluffy orange cat slowly walking across a warm sunlit wooden floor, gentle camera dolly, cinematic',
    size: '1280x720',
    fps: 24,
    duration: 5,
    quality: 'speed',
    with_audio: false,
    watermark_enabled: false,
  })) ??
  (await trySubmit('quality-mode', {
    prompt: 'A fluffy orange cat slowly walking across a warm sunlit wooden floor, cinematic',
    quality: 'speed',
  }));

if (!res?.id) {
  console.log('কোনো সাবমিট সফল হয়নি');
  process.exit(1);
}
const taskId = res.id as string;
console.log('taskId:', taskId, '| অবস্থা:', (res as any).task_status);

// ধাপ ২: অ্যাসিঙ্ক ফলাফল পোল
for (let i = 0; i < 90; i++) {
  await new Promise(r => setTimeout(r, 5000));
  let q: any;
  try {
    q = await zai.async.result.query(taskId);
  } catch (err: any) {
    console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] পোল-ত্রুটি:`, String(err?.message ?? err).slice(0, 200));
    continue;
  }
  console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] অবস্থা: ${q.task_status}`);
  if (q.task_status === 'SUCCESS') {
    console.log('সম্পূর্ণ প্রতিক্রিয়া:', JSON.stringify(q, null, 2).slice(0, 3000));
    const url = q.video_result?.[0]?.url || q.video_url || q.url || q.video;
    if (typeof url === 'string' && url) {
      const r = await fetch(url);
      const buf = Buffer.from(await r.arrayBuffer());
      console.log('ডাউনলোড:', buf.length, 'বাইট | ম্যাজিক:', buf.slice(0, 16).toString('hex'), '| ct:', r.headers.get('content-type'));
    }
    break;
  }
  if (q.task_status === 'FAIL') {
    console.log('FAIL প্রতিক্রিয়া:', JSON.stringify(q, null, 2).slice(0, 2000));
    break;
  }
}
console.log(`মোট সময়: ${((Date.now() - t0) / 1000).toFixed(0)}s`);
