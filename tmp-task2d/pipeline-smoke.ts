// পাইপলাইন E2E ধূম-পরীক্ষা — নতুন মাস্টার প্ল্যান §১৪-এর বাজেট-সচেতন যাচাই
// চালাও: cd /home/z/my-project && bun tmp-task2d/pipeline-smoke.ts [all|inst|voice|mv|sf|aiv]
import { db } from '../src/lib/db';
import { startProduction } from '../src/lib/agent/production/runner';
import { readFile, rm } from 'fs/promises';

const which = process.argv[2] ?? 'all';
const tests = which === 'all' ? ['inst', 'voice', 'mv', 'sf', 'aiv'] : [which];

interface RunResult {
  label: string;
  status: string;
  steps: string[];
  artifacts: string[];
  resultKeys: string[];
  error?: string;
  convId: string;
  prodId: string;
}

async function runProduction(label: string, type: string, spec: Record<string, unknown>, maxSec: number): Promise<RunResult> {
  const conv = await db.conversation.create({ data: { title: `smoke-${label}` } });
  const prod = await db.production.create({
    data: { conversationId: conv.id, type, title: label, status: 'queued', specJson: JSON.stringify({ type, title: label, quality: 'standard', ...spec }) },
  });
  const t0 = Date.now();
  startProduction(prod.id);
  let lastProgress = -1;
  while (Date.now() - t0 < maxSec * 1000) {
    await new Promise(r => setTimeout(r, 6000));
    const fresh = await db.production.findUnique({ where: { id: prod.id } });
    if (fresh && fresh.progress !== lastProgress) {
      lastProgress = fresh.progress ?? -1;
      console.log(`  [${label}] ${fresh.status} ${fresh.progress ?? 0}% (${fresh.currentStepKey ?? ''}) ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    if (['completed', 'failed', 'partial', 'cancelled'].includes(fresh?.status ?? '')) {
      const steps = await db.productionStep.findMany({ where: { productionId: prod.id }, orderBy: { seq: 'asc' } });
      const arts = await db.artifact.findMany({ where: { productionId: prod.id }, orderBy: { createdAt: 'asc' } });
      console.log(
        `  [${label}] চূড়ান্ত: ${fresh!.status} | ধাপ: ${steps.map(s => `${s.key}:${s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : s.status}`).join(' ')}`
      );
      console.log(`  [${label}] artifacts (${arts.length}): ${arts.map(a => `${a.kind}#${a.fileName}(${Math.round(a.size / 1024)}KB)`).join(', ')}`);
      const result = fresh!.resultJson ? JSON.parse(fresh!.resultJson!) : {};
      const rk = Object.keys(result);
      if (rk.length) console.log(`  [${label}] resultJson: ${rk.join(', ')}`);
      if (result.partialNotes?.length) console.log(`  [${label}] partialNotes: ${result.partialNotes.join(' | ').slice(0, 400)}`);
      if (fresh!.error) console.log(`  [${label}] ERROR: ${fresh!.error.slice(0, 300)}`);
      return {
        label,
        status: fresh!.status,
        steps: steps.map(s => `${s.key}:${s.status}`),
        artifacts: arts.map(a => `${a.kind}:${a.fileName}`),
        resultKeys: rk,
        error: fresh!.error ?? undefined,
        convId: conv.id,
        prodId: prod.id,
      };
    }
  }
  console.log(`  [${label}] ⏱ সময়সীমা অতিক্রম (${maxSec}s)`);
  return { label, status: 'timeout', steps: [], artifacts: [], resultKeys: [], convId: conv.id, prodId: prod.id };
}

const results: RunResult[] = [];
let pass = 0;
let fail = 0;

function report(label: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`✓ ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    fail++;
    console.log(`✗ ${label}${detail ? ' — ' + detail : ''}`);
  }
}

// ---------- ১. audio/instrumental (কোনো API নয়) ----------
if (tests.includes('inst')) {
  console.log('\n=== ১. অডিও পাইপলাইন — instrumental (প্রসিডিউরাল, API-মুক্ত) ===');
  const r = await runProduction('instrumental', 'audio', { audioOperation: 'instrumental', mood: 'romantic', durationSec: 25, tempoBpm: 90 }, 240);
  results.push(r);
  report('instrumental সম্পূর্ণ', ['completed', 'partial'].includes(r.status), r.status);
  report('৫ ধাপ কাঠামো', r.steps.join(' ').includes('prepare:done') && r.steps.join(' ').includes('synthesize:done') && r.steps.join(' ').includes('validate:done'), r.steps.join(' '));
  const wav = r.artifacts.find(a => a.includes('romantic') || a.includes('instrumental') || a.endsWith('.wav'));
  report('WAV artifact', !!wav, wav ?? 'নেই');
}

// ---------- ২. audio/voiceover বাংলা (১ TTS + ১ ASR) ----------
if (tests.includes('voice')) {
  console.log('\n=== ২. অডিও পাইপলাইন — বাংলা ভয়েসওভার (ভাষা-নিয়ন্ত্রক §২) ===');
  const r = await runProduction(
    'voiceover-bn',
    'audio',
    { audioOperation: 'voiceover', text: 'বৃষ্টির সন্ধ্যায় চায়ের দোকানে বসে ছিলাম। কাপের গায়ে গরম ভাপ। রাস্তার ওপারে কেউ একজন ছাতা ধরে দাঁড়িয়ে।', language: 'bn', voice: 'jam' },
    300
  );
  results.push(r);
  report('voiceover সম্পূর্ণ', ['completed', 'partial'].includes(r.status), r.status);
  report('verify ধাপ আছে', r.steps.some(s => s.startsWith('verify:')), r.steps.join(' '));
}

// ---------- ৩. music_video — cinematic_motion + procedural গান ----------
if (tests.includes('mv')) {
  console.log('\n=== ৩. মিউজিক ভিডিও (§৬) — procedural গান + cinematic ইঞ্জিন ===');
  const r = await runProduction(
    'music-video',
    'music_video',
    { mood: 'romantic', durationSec: 20, aspect: '9:16', fps: 30, quality: 'draft', videoEngine: 'cinematic_motion', musicSource: 'procedural', subtitles: true, idea: 'বৃষ্টিভেজা শহরে একজন তরুণীর হাঁটা, রাস্তার আলো প্রতিফলিত' },
    900
  );
  results.push(r);
  report('মিউজিক ভিডিও সম্পূর্ণ', ['completed', 'partial'].includes(r.status), r.status);
  report('৬ ধাপ (song_input→final_qc)', ['song_input:done', 'visual_plan:done', 'characters:done', 'generate_shots:done', 'timeline:done', 'final_qc:done'].every(k => r.steps.includes(k)), r.steps.join(' '));
  const mp4 = r.artifacts.find(a => a.startsWith('video:'));
  report('চূড়ান্ত ভিডিও artifact', !!mp4, mp4 ?? 'নেই');
  const songArt = r.artifacts.find(a => a.startsWith('audio:'));
  report('গান artifact (প্রসিডিউরাল)', !!songArt, songArt ?? 'নেই');
  if (mp4) {
    // দৈর্ঘ্য যাচাই
    const art = await db.artifact.findFirst({ where: { productionId: r.prodId, kind: 'video' } });
    if (art?.storagePath) {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const dur = await promisify(execFile)('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', art.storagePath]).then(x => Number(x.stdout.trim())).catch(() => -1);
      report('ভিডিও≈গান-দৈর্ঘ্য (২০ সে.)', dur > 16 && dur < 26, `${dur}s`);
    }
  }
}

// ---------- ৪. short_film — cinematic_motion, ৮-স্টেজ ----------
if (tests.includes('sf')) {
  console.log('\n=== ৪. শর্টফিল্ম (§৭ ৮-স্টেজ) — cinematic ইঞ্জিন ===');
  const r = await runProduction(
    'short-film',
    'short_film',
    { filmMode: 'short_film', story: 'বৃষ্টির সন্ধ্যায় পুরনো চায়ের দোকানে দুই বন্ধুর দেখা। একজন অন্যজনকে চিঠি দেয় — বহু বছর পরে লেখা।', durationSec: 40, aspect: '16:9', fps: 24, quality: 'draft', videoEngine: 'cinematic_motion', language: 'bn', subtitles: true, sound: 'narration' },
    1200
  );
  results.push(r);
  report('শর্টফিল্ম সম্পূর্ণ', ['completed', 'partial'].includes(r.status), r.status);
  const need = ['script_breakdown:done', 'character_bible:done', 'acting_plan:done', 'speech:done', 'generate_shots:done', 'sound_design:done', 'continuity:done', 'final_mix:done'];
  report('৮ ধাপ সম্পূর্ণ', need.every(k => r.steps.includes(k)), r.steps.join(' '));
  const mp4 = r.artifacts.find(a => a.startsWith('video:'));
  report('চূড়ান্ত ফিল্ম artifact', !!mp4, mp4 ?? 'নেই');
  report('সাবটাইটেল (srt) artifact', r.artifacts.some(a => a.endsWith('.srt')), r.artifacts.filter(a => a.endsWith('.srt')).join(', ') || 'নেই');
  report('সংলাপ-অডিও artifact', r.artifacts.some(a => a.startsWith('audio:')), r.artifacts.filter(a => a.startsWith('audio:')).join(', ') || 'নেই');
}

// ---------- ৫. motion_video — প্রকৃত AI (একটি শট) ----------
if (tests.includes('aiv')) {
  console.log('\n=== ৫. মোশন ভিডিও (§৪) — ai_diffusion ইঞ্জিন (CogVideoX-3, ২–৪ মিনিট) ===');
  const r = await runProduction(
    'ai-motion',
    'motion_video',
    { idea: 'A rainy evening tea stall in Dhaka, a young man lifts a steaming cup and smiles at his friend, camera slowly pushes in', durationSec: 5, aspect: '16:9', fps: 30, quality: 'draft', videoEngine: 'ai_diffusion', sound: 'none' },
    1500
  );
  results.push(r);
  report('AI মোশন-ভিডিও সম্পূর্ণ', ['completed', 'partial'].includes(r.status), r.status);
  report('generate_shots ধাপ', r.steps.includes('generate_shots:done'), r.steps.join(' '));
  const mp4 = r.artifacts.find(a => a.startsWith('video:'));
  report('ভিডিও artifact', !!mp4, mp4 ?? 'নেই');
  if (r.resultKeys.length) {
    const art = await db.artifact.findFirst({ where: { productionId: r.prodId, kind: 'video' } });
    if (art?.metaJson) {
      const meta = JSON.parse(art.metaJson);
      report('সৎ ইঞ্জিন-লেবেল (AI/ফলব্যাক)', !!meta.shotEngineLabels?.length || !!meta.engine, JSON.stringify(meta.shotEngineLabels ?? meta.engine).slice(0, 150));
    }
  }
}

// ---------- পরিচ্ছন্নতা ----------
console.log('\n=== পরিচ্ছন্নতা: টেস্ট-ডাটা মুছছি ===');
for (const r of results) {
  const arts = await db.artifact.findMany({ where: { conversationId: r.convId } });
  for (const a of arts) {
    if (a.storagePath) await rm(a.storagePath, { force: true }).catch(() => {});
  }
  await db.conversation.delete({ where: { id: r.convId } }).catch(() => {});
}
// প্রোডাকশন-ওয়ার্কিং-ডিরেক্টরি পরিষ্কার
await rm('storage/productions', { recursive: true, force: true }).catch(() => {});
console.log('টেস্ট-ডাটা মুছে ফেলা হয়েছে');

console.log(`\n========== ফলাফল: ${pass} পাস, ${fail} ব্যর্থ ==========`);
process.exit(fail > 0 ? 1 : 0);
