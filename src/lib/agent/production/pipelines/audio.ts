// ============================================================
// Audio pipeline — মাস্টার প্ল্যান §২-সম্পূর্ণ।
// প্রকারভেদে চারটি পথ:
//   - voiceover (ডিফল্ট): স্ক্রিপ্ট → ভাষা-শনাক্তকরণ (detectLanguage) →
//     ভাষা-নিয়ন্ত্রক দিয়ে কণ্ঠ (প্রথম খণ্ড synthesizeVerifiedSpeech —
//     ASR ব্যাক-চেকসহ; বাকিগুলো সরল TTS) → verify ধাপে সৎ রায়-রিপোর্ট →
//     মাস্টারিং (concat + loudnorm −১৬ LUFS) → যাচাই → wav+mp3 artifact
//   - instrumental (নতুন, §৩): synthesizeInstrumental (প্রসিডিউরাল) →
//     validateInstrumental → WAV+MP3 artifact (বিট/সেকশন/সৎ-লেবেলসহ)
//   - music_plan: plan_music-এর যুক্তি ইনলাইনে টেক্সট-দলিল artifact
//   - process: আপলোড করা উৎস-অডিও মাস্টারিং ও যাচাই
// ধাপ-key (voiceover/instrumental): prepare → synthesize → verify →
// master → validate। ব্যর্থ অংশ partialNotes-এ — বাকিগুলো দিয়েই এগোয়।
// ============================================================

import path from 'path';
import { readFile, writeFile } from 'fs/promises';
import type { VoicePreset } from '@/lib/types';
import { db } from '@/lib/db';
import { runFfmpeg, mediaInfo, audioQuality } from '@/lib/media/ffmpeg';
import type { PipelineContext, PipelineFn, PipelineResult, StepHandle } from '../runner';
// (P0-BUG-01 fix #3: খণ্ড ২+ সহ সব TTS-কল synthesizeVerifiedSpeech-এর
// ইঞ্জিন-ফলব্যাক-চেইনেদ্বারা হয় — সরাসরি একক-ইঞ্জিন কল আর নেই)
import { isEdgeVoice } from '../../audio/edge_tts';
import {
  synthesizeVerifiedSpeech,
  detectLanguage,
  resolveVoice,
  verdictLabel,
  languageStatusLabel,
  type SpeechVerification,
  type SpeechLanguage,
} from '../../audio/language_controller';
import {
  synthesizeInstrumental,
  validateInstrumental,
  detectMoodFromText,
  moodLabel,
  type MusicMood,
} from '../../audio/music_engine';
import { planMusicContent, chunkScriptForTts, toBn, fmtDb, slugifyTitle, measureLoudnessPrecise } from '../../tools/audio';

// ------------------------------------------------------------
// শেয়ার্ড মাস্টারিং + যাচাই
// ------------------------------------------------------------

/** অংশগুলো জোড়া (প্রয়োজনে) → loudnorm (-16 LUFS) → master.wav + master.mp3 */
async function buildMaster(
  step: StepHandle,
  files: string[],
  workingDir: string
): Promise<{ masterWav: string; masterMp3: string; durationSec: number }> {
  await step.setDetail(`${toBn(files.length)}টি অংশ জোড়া ও loudnorm নরমালাইজেশন (−১৬ LUFS)`);
  const masterWav = path.join(workingDir, 'master.wav');
  const masterMp3 = path.join(workingDir, 'master.mp3');

  const inputs: string[] = [];
  for (const f of files) inputs.push('-i', f);
  const AF = 'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo';
  let filter: string;
  if (files.length === 1) {
    filter = `[0:a]${AF},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100[aout]`;
  } else {
    const pre = files.map((_, i) => `[${i}:a]${AF}[c${i}]`).join(';');
    const labels = files.map((_, i) => `[c${i}]`).join('');
    filter = `${pre};${labels}concat=n=${files.length}:v=0:a=1[cat];[cat]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100[aout]`;
  }
  await runFfmpeg(
    [...inputs, '-filter_complex', filter, '-map', '[aout]', '-c:a', 'pcm_s16le', masterWav],
    { label: 'মাস্টারিং', timeoutMs: 240_000 }
  );
  await runFfmpeg(['-i', masterWav, '-c:a', 'libmp3lame', '-b:a', '192k', masterMp3], {
    label: 'MP3 এনকোড',
    timeoutMs: 120_000,
  });
  const info = await mediaInfo(masterWav);
  return { masterWav, masterMp3, durationSec: info.durationSec };
}

