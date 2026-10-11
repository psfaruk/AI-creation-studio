// অডিও ভাষা-সমর্থন প্রোব — নতুন মাস্টার প্ল্যান §২ (Audio Language Controller)-এর ভিত্তি
// প্রতিটি কণ্ঠে বাংলা + ইংরেজি TTS → ASR ব্যাক-চেক → স্ক্রিপ্ট-ভিত্তিক ভাষা-শনাক্তকরণ
// চালাও: cd /home/z/my-project && bun tmp-task2d/audio-language-probe.ts
import ZAI from 'z-ai-web-dev-sdk';

const zai = await ZAI.create();

const VOICES = ['tongtong', 'chuichui', 'xiaochen', 'jam', 'kazi', 'douji', 'luodo'] as const;
const BN_TEXT = 'আমি আজ সকালে চায়ের দোকানে বসেছিলাম। বাইরে তখন বৃষ্টি পড়ছিল।';
const EN_TEXT = 'I sat down at a small tea stall this morning. It was raining outside.';

/** স্ক্রিপ্ট-ভিত্তিক ভাষা-শনাক্তকরণ: বাংলা/ল্যাটিন/চীনা অক্ষরের অনুপাত */
function scriptRatio(text: string): { bn: number; latin: number; cjk: number; other: number } {
  const t = text ?? '';
  const bn = (t.match(/[\u0980-\u09FF]/g) ?? []).length;
  const latin = (t.match(/[A-Za-z]/g) ?? []).length;
  const cjk = (t.match(/[\u4E00-\u9FFF]/g) ?? []).length;
  const other = Math.max(0, t.replace(/[\s\d\p{P}]/gu, '').length - bn - latin - cjk);
  const total = bn + latin + cjk + other || 1;
  return {
    bn: +(bn / total).toFixed(2),
    latin: +(latin / total).toFixed(2),
    cjk: +(cjk / total).toFixed(2),
    other: +(other / total).toFixed(2),
  };
}

async function probe(voice: string, text: string, label: string) {
  const t0 = Date.now();
  try {
    const res = await zai.audio.tts.create({
      input: text,
      voice,
      speed: 1,
      response_format: 'wav',
      stream: false,
    });
    const buf = Buffer.from(new Uint8Array(await res.arrayBuffer()));
    const isRiff = buf.slice(0, 4).toString('ascii') === 'RIFF';
    let asrText = '';
    try {
      const asr = await zai.audio.asr.create({ file_base64: buf.toString('base64') });
      asrText = String((asr as any)?.text ?? '').trim();
    } catch (e: any) {
      asrText = `(ASR ব্যর্থ: ${String(e?.message ?? e).slice(0, 80)})`;
    }
    const ratio = scriptRatio(asrText);
    console.log(
      `[${label}] কণ্ঠ=${voice} | ${((Date.now() - t0) / 1000).toFixed(1)}s | ${buf.length}B | RIFF=${isRiff} | ASR="${asrText.slice(0, 90)}" | স্ক্রিপ্ট-অনুপাত bn=${ratio.bn} la=${ratio.latin} cjk=${ratio.cjk}`
    );
  } catch (err: any) {
    console.log(`[${label}] কণ্ঠ=${voice} | TTS ব্যর্থ: ${String(err?.message ?? err).slice(0, 140)}`);
  }
}

// প্রতিটি কণ্ঠে বাংলা
console.log('===== বাংলা পাঠ =====');
for (const v of VOICES) {
  await probe(v, BN_TEXT, 'বাংলা');
}
// ইংরেজি মাত্র ৩ কণ্ঠে (সময় বাঁচাতে)
console.log('===== ইংরেজি পাঠ =====');
for (const v of ['tongtong', 'jam', 'kazi'] as const) {
  await probe(v, EN_TEXT, 'ইংরেজি');
}
console.log('সম্পূর্ণ');
