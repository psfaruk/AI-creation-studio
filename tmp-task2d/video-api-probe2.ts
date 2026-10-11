// প্রোব ২: (ক) image-to-video data URL সমর্থন, (খ) সমান্তরাল ভিডিও-টাস্ক,
// (গ) ইংরেজি TTS→ASR রাউন্ড-ট্রিপ যাচাই (jam কণ্ঠ)
// চালাও: cd /home/z/my-project && bun tmp-task2d/video-api-probe2.ts
import ZAI from 'z-ai-web-dev-sdk';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFileCb);

const zai = await ZAI.create();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ১. ছোট পরীক্ষা-ছবি তৈরি (লাল বৃত্ত — ffmpeg testsrc দিয়ে ২ সেকেন্ডে)
await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=0x225522:s=768x768:d=1', '-frames:v', '1', '/tmp/probe-img.png']);
const { readFile } = await import('fs/promises');
const imgBuf = await readFile('/tmp/probe-img.png');
const dataUrl = `data:image/png;base64,${imgBuf.toString('base64')}`;
console.log('ছবি:', imgBuf.length, 'বাইট → data URL দৈর্ঘ্য:', dataUrl.length);

// ২. image-to-video সাবমিট (data URL দিয়ে)
console.log('\n=== image-to-video (data URL) ===');
let i2vId: string | null = null;
try {
  const res = await zai.video.generations.create({
    prompt: 'A subtle slow zoom with gentle light shifting on the scene',
    image_url: dataUrl,
    duration: 5,
    quality: 'speed',
  } as any);
  console.log('সাবমিট সফল:', JSON.stringify(res).slice(0, 300));
  i2vId = (res as any).id ?? null;
} catch (err: any) {
  console.log('data URL ব্যর্থ:', String(err?.message ?? err).slice(0, 400));
}

// ৩. সমান্তরাল টাস্ক-পরীক্ষা: আরেকটি t2v একসাথে সাবমিট
console.log('\n=== সমান্তরাল t2v ===');
let parId: string | null = null;
try {
  const res = await zai.video.generations.create({
    prompt: 'Waves rolling on a misty river at dawn, slow cinematic pan',
    duration: 5,
  });
  parId = (res as any).id ?? null;
  console.log('সমান্তরাল সাবমিট সফল:', parId);
} catch (err: any) {
  console.log('সমান্তরাল সাবমিট ব্যর্থ:', String(err?.message ?? err).slice(0, 300));
}

// ৪. ইংরেজি রাউন্ড-ট্রিপ: jam কণ্ঠে ইংরেজি → ASR
console.log('\n=== ইংরেজি রাউন্ড-ট্রিপ (jam) ===');
await sleep(4000);
try {
  const EN_TEXT = 'I sat down at a small tea stall this morning. It was raining outside.';
  const res = await zai.audio.tts.create({ input: EN_TEXT, voice: 'jam', speed: 1, response_format: 'wav', stream: false });
  const buf = Buffer.from(new Uint8Array(await res.arrayBuffer()));
  await sleep(3500);
  let asr = '';
  try {
    const r = await zai.audio.asr.create({ file_base64: buf.toString('base64') });
    asr = String((r as any)?.text ?? '').trim();
  } catch (e: any) {
    asr = `(ASR ব্যর্থ: ${String(e?.message ?? e).slice(0, 100)})`;
  }
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', 'pipe:0'], { input: undefined }).catch(() => ({ stdout: '' }) as any);
  // দৈর্ঘ্য মাপি — ফাইলে লিখে
  const { writeFile } = await import('fs/promises');
  await writeFile('/tmp/probe-en.wav', buf);
  const dur = await execFileAsync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', '/tmp/probe-en.wav']).then(r => r.stdout.trim()).catch(() => '?');
  console.log(`jam ইংরেজি: ${buf.length}B | দৈর্ঘ্য=${dur}s | ASR="${asr}"`);
  console.log(`মূল লেখা: "${'I sat down at a small tea stall this morning. It was raining outside.'}"`);
} catch (err: any) {
  console.log('jam ইংরেজি TTS ব্যর্থ:', String(err?.message ?? err).slice(0, 200));
}

// ৫. ভিডিও টাস্কগুলোর ফলাফল পোল
const t0 = Date.now();
const tasks: { label: string; id: string }[] = [];
if (i2vId) tasks.push({ label: 'i2v-dataURL', id: i2vId });
if (parId) tasks.push({ label: 'parallel-t2v', id: parId });
for (const t of tasks) {
  for (let i = 0; i < 80; i++) {
    await sleep(6000);
    try {
      const q = await zai.async.result.query(t.id);
      if (q.task_status === 'SUCCESS') {
        const url = (q as any).video_result?.[0]?.url ?? (q as any).video_url ?? (q as any).url;
        const bytes = url ? (await fetch(url).then(r => r.arrayBuffer()).then(b => b.byteLength).catch(() => -1)) : -1;
        console.log(`[${t.label}] SUCCESS ${((Date.now() - t0) / 1000).toFixed(0)}s | url? ${!!url} | bytes=${bytes}`);
        break;
      }
      if (q.task_status === 'FAIL') {
        console.log(`[${t.label}] FAIL:`, JSON.stringify(q).slice(0, 300));
        break;
      }
    } catch (err: any) {
      console.log(`[${t.label}] পোল-ত্রুটি:`, String(err?.message ?? err).slice(0, 120));
    }
  }
}
console.log('সম্পূর্ণ', ((Date.now() - t0) / 1000).toFixed(0) + 's');