/**
 * মাস্টার অডিওর গুণমান যাচাই (দৈর্ঘ্য > 0, পিক ≤ −0.1dB, স্যাম্পল-রেট
 * 44100/48000) ও wav+mp3 উভয় artifact নিবন্ধন। রায়ের এক-লাইন ফেরত দেয়।
 */
async function validateAndRegister(
  ctx: PipelineContext,
  masterWav: string,
  masterMp3: string,
  slug: string,
  meta: Record<string, unknown>
): Promise<string> {
  const q = await audioQuality(masterWav);
  if (!(q.durationSec > 0)) {
    throw new Error('মাস্টার অডিওর দৈর্ঘ্য শূন্য এসেছে — এনকোডিং সমস্যা।');
  }
  const clipping = Number.isFinite(q.peakDb) && (q.peakDb as number) > -0.1;
  if (clipping) {
    ctx.partialNotes.push(`ক্লিপিং-ঝুঁকি: পিক ${fmtDb(q.peakDb)} (loudnorm সত্ত্বেও −০.১ ডিবির ওপরে)।`);
  }
  if (q.sampleRate && ![44100, 48000].includes(q.sampleRate)) {
    ctx.partialNotes.push(`স্যাম্পল-রেট ${toBn(q.sampleRate)} Hz — প্রত্যাশিত 44100/48000 নয়।`);
  }

  const wavBuf = await readFile(masterWav);
  const mp3Buf = await readFile(masterMp3);
  const loudnessLufs = (await measureLoudnessPrecise(masterWav)) ?? q.loudnessLufs ?? null;
  await ctx.registerArtifact({
    buffer: wavBuf,
    kind: 'audio',
    mimeType: 'audio/wav',
    fileName: `${slug}.wav`,
    metaJson: {
      ...meta,
      durationSec: q.durationSec,
      loudnessLufs,
      peakDb: Number.isFinite(q.peakDb) ? q.peakDb : null,
      silenceCount: q.silenceRanges.length,
    },
  });
  await ctx.registerArtifact({
    buffer: mp3Buf,
    kind: 'audio',
    mimeType: 'audio/mpeg',
    fileName: `${slug}.mp3`,
    metaJson: { ...meta, durationSec: q.durationSec, bitrate: '192k' },
  });

  if (clipping) return 'ক্লিপিং-ঝুঁকি';
  if (q.silenceRanges.length > 0) return `শোনার যোগ্য, তবে ${toBn(q.silenceRanges.length)}টি নীরব-অংশ আছে`;
  return 'শোনার যোগ্য — কোনো সমস্যা পাওয়া যায়নি';
}

// ------------------------------------------------------------
// পথ ১: ভয়েসওভার (ডিফল্ট) — ভাষা-নিয়ন্ত্রকসহ
// ------------------------------------------------------------

