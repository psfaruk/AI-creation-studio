// ============================================================
// Voiceover chunk synthesizer — Phase-3 Workstream A
//
// motion_video-এর ভয়েসওভার-লুপের নির্যোগ্য/পরীক্ষাযোগ্য রূপ:
// প্রতিটি টেক্সট-খণ্ড synthesizeVerifiedSpeech-এর **শেয়ার্ড**
// ফলব্যাক-চেইন দিয়ে সংশ্লেষিত হয় (Phase-2 REG-1 চুক্তি):
//   - প্রথম কণ্ঠ ব্যর্থ → পূর্ণ প্রোফাইল-চেইন (bn ৫ / en ৭ কণ্ঠ)
//   - ইঞ্জিন-সচেতন স্কিপ: এক ইঞ্জিন হার্ড-ফেল করলে (যেমন Edge-403)
//     সেই ইঞ্জিনের বাকি কণ্ঠ নষ্ট কল ছাড়াই বাদ
//   - ASR-খরচ অপরিবর্তিত (verify:false — আগের আচরণের মতোই)
//   - সব ইঞ্জিন মৃত → সৎ ব্যর্থতা-বার্তা; খণ্ড বাদ, ভিডিও বাঁচে
//
// এই মডিউলটি ইচ্ছাকৃতভাবে হালকা রাখা হয়েছে: কোনো SDK/db/pipeline
// ইম্পোর্ট নেই — শুধু ভাষা-নিয়ন্ত্রক + ffmpeg-প্রোব। ফলে রিগ্রেশন টেস্ট
// (REG-8) সরাসরি ইম্পোর্ট করে ইঞ্জিন-সীমানা মক করে পুরো চেইন চালাতে
// পারে (t1-এর একই বিচ্ছিন্নতা-চুক্তি)।
//
// ২০২৬-১০-১৫ পর্যন্ত ইতিহাস: motion_video.ts:645 ছিল P0-BUG-01-এর
// শেষ বাদ-পড়া কল-সাইট — একক-কণ্ঠের cachedSynthesizeSpeech সরাসরি কল;
// এক ইঞ্জিন অচল হলে সব খণ্ড একইভাবে ব্যর্থ হয়ে হারাত (Phase-2
// ওয়ার্কলগে follow-up নোট হিসেবে চিহ্নিত)।
// ============================================================

import { writeFile } from 'fs/promises';
import path from 'path';
import { mediaInfo } from '@/lib/media/ffmpeg';
import {
  synthesizeVerifiedSpeech,
  type SpeechLanguage,
  type SpeechVoice,
} from '../../audio/language_controller';

/** সফল খণ্ড — mixAudioTracks-এর {file, startSec}-চুক্তির সাথে সামঞ্জস্যপূর্ণ */
export interface VoiceoverChunk {
  /** workingDir-এ লেখা ফাইল */
  file: string;
  /** টাইমলাইনে শুরু-মুহূর্ত (সে.) */
  startSec: number;
  /** যে কণ্ঠ আসলে সংশ্লেষণ করেছে (ফলব্যাক হলে অনুরোধকৃতটি নয়) */
  voice: string;
  /** শেয়ার্ড চেইনে কতটি কণ্ঠ চেষ্টা হয়েছে (1 = প্রাথমিক কণ্ঠই সফল) */
  attempts: number;
  /** সৎ নোট (ইঞ্জিন-ফলব্যাক/টেক্সট-নর্মালাইজেশন) — verbatim */
  notes: string[];
}

