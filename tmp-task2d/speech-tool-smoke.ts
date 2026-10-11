// speech_synthesis টুল E2E — §২.৩ acceptance test:
// (ক) বাংলা স্ক্রিপ্ট → বাংলা TTS (রায় সহ), (খ) ইংরেজি → ইংরেজি TTS,
// (গ) ভাষা-মিল-এরর সৎ পথ, (ঘ) analyze_audio টুল
import { db } from '../src/lib/db';
import { AUDIO_TOOLS } from '../src/lib/agent/tools/audio';

function getTool(name: string) {
  const t = AUDIO_TOOLS.find(x => x.name === name);
  if (!t) throw new Error(`টুল নেই: ${name}`);
  return t;
}

const conv = await db.conversation.create({ data: { title: 'speech-smoke' } });
const run = await db.agentRun.create({ data: { conversationId: conv.id, status: 'running' } });
const ctx = { conversationId: conv.id, runId: run.id, toolCallId: 'test' };
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = '') => { if (ok) { pass++; } else { fail++; } console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`); };

try {
  console.log('=== ১. বাংলা কণ্ঠ (ভাষা-নিশ্চিত) ===');
  const t1 = getTool('speech_synthesis');
  const out1 = await t1.execute({ script: 'বৃষ্টির রাতে পুরনো দিনের কথা মনে পড়ে। চায়ের কাপে ভাব জমে থাকে।', language: 'bn' }, ctx);
  console.log('  সারাংশ:', out1.summary.slice(0, 220));
  const r1 = JSON.parse(out1.resultJson);
  check('বাংলা artifact তৈরি', out1.artifacts?.length === 1);
  check('রায় সতর্কতা (ASR-সীমাবদ্ধতা সৎভাবে)', r1.verdict === 'warn', `রায়=${r1.verdict}, ASR-ভাষা=${r1.detectedLanguage}`);
  check('ASR ব্যাক-চেক হয়েছে', typeof r1.transcript === 'string' && r1.transcript.length >= 0);
  check('notes সৎ', Array.isArray(r1.notes) && r1.notes.length > 0);

  console.log('=== ২. ইংরেজি কণ্ঠ (রাউন্ড-ট্রিপ যাচাই) ===');
  const out2 = await t1.execute({ script: 'The rain brings back old memories tonight.', language: 'en', voice: 'jam' }, ctx);
  console.log('  সারাংশ:', out2.summary.slice(0, 220));
  const r2 = JSON.parse(out2.resultJson);
  check('ইংরেজি artifact', out2.artifacts?.length === 1);
  check('রায় (pass/warn)', r2.verdict === 'pass' || r2.verdict === 'warn', `রায়=${r2.verdict}, সাদৃশ্য=${r2.similarity}, ASR="${String(r2.transcript).slice(0, 60)}"`);

  console.log('=== ৩. ভাষা-অসামঞ্জস্যে সৎ ত্রুটি ===');
  let mismatchErr = '';
  try {
    await t1.execute({ script: 'আমি বাংলা লেখা', language: 'en' }, ctx);
  } catch (e: any) {
    mismatchErr = String(e.message);
  }
  check('অসামঞ্জস্যে স্পষ্ট ব্যাখ্যা', mismatchErr.includes('অসামঞ্জস্য') || mismatchErr.includes('ভাষার'), mismatchErr.slice(0, 120));

  console.log('=== ৪. স্বয়ংক্রিয় ভাষা-শনাক্তকরণ (language ছাড়া) ===');
  const out4 = await t1.execute({ script: 'I am fine today, thank you for asking.' }, ctx);
  const r4 = JSON.parse(out4.resultJson);
  check('ইংরেজি স্বয়ংক্রিয় শনাক্ত', r4.language === 'en', `ভাষা=${r4.language}`);

  console.log('=== ৫. analyze_audio টুল ===');
  const artifactId = out1.artifacts![0].id;
  const t5 = getTool('analyze_audio');
  const out5 = await t5.execute({ audio: artifactId }, ctx);
  const r5 = JSON.parse(out5.resultJson);
  check('বিট-বিশ্লেষণ ফলাফল', r5.durationSec > 3 && Array.isArray(r5.beatsSec), `দৈর্ঘ্য=${r5.durationSec}s, বিট=${r5.beatsSec?.length}`);
  check('সৎ লেবেল', String(r5.honestLabel).includes('সরলীকৃত'));
} finally {
  // পরিচ্ছন্নতা
  const arts = await db.artifact.findMany({ where: { conversationId: conv.id } });
  for (const a of arts) if (a.storagePath) await (await import('fs/promises')).rm(a.storagePath, { force: true }).catch(() => {});
  await db.conversation.delete({ where: { id: conv.id } }).catch(() => {});
  console.log('টেস্ট-ডাটা পরিষ্কার');
}
console.log(`ফলাফল: ${pass} পাস, ${fail} ব্যর্থ`);
process.exit(fail > 0 ? 1 : 0);