async function runVoiceover(ctx: PipelineContext): Promise<PipelineResult> {
  // --- prepare: স্ক্রিপ্ট খণ্ডবিভাজন + ভাষা-শনাক্তকরণ + কণ্ঠ-নির্বাচন ---
  const prep = await ctx.runStep('prepare', 'স্ক্রিপ্ট প্রস্তুত ও ভাষা-শনাক্তকরণ', async step => {
    let text = (ctx.spec.text ?? '').trim();
    const fallbackNotes: string[] = [];
    if (!text) {
      // কনফিগ-প্যানেলের প্রতিশ্রুত ফলব্যাক (hint: "খালি রাখলে চ্যাট-বার্তা
      // থেকে নেওয়া হয়"): স্পেকে text না থাকলে কথোপকথনের সর্বশেষ
      // ব্যবহারকারী-বার্তা থেকে নেওয়া — create.ts-এর ভাষা-সনাক্তকরণের
      // একই প্যাটার্ন। বার্তাও না থাকলে সৎ-ব্যর্থতা (নীরব-কল্পনা নয়)।
      const lastUserMsg = await db.message.findFirst({
        where: { conversationId: ctx.conversationId, role: 'user' },
        orderBy: { createdAt: 'desc' },
        select: { content: true },
      });
      const fromChat = (lastUserMsg?.content ?? '').trim();
      if (fromChat) {
        text = fromChat;
        fallbackNotes.push(
          `স্পেকে স্ক্রিপ্ট (text) খালি ছিল — চ্যাটের সর্বশেষ ব্যবহারকারী-বার্তা থেকে নেওয়া হলো (কনফিগ-প্যানেলের ঘোষিত নিয়ম)।`
        );
      } else {
        throw new Error(
          'ভয়েসওভার স্ক্রিপ্ট (text) খালি — কণ্ঠ তৈরির জন্য লেখা দরকার (স্পেকে বা চ্যাট-বার্তায় কোনো লেখা পাওয়া যায়নি)।'
        );
      }
    }
    const parts = chunkScriptForTts(text, 950);
    if (parts.length === 0) {
      throw new Error('স্ক্রিপ্ট থেকে উচ্চারণযোগ্য কোনো অংশ পাওয়া যায়নি।');
    }
    // §২ — লেখার অক্ষর-অনুপাত থেকে ভাষা শনাক্তকরণ; অসামঞ্জস্যে স্পষ্ট ব্যাখ্যা
    const SPEECH_LANGUAGE_LABEL: Record<string, string> = {
      bn: 'বাংলা',
      en: 'ইংরেজি',
      hi: 'হিন্দি',
      ur: 'উর্দু',
      zh: 'চীনা',
    };
    const det = detectLanguage(text);
    let language: SpeechLanguage = ctx.spec.language ?? 'bn';
    const notes: string[] = [...fallbackNotes];
    if (det.language === 'other-script') {
      // B-F04-সংশ্লিষ্ট (R-FIX-2): বাংলা/লাতিন বাদে অন্য লিপি (CJK/দেবনাগরী/আরবি…)
      // — ভাষা বদলানো নয় (অন্য ভাষাও নয়); নির্বাচিত ভাষাতেই চেষ্টা হবে এবং
      // নিয়ন্ত্রক অসমঞ্জস্য ধরলে সৎভাবে থামবে। নীরব অনুমান নয়।
      notes.push(
        `ভাষা-শনাক্তকরণ: লেখায় বাংলা/লাতিন বাদে অন্য লিপির অক্ষর (${toBn(Math.round((det.otherScriptRatio ?? 0) * 100))}%) রয়েছে — নির্বাচিত ভাষাতেই (${language === 'bn' ? 'বাংলা' : 'ইংরেজি'}) চেষ্টা হবে; ভাষা-নিয়ন্ত্রক অসমঞ্জস্য ধরলে সৎভাবে থামবে।`
      );
    } else if (det.language === 'hi' || det.language === 'zh') {
      // PART C: হিন্দি/চীনা লিপি স্বীকৃত — নির্বাচিত ভাষা যদি অন্য হয় তবে
      // শনাক্ত ভাষাতেই সৎ ব্যাখ্যাসহ যাওয়া হয় (নীরব বদল নয়)
      if (det.language !== language) {
        notes.push(
          `ভাষা-শনাক্তকরণ: স্ক্রিপ্টটি ${det.language === 'hi' ? 'হিন্দি (দেবনাগরী)' : 'চীনা'} লেখায় ধরা পড়েছে — শনাক্ত ভাষাতেই তৈরি করা হলো (ভুল ভাষায় পড়লে অডিও বোঝা যেত না)।`
        );
        language = det.language;
      }
    } else if (det.language === 'ar-script') {
      // পার্সো-আরবি লিপি — উর্দু বনাম অন্য আরবি-লিপির ভাষা লিপি দেখে নির্ধারণ
      // করা যায় না (B3) — নির্বাচিত ভাষাই বহাল; নিয়ন্ত্রক অসামঞ্জস্য ধরলে থামবে
      if (language !== 'ur') {
        notes.push(
          'ভাষা-শনাক্তকরণ: লেখায় পার্সো-আরবি লিপির অক্ষর রয়েছে — লিপি থেকে উর্দু/অন্য আরবি-লিপির ভাষা আলাদা করা যায় না; নির্বাচিত ভাষাতেই চেষ্টা হবে এবং ভাষা-নিয়ন্ত্রক অসামঞ্জস্য ধরলে সৎভাবে থামবে।'
        );
      }
    } else if (det.language !== 'unknown' && det.language !== 'mixed' && det.language !== language) {
      const detectedLabel =
        det.language === 'bn'
          ? `বাংলা (${toBn(Math.round(det.bnRatio * 100))}% বাংলা অক্ষর)`
          : `ইংরেজি (${toBn(Math.round(det.latinRatio * 100))}% লাতিন অক্ষর)`;
      notes.push(
        `ভাষা-শনাক্তকরণ: স্ক্রিপ্টটি ${detectedLabel} লেখায় ধরা পড়েছে, কিন্তু নির্বাচিত ভাষা ছিল ${language === 'bn' ? 'বাংলা' : 'ইংরেজি'} — শনাক্ত ভাষাতেই তৈরি করা হলো (ভুল ভাষায় পড়লে অডিও বোঝা যেত না)।`
      );
      language = det.language;
    }
    // ভাষা-প্রোফাইল-সচেতন কণ্ঠ (২০২৬-১০-১৩: বাংলায় bn-BD নিউরাল প্রধান)
    const voice = resolveVoice(language, ctx.spec.voice);
    if (ctx.spec.voice && ctx.spec.voice !== voice) {
      notes.push(
        isEdgeVoice(voice)
          ? `কণ্ঠ "${ctx.spec.voice}" বাংলার জন্য উপযুক্ত নয় (বাংলা-অপ্রশিক্ষিত) — বাংলা-প্রশিক্ষিত নিউরাল কণ্ঠ "${voice}" ব্যবহৃত হলো।`
          : `কণ্ঠ "${ctx.spec.voice}" এই ভাষার প্রোফাইলে নেই — প্রোফাইল-ডিফল্ট "${voice}" ব্যবহৃত হলো।`
      );
    }
    await step.setDetail(
      `স্ক্রিপ্ট ${toBn(text.length)} অক্ষর → ${toBn(parts.length)}টি অংশ · ভাষা: ${SPEECH_LANGUAGE_LABEL[language] ?? language} · কণ্ঠ: ${voice}${notes.length ? ` · ${notes[0].slice(0, 80)}…` : ''}`
    );
    return { parts, language, voice, notes };
  });

  // --- synthesize: প্রথম খণ্ড ভাষা-নিয়ন্ত্রকে (ASR যাচাইসহ), বাকিগুলো সরল TTS ---
  const synth = await ctx.runStep('synthesize', 'কণ্ঠ সংশ্লেষণ (ভাষা-নিয়ন্ত্রক)', async step => {
    const files: string[] = [];
    let firstVerification: SpeechVerification | null = null;
    let usedVoice: string = prep.voice;

    // ---- স্পিড-আপ (২০২৬-১০-১৩): খণ্ড ০ ভাষা-নিয়ন্ত্রকে যাচাই-সহ; ----
    // ---- বাকি খণ্ডগুলো ৩-সমান্তরালে সংশ্লেষণ (ধারাবাহিক নয়)       ----
    await step.setDetail(
      `১/${toBn(prep.parts.length)} অংশ — ভাষা-নিয়ন্ত্রকে যাচাই-সহ`
    );
    {
      const text = prep.parts[0];
      await ctx.checkCancelled();
      const out = await synthesizeVerifiedSpeech(
        {
          task: 'speech',
          language: prep.language,
          script: text,
          voiceId: prep.voice,
          outputFormat: 'wav',
          sampleRate: 24000,
          speed: 1,
        },
        { verify: true }
      );
      usedVoice = out.voice;
      firstVerification = out.verification;
      const file = path.join(ctx.workingDir, `chunk-01.${out.ext}`);
      await writeFile(file, out.buffer);
      const info = await mediaInfo(file);
      if (info.durationSec > 0) files.push(file);
      else ctx.partialNotes.push('অংশ ১ ত্রুটিপূর্ণ (দৈর্ঘ্য শূন্য)');
    }
    if (prep.parts.length > 1) {
      await step.setDetail(
        `২–${toBn(prep.parts.length)}/${toBn(prep.parts.length)} অংশ সমান্তরালে সংশ্লেষণ হচ্ছে…`
      );
      const rest = prep.parts.slice(1);
      const CONCURRENCY = 3;
      let next = 0;
      let doneCount = 0;
      const worker = async () => {
        for (;;) {
          const i = next++;
          if (i >= rest.length) return;
          await ctx.checkCancelled();
          const text = rest[i];
          const idx = i + 1;
          try {
            // P0-BUG-01 fix #3: খণ্ড ২+ এখন ফলব্যাক-চেইনসহ (verify:false — খরচ
            // অপরিবর্তিত, কিন্তু একক-ইঞ্জিন ব্যর্থতায় খণ্ড হারায় না)
            const out = await synthesizeVerifiedSpeech(
              {
                task: 'speech',
                language: prep.language,
                script: text,
                voiceId: usedVoice,
                outputFormat: 'wav',
                sampleRate: 24000,
                speed: 1,
              },
              { verify: false }
            );
            const file = path.join(ctx.workingDir, `chunk-${String(idx + 1).padStart(2, '0')}.${out.ext}`);
            await writeFile(file, out.buffer);
            const info = await mediaInfo(file);
            if (info.durationSec > 0) files.push(file);
            else ctx.partialNotes.push(`অংশ ${toBn(idx + 1)} ত্রুটিপূর্ণ (দৈর্ঘ্য শূন্য)`);
          } catch (err) {
            ctx.partialNotes.push(
              `অংশ ${toBn(idx + 1)}/${toBn(prep.parts.length)} সংশ্লেষণ ব্যর্থ: ${String((err as Error)?.message ?? err).slice(0, 160)}`
            );
          }
          doneCount++;
          await step.setDetail(`${toBn(doneCount + 1)}/${toBn(prep.parts.length)} অংশ সম্পন্ন`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rest.length) }, worker));
    }
    if (files.length === 0) {
      throw new Error('কোনো অংশই সংশ্লেষণ করা যায়নি — TTS পরিষেবা সাময়িকভাবে ব্যর্থ মনে হচ্ছে। একটু পরে আবার চেষ্টা করো।');
    }
    if (files.length < prep.parts.length) {
      await step.setDetail(`${toBn(files.length)}/${toBn(prep.parts.length)} অংশ সফল (বাকিগুলো স্কিপ)`);
    }
    return { files, firstVerification, usedVoice };
  });

  // --- verify: প্রথম খণ্ডের ভাষা-যাচাই-রায়ের সৎ রিপোর্ট ---
  const verification = await ctx.runStep('verify', 'ASR ব্যাক-চেক ও ভাষা-রায়', async step => {
    const v = synth.firstVerification;
    if (!v) {
      await step.setDetail('প্রথম খণ্ডের যাচাই-তথ্য পাওয়া যায়নি — প্রিভিউ শুনে নিশ্চিত করুন');
      return null;
    }
    await step.setDetail(
      `রায়: ${verdictLabel(v.verdict)} · ${languageStatusLabel(v.languageStatus)} · সাদৃশ্য ${toBn(Math.round(v.similarity * 100))}% · দৈর্ঘ্য ${toBn(v.durationSec.toFixed(1))}/${toBn(v.expectedSec.toFixed(1))} সে. · ASR-ভাষা: ${v.detectedLanguage}`
    );
    if (v.verdict === 'fail') {
      ctx.partialNotes.push(
        `কণ্ঠ-যাচাই ব্যর্থ (কণ্ঠ ${v.voice}): ${v.notes.slice(0, 2).join(' ')}। অডিও তৈরি হয়েছে, কিন্তু সঠিক পাঠ হয়নি বলে সন্দেহ — প্রিভিউ শুনে নিশ্চিত করুন।`
      );
    }
    return v;
  });

  // --- master: concat + loudnorm → master.wav + master.mp3 ---
  const master = await ctx.runStep('master', 'মাস্টারিং ও নরমালাইজেশন', step =>
    buildMaster(step, synth.files, ctx.workingDir)
  );

  // --- validate: গুণমান যাচাই + উভয় ফরম্যাটে artifact ---
  const verdict = await ctx.runStep('validate', 'গুণমান যাচাই ও রপ্তানি', async () => {
    const slug = slugifyTitle(ctx.spec.title || 'voiceover');
    return validateAndRegister(ctx, master.masterWav, master.masterMp3, slug, {
      pipeline: 'audio/voiceover',
      voice: String(synth.usedVoice),
      language: prep.language,
      chunks: synth.files.length,
      targetDurationSec: ctx.spec.durationSec ?? null,
      verification: verification
        ? {
            verdict: verification.verdict,
            verdictLabel: verdictLabel(verification.verdict),
            languageStatus: verification.languageStatus ?? 'LANGUAGE_UNVERIFIED',
            languageStatusLabel: languageStatusLabel(verification.languageStatus),
            similarity: verification.similarity,
            detectedLanguage: verification.detectedLanguage,
            durationSec: verification.durationSec,
            expectedSec: verification.expectedSec,
            notes: verification.notes,
          }
        : null,
      ...(prep.notes.length > 0 ? { languageNotes: prep.notes } : {}),
    });
  });

  const target = ctx.spec.durationSec ?? null;
  const verdictLine = verification
    ? `${verdict}; ভাষা-যাচাই: ${verdictLabel(verification.verdict)}${
        prep.language === 'bn' && verification.verdict === 'warn'
          ? ' — বাংলা কণ্ঠে ASR ব্যাক-চেক নির্ভরযোগ্য নয়, প্রিভিউ শুনে নিশ্চিত করুন'
          : ''
      }`
    : verdict;
  return {
    result: {
      quality: `${verdictLine}; দৈর্ঘ্য ${toBn(master.durationSec.toFixed(1))} সেকেন্ড${
        target ? ` (লক্ষ্য ${toBn(target)} সে.)` : ''
      }, ${toBn(synth.files.length)}টি অংশ, কণ্ঠ ${synth.usedVoice}, ভাষা ${prep.language === 'bn' ? 'বাংলা' : 'ইংরেজি'}`,
      durationSec: master.durationSec,
      chunks: synth.files.length,
      voice: String(synth.usedVoice),
      language: prep.language,
      verification: verification
        ? {
            verdict: verification.verdict,
            verdictLabel: verdictLabel(verification.verdict),
            languageStatus: verification.languageStatus ?? 'LANGUAGE_UNVERIFIED',
            languageStatusLabel: languageStatusLabel(verification.languageStatus),
            similarity: verification.similarity,
            detectedLanguage: verification.detectedLanguage,
            notes: verification.notes,
          }
        : null,
      notes: prep.notes,
      targetDurationSec: target,
    },
  };
}