export interface VoiceoverOutcome {
  /** সফল খণ্ডগুলো ক্রমানুসারে (startSec-সহ টাইমলাইন-প্রস্তুত) */
  chunks: VoiceoverChunk[];
  /** সৎ ব্যর্থতা-নোট (প্রতি-খণ্ড; সব ইঞ্জিন মরে গেলে তবেই খণ্ড বাদ) */
  failures: string[];
  /** ব্যবহারকারীর অনুরোধকৃত কণ্ঠ (voiceId দেওয়া হয়নি তো null) */
  requestedVoice: string | null;
  language: SpeechLanguage;
  /**
   * B-F09 (R-FIX-2): খণ্ডগুলোর সৎ অবস্থা-নোটের ডিডুপ-সমষ্টি (যাচাই-বন্ধ/
   * ইঞ্জিন-ফলব্যাক/নর্মালাইজেশন) — কলার (motion_video) এগুলো partialNote-এ
   * প্রকাশ করে, শুধু মেটাডেটায় ডুবে থাকে না।
   */
  honestyNotes: string[];
}

/** খণ্ডগুলোর ফাইলনাম-প্যাটার্ন আগের লুপের মতোই: voice-<i>.wav */
export async function synthesizeVoiceoverChunks(opts: {
  chunks: string[];
  language: SpeechLanguage;
  /** পছন্দের কণ্ঠ (প্রোফাইলে না থাকলে শেয়ার্ড resolveVoice ডিফল্ট বেছে নেয়) */
  voiceId?: string;
  speed?: number;
  workingDir: string;
}): Promise<VoiceoverOutcome> {
  const requested = opts.voiceId ?? 'tongtong';
  const chunks: VoiceoverChunk[] = [];
  const failures: string[] = [];
  let cursor = 0;

  for (let i = 0; i < opts.chunks.length; i++) {
    const filePath = path.join(opts.workingDir, `voice-${i}.wav`);
    try {
      const speech = await synthesizeVerifiedSpeech(
        {
          task: 'speech',
          language: opts.language,
          script: opts.chunks[i],
          voiceId: requested as SpeechVoice,
          outputFormat: 'wav',
          sampleRate: 24000,
          speed: opts.speed ?? 1,
        },
        { verify: false }
      );
      await writeFile(filePath, speech.buffer);
      const info = await mediaInfo(filePath);
      // শূন্য-দৈর্ঘ্যের ফাইল টাইমলাইন ভাঙে (সব খণ্ড একই startSec-এ বসে) —
      // সৎ ব্যর্থতা-নোটসহ বাদ; এটি নতুন প্রতিরোধ, আচরণ-পরিবর্তন নয়
      if (!(info.durationSec > 0)) {
        failures.push(`ভয়েসওভার খণ্ড ${i + 1} ত্রুটিপূর্ণ (দৈর্ঘ্য শূন্য)`);
        continue;
      }
      chunks.push({
        file: filePath,
        startSec: cursor,
        voice: speech.voice,
        attempts: speech.attempts,
        notes: [...speech.verification.notes],
      });
      cursor += info.durationSec + 0.2;
    } catch (err) {
      // সব ইঞ্জিন মরে গেলে সংশ্লেষক সৎ rejection ছুড়েছে (REG-1g) — খণ্ড বাদ,
      // তবে বাকি খণ্ড/ভিডিও বাঁচবে (ঐচ্ছিক-ভয়েসওভার সত্যিই ঐচ্ছিক)
      failures.push(
        `ভয়েসওভার খণ্ড ${i + 1} ব্যর্থ (${err instanceof Error ? err.message.slice(0, 120) : 'অজানা'})`
      );
    }
  }

  // B-F09 (R-FIX-2): খণ্ডের সৎ অবস্থা-নোটগুলোর ডিডুপ-সমষ্টি — কলারের
  // partialNote-প্রকাশের জন্য (নোট-কেবল মেটাডেটার নীরবতা দূর করে)
  const honestyNotes: string[] = [];
  for (const c of chunks) {
    for (const n of c.notes) {
      if (!honestyNotes.includes(n)) honestyNotes.push(n);
    }
  }

  return { chunks, failures, requestedVoice: opts.voiceId ?? null, language: opts.language, honestyNotes };
}