// ------------------------------------------------------------
// পথ ২ (নতুন): প্রসিডিউরাল ইনস্ট্রুমেন্টাল (§৩)
// ------------------------------------------------------------

async function runInstrumental(ctx: PipelineContext): Promise<PipelineResult> {
  // --- prepare: মুড-নির্বাচন ---
  const moodInfo = await ctx.runStep('prepare', 'মুড ও স্পেক প্রস্তুত', async step => {
    const direct = typeof ctx.spec.mood === 'string' ? detectMoodFromText(ctx.spec.mood) : null;
    const fromIdea = detectMoodFromText(
      `${ctx.spec.mood ?? ''} ${ctx.spec.idea ?? ''} ${ctx.spec.text ?? ''} ${ctx.spec.title ?? ''}`
    );
    const mood: MusicMood = direct ?? fromIdea ?? 'peaceful';
    const durationSec = Math.max(8, Math.min(120, Math.round(ctx.spec.durationSec ?? 30)));
    await step.setDetail(
      `মুড: ${moodLabel(mood)} (${direct ? 'নির্দেশিত' : fromIdea ? 'লেখা থেকে শনাক্ত' : 'ডিফল্ট'}) · দৈর্ঘ্য ${toBn(durationSec)} সে.${ctx.spec.tempoBpm ? ` · ${toBn(ctx.spec.tempoBpm)} BPM` : ''}${ctx.spec.genre ? ` · ধরন: ${ctx.spec.genre}` : ''}`
    );
    return { mood, durationSec };
  });

  // --- synthesize: প্রসিডিউরাল সংশ্লেষণ ---
  const inst = await ctx.runStep('synthesize', 'প্রসিডিউরাল ইনস্ট্রুমেন্টাল সংশ্লেষণ', async step => {
    await step.setDetail(`${moodLabel(moodInfo.mood)} · সুর-তত্ত্বভিত্তিক PCM সংশ্লেষণ — নিউরাল মিউজিক-মডেল নয়`);
    const res = await synthesizeInstrumental({
      mood: moodInfo.mood,
      durationSec: moodInfo.durationSec,
      tempoBpm: ctx.spec.tempoBpm,
      genre: ctx.spec.genre,
    });
    const wavPath = path.join(ctx.workingDir, 'instrumental.wav');
    await writeFile(wavPath, res.buffer);
    await step.setDetail(
      `${res.meta.durationSec} সে., ${toBn(res.meta.tempoBpm)} BPM, স্কেল ${res.meta.keyLabel}, ${toBn(res.meta.beatsSec.length)}টি বিট-মার্কার, ${toBn(res.meta.sections.length)}টি সেকশন`
    );
    return { res, wavPath };
  });

  // --- verify: ইঞ্জিন-নিজস্ব যাচাই ---
  const check = await ctx.runStep('verify', 'গুণমান যাচাই (ইঞ্জিন-নিজস্ব)', async step => {
    const v = await validateInstrumental(inst.res.buffer, inst.res.meta);
    await step.setDetail(v.ok ? 'যাচাই সম্পন্ন — কোনো সমস্যা নেই' : `সতর্কতা: ${v.issues.join('; ')}`);
    if (!v.ok) {
      v.issues.forEach(i => ctx.partialNotes.push(`ইনস্ট্রুমেন্টাল যাচাই: ${i}`));
    }
    return v;
  });

  // --- master: MP3 এনকোড (ইঞ্জিনের নিজস্ব পিক-নরমালাইজেশন অক্ষুণ্ণ — loudnorm নয়) ---
  const master = await ctx.runStep('master', 'মাস্টার-ফাইল তৈরি (WAV+MP3)', async step => {
    const mp3Path = path.join(ctx.workingDir, 'instrumental.mp3');
    await runFfmpeg(['-i', inst.wavPath, '-c:a', 'libmp3lame', '-b:a', '192k', mp3Path], {
      label: 'MP3 এনকোড',
      timeoutMs: 120_000,
    });
    await step.setDetail('MP3 192k এনকোড সম্পন্ন (loudnorm প্রয়োগ করা হয়নি — ইঞ্জিনের নিজস্ব ডাইনামিক্স অক্ষুণ্ণ)');
    return { wavPath: inst.wavPath, mp3Path };
  });

  // --- validate: উভয় ফরম্যাটে artifact (বিট/সেকশন/সৎ-লেবেলসহ) ---
  const verdict = await ctx.runStep('validate', 'চূড়ান্ত যাচাই ও রপ্তানি', async () => {
    const meta = {
      pipeline: 'audio/instrumental',
      mood: inst.res.meta.mood,
      moodLabel: moodLabel(inst.res.meta.mood),
      tempoBpm: inst.res.meta.tempoBpm,
      keyLabel: inst.res.meta.keyLabel,
      beats: inst.res.meta.beatsSec.length,
      beatMarkersSec: inst.res.meta.beatsSec.slice(0, 200),
      sections: inst.res.meta.sections,
      loudnessLufs: check.loudnessLufs ?? null,
      peakDb: Number.isFinite(check.peakDb ?? NaN) ? check.peakDb : null,
      honestLabel: inst.res.meta.honestLabel,
      mastering: 'ইঞ্জিনের নিজস্ব পিক-নরমালাইজেশন (loudnorm নয়)',
    };
    const slug = slugifyTitle(ctx.spec.title || 'instrumental');
    const wavBuf = await readFile(master.wavPath);
    const mp3Buf = await readFile(master.mp3Path);
    await ctx.registerArtifact({
      buffer: wavBuf,
      kind: 'audio',
      mimeType: 'audio/wav',
      fileName: `${slug}.wav`,
      metaJson: { ...meta, durationSec: check.durationSec },
    });
    await ctx.registerArtifact({
      buffer: mp3Buf,
      kind: 'audio',
      mimeType: 'audio/mpeg',
      fileName: `${slug}.mp3`,
      metaJson: { ...meta, durationSec: check.durationSec, bitrate: '192k' },
    });
    return check.ok
      ? 'যাচাইকৃত — কোনো সমস্যা পাওয়া যায়নি'
      : `কার্যকর, তবে সতর্কতা: ${check.issues.join('; ')}`;
  });

  return {
    result: {
      quality: `${verdict}। ${moodLabel(inst.res.meta.mood)} মুড, ${toBn(inst.res.meta.tempoBpm)} BPM, স্কেল ${inst.res.meta.keyLabel}, ${toBn(check.durationSec.toFixed(1))} সেকেন্ড, ${toBn(inst.res.meta.beatsSec.length)}টি বিট-মার্কার, ${toBn(inst.res.meta.sections.length)}টি সেকশন। (পদ্ধতি: ${inst.res.meta.honestLabel})`,
      mood: inst.res.meta.mood,
      moodLabel: moodLabel(inst.res.meta.mood),
      tempoBpm: inst.res.meta.tempoBpm,
      keyLabel: inst.res.meta.keyLabel,
      durationSec: check.durationSec,
      beats: inst.res.meta.beatsSec.length,
      sections: inst.res.meta.sections.length,
      loudnessLufs: check.loudnessLufs ?? null,
      honestLabel: inst.res.meta.honestLabel,
      // §২-C সৎ ইঞ্জিন-চিহ্ন — UI-ব্যাজ (🎹 লোকাল ইন্সট্রুমেন্টাল)
      musicEngine: 'procedural_instrumental',
    },
  };
}

// ------------------------------------------------------------
// পথ ৩: গানের কাঠামো-পরিকল্পনা (music_plan)
// ------------------------------------------------------------

async function runMusicPlan(ctx: PipelineContext): Promise<PipelineResult> {
  const idea = (ctx.spec.text ?? ctx.spec.idea ?? '').trim();

  await ctx.runStep('prepare', 'ভাবনা বিশ্লেষণ', async step => {
    if (!idea) {
      throw new Error('গানের আইডিয়া খালি — text বা idea ক্ষেত্রে কিছু লেখা দরকার।');
    }
    await step.setDetail(`আইডিয়া: ${idea.length > 120 ? idea.slice(0, 119) + '…' : idea}`);
  });

  const plan = await ctx.runStep('plan', 'গানের কাঠামো ও লিরিক্স পরিকল্পনা', async step => {
    await step.setDetail('কাঠামো, লিরিক্স ও বাদ্যযন্ত্র-নির্দেশনা তৈরি হচ্ছে');
    const { plan: musicPlan, document } = await planMusicContent(idea, {
      durationSec: ctx.spec.durationSec,
      // চ্যাটের ভাষাতেই গান — spec.language (create.ts-এ স্বয়ংক্রিয়-নির্ধারিত)
      language: ctx.spec.language === 'en' ? 'en' : 'bn',
    });
    await ctx.registerArtifact({
      buffer: Buffer.from(document, 'utf-8'),
      kind: 'text',
      mimeType: 'text/plain',
      fileName: 'song-plan.txt',
      metaJson: {
        pipeline: 'audio/music_plan',
        planTitle: musicPlan.title,
        sections: musicPlan.songSections.length,
        tempoBpm: musicPlan.tempoBpm,
        key: musicPlan.key,
      },
    });
    return musicPlan;
  });

  return {
    result: {
      quality: `গানের কাঠামো-পরিকল্পনা তৈরি: ${plan.title} — ${toBn(plan.songSections.length)}টি সেকশন, ${toBn(
        plan.tempoBpm
      )} BPM, স্কেল ${plan.key}`,
      title: plan.title,
      tempoBpm: plan.tempoBpm,
      key: plan.key,
      sections: plan.songSections.length,
    },
  };
}

// ------------------------------------------------------------
// পথ ৪: উৎস-অডিও মাস্টারিং (process)
// ------------------------------------------------------------

async function runProcess(ctx: PipelineContext): Promise<PipelineResult> {
  const ids = ctx.spec.sourceAudioArtifactIds ?? [];

  const files = await ctx.runStep('prepare', 'উৎস-অডিও প্রস্তুত', async step => {
    if (ids.length === 0) {
      throw new Error('process কাজে sourceAudioArtifactIds-এ অন্তত একটি অডিও artifact আইডি দরকার।');
    }
    const files: string[] = [];
    for (const [i, id] of ids.entries()) {
      const p = await ctx.resolveArtifactFile(id);
      const info = await mediaInfo(p);
      if (!info.hasAudio) {
        throw new Error(`${toBn(i + 1)} নম্বর উৎস-ফাইলে কোনো অডিও স্ট্রিম নেই।`);
      }
      files.push(p);
    }
    await step.setDetail(`${toBn(files.length)}টি উৎস-অডিও যাচাই সম্পন্ন`);
    return files;
  });

  const master = await ctx.runStep('master', 'মাস্টারিং ও নরমালাইজেশন', step =>
    buildMaster(step, files, ctx.workingDir)
  );

  const verdict = await ctx.runStep('validate', 'গুণমান যাচাই ও রপ্তানি', async () => {
    const slug = slugifyTitle(ctx.spec.title || 'audio-master');
    return validateAndRegister(ctx, master.masterWav, master.masterMp3, slug, {
      pipeline: 'audio/process',
      sources: files.length,
      sourceArtifactIds: ids,
    });
  });

  return {
    result: {
      quality: `${verdict}; দৈর্ঘ্য ${toBn(master.durationSec.toFixed(1))} সেকেন্ড, ${toBn(
        files.length
      )}টি উৎস-ফাইল মাস্টার করা হয়েছে`,
      durationSec: master.durationSec,
      sources: files.length,
    },
  };
}

// ------------------------------------------------------------
// প্রবেশদ্বার — audioOperation অনুযায়ী পথ-নির্বাচন
// ------------------------------------------------------------

export const audioPipeline: PipelineFn = async ctx => {
  const op = ctx.spec.audioOperation ?? 'voiceover';
  if (op === 'music_plan') return runMusicPlan(ctx);
  if (op === 'process') return runProcess(ctx);
  if (op === 'instrumental') return runInstrumental(ctx);
  return runVoiceover(ctx);
};
