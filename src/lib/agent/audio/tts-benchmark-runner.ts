// ============================================================
// tts-benchmark-runner.ts — বাংলা TTS মান-যাচাই বেঞ্চমার্ক রানার।
// (নতুন পরিকল্পনা §৪ — তৃতীয় ধাপ)
//
// ব্যাকএন্ড ব্যাকগ্রাউন্ড-জব: প্রতি বাক্যে বিকল্প-কণ্ঠে (jam/douji)
// নর্মালাইজড টেক্সট TTS করে যন্ত্র-পরীক্ষা (দৈর্ঘ্য/নীরবতা/ক্লিপিং)
// চালায়, প্রথম ৩টি সফল বাক্যে উপদেশমূলক ASR ব্যাক-চেক করে।
//
// সততা-নীতি (এখানে কোনো আপস নেই):
//  - 'pass' = শুধুমাত্র *যন্ত্র-পরীক্ষা* পাস — উচ্চারণ-সঠিকতার নিশ্চয়তা নয়।
//    কোনো কণ্ঠই বাংলা-প্রশিক্ত নয়; মানব-শ্রবণ পরীক্ষা বাধ্যতামূলক।
//  - ৪২৯/রেট-লিমিট = সাময়িক — কখনোই লাইসেন্স/ইন্টিগ্রেশন-সমস্যা নয়।
//  - রান-ডিরেক্টরি (অডিওসহ) রেখে দেওয়া হয় — মানব-শ্রবণের জন্যই।
//
// স্টোরেজ: <cwd>/storage/benchmark/tts/<reportId>/
//   - report.json (প্রতি বাক্যের পরে স্ন্যাপশট — ক্র্যাশ-নিরাপদ পর্যবেক্ষণ)
//   - latest.json (গোড়ায়: শেষ *সম্পন্ন* রানের {reportId, path})
//   - NN-bn-NNN.mp3|wav (শোনার জন্য অডিও)
// ============================================================

import path from 'path';
import os from 'os';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import type { BnBenchmarkSentence, TtsBenchmarkAudioChecks, TtsBenchmarkReport, TtsBenchmarkSentenceResult } from '@/lib/types';
import type { TtsVoice } from '@/lib/agent/sdk-helpers';
import { transcribeBuffer } from '@/lib/agent/sdk-helpers';
// §১১: পুনঃরানে একই বাক্য আবার API-খরচ না করে ক্যাশ থেকে আসে —
// প্রথম রানেই প্রকৃত সংশ্লেষণ ও মাপ হয়; ক্যাশ-হিটে একই অডিও = একই রায় (সৎ)
import { cachedSynthesizeSpeech } from '@/lib/agent/tts-cache';
import { audioQuality } from '@/lib/media/ffmpeg';
import { normalizeBengaliSpeechText } from './bn-text-normalizer';
import { BN_TTS_BENCHMARK_SENTENCES, QUICK_BENCHMARK_IDS } from './bn-benchmark-suite';
import { estimateSpeechSec } from './language_controller';

/** বেঞ্চমার্ক স্টোরেজের গোড় */
const BENCHMARK_TTS_ROOT = path.join(process.cwd(), 'storage', 'benchmark', 'tts');
const LATEST_JSON_PATH = path.join(BENCHMARK_TTS_ROOT, 'latest.json');

/** একটি রানের অডিও-ডিরেক্টরি (reportId-regex-দ্বারা সুরক্ষিত) */
export function benchmarkAudioDir(reportId: string): string {
  return path.join(BENCHMARK_TTS_ROOT, reportId);
}

// ------------------------------------------------------------
// HMR-নিরাপদ অবস্থা (globalThis-ক্যাশ — নতুন মডিউল লোড হলেও
// চলমান রান হারিয়ে যায় না)
// ------------------------------------------------------------
interface TtsBenchmarkState {
  current: TtsBenchmarkReport | null;
  cancelRequested: boolean;
  inFlight: Promise<void> | null;
}
const g = globalThis as unknown as { __ttsBenchmarkState?: TtsBenchmarkState };
const state: TtsBenchmarkState = (g.__ttsBenchmarkState ??= {
  current: null,
  cancelRequested: false,
  inFlight: null,
});

const HONEST_NOTE =
  'এটি যন্ত্র-ভিত্তিক পরীক্ষা (দৈর্ঘ্য/নীরবতা/ক্লিপিং/ASR-উপদেশ)। কোনো কণ্ঠই বাংলা-প্রশিন্নত নয় — "যাচাইকৃত বাংলা" দাবির আগে মানব-শ্রবণ পরীক্ষা বাধ্যতামূলক।';

/** ফাইলসিস্টেম-নিরাপদ রিপোর্ট-আইডি: ttsbn-YYYYMMDD-HHmmss */
function makeReportId(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `ttsbn-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** বাতিল-সচেতন অপেক্ষা — প্রতি ২.৫ সেকেন্ডে বাতিল-নির্দেশ দেখে আগে ফেরে */
async function sleepCancellable(ms: number): Promise<boolean> {
  const step = 2_500;
  let waited = 0;
  while (waited < ms) {
    if (state.cancelRequested) return false;
    const chunk = Math.min(step, ms - waited);
    await sleep(chunk);
    waited += chunk;
  }
  return !state.cancelRequested;
}

async function persistReport(report: TtsBenchmarkReport): Promise<void> {
  await mkdir(benchmarkAudioDir(report.id), { recursive: true });
  await writeFile(path.join(benchmarkAudioDir(report.id), 'report.json'), JSON.stringify(report, null, 2), 'utf-8');
}

// ------------------------------------------------------------
// প্রতি-বাক্যের যন্ত্র-পরীক্ষা ও রায়
// ------------------------------------------------------------

/** অডিও-বাফারের যন্ত্র-পরিমাপ (temp ফাইলে ffprobe/ffmpeg চালিয়ে) */
async function measureAudio(buffer: Buffer, ext: string, expectedSec: number): Promise<TtsBenchmarkAudioChecks | null> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ttsbn-'));
  try {
    const f = path.join(tmp, `q.${ext}`);
    await writeFile(f, buffer);
    const q = await audioQuality(f);
    const durationSec = q.durationSec;
    const silenceLen = q.silenceRanges.reduce((sum, r) => sum + Math.max(0, r.end - r.start), 0);
    return {
      durationSec,
      expectedSec: Math.round(expectedSec * 100) / 100,
      durationOk: durationSec >= expectedSec * 0.35 && durationSec <= expectedSec * 3,
      peakDb: q.peakDb ?? undefined,
      silenceRatio: durationSec > 0 ? Math.round((silenceLen / durationSec) * 1000) / 1000 : 1,
      clippingSuspected: q.peakDb != null && q.peakDb > -0.15,
      silenceRanges: q.silenceRanges,
    };
  } catch {
    return null;
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * রায়-নির্ণয় — শুধুমাত্র যন্ত্র-পরীক্ষার ভিত্তিতে:
 *  fail : বাফার খালি · দৈর্ঘ্য < max(০.৬ সে., ০.৩× প্রত্যাশা) ·
 *         দৈর্ঘ্য > ৪× প্রত্যাশা · নীরবতা > ৮০%
 *  warn : দৈর্ঘ্য-সীমা লঙ্ঘন (০.৩৫×–৩× বাইরে) · সম্ভাব্য ক্লিপিং ·
 *         নীরবতা > ৪৫% · একটানা নীরবতা > ২ সে.
 *  pass : বাকি সব — সঙ্গে মানব-শ্রবণ-বাকি-নোট (সবসময়)
 */
function verdictFor(buffer: Buffer, checks: TtsBenchmarkAudioChecks): {
  status: 'pass' | 'warn' | 'fail';
  notes: string[];
} {
  const notes: string[] = [];
  const longestSilence = checks.silenceRanges.reduce((m, r) => Math.max(m, r.end - r.start), 0);
  if (buffer.length === 0) {
    notes.push('অডিও বাফার খালি এসেছে।');
    return { status: 'fail', notes };
  }
  if (checks.durationSec < Math.max(0.6, checks.expectedSec * 0.3)) {
    notes.push(`দৈর্ঘ্য প্রত্যাশার চেয়ে অনেক কম (${checks.durationSec.toFixed(1)} সে., প্রত্যাশিত ~${checks.expectedSec.toFixed(1)} সে.) — পুরো বাক্য পড়া হয়নি।`);
    return { status: 'fail', notes };
  }
  if (checks.durationSec > checks.expectedSec * 4) {
    notes.push(`দৈর্ঘ্য অস্বাভাবিক বেশি (${checks.durationSec.toFixed(1)} সে. বনাম প্রত্যাশিত ~${checks.expectedSec.toFixed(1)} সে.) — কণ্ঠ আটকে আটকে পড়েছে।`);
    return { status: 'fail', notes };
  }
  if (checks.silenceRatio > 0.8) {
    notes.push('অডিওর ৮০%-এর বেশিই নীরব — কথা নেই বললেই চলে।');
    return { status: 'fail', notes };
  }
  if (!checks.durationOk) {
    notes.push(`দৈর্ঘ্য প্রত্যাশিত সীমার (০.৩৫×–৩×) বাইরে — প্রাপ্ত ${checks.durationSec.toFixed(1)} সে., প্রত্যাশিত ~${checks.expectedSec.toFixed(1)} সে.।`);
  }
  if (checks.clippingSuspected && checks.peakDb != null) {
    notes.push(`সম্ভাব্য ক্লিপিং — পিক ${checks.peakDb.toFixed(2)} dB (প্রায় ০ dB)।`);
  }
  if (checks.silenceRatio > 0.45) {
    notes.push(`উল্লেখযোগ্য নীরবতা — মোট সময়ের ${Math.round(checks.silenceRatio * 100)}%।`);
  }
  if (longestSilence > 2) {
    notes.push(`একটানা দীর্ঘ নীরব অংশ (${longestSilence.toFixed(1)} সে.)।`);
  }
  return notes.length > 0 ? { status: 'warn', notes } : { status: 'pass', notes };
}

// ------------------------------------------------------------
// মূল রান-লুপ
// ------------------------------------------------------------
async function runBenchmark(report: TtsBenchmarkReport, sentences: BnBenchmarkSentence[]): Promise<void> {
  const runDir = benchmarkAudioDir(report.id);
  await mkdir(runDir, { recursive: true });

  let consecutiveRateLimited = 0; // পরপর রেট-লিমিট-স্কিপ গণনা
  let ratePauseCount = 0; // সর্বোচ্চ ২টি ৪৫ সে.-বিরতি
  let asrAttempts = 0; // প্রথম ৩টি সফল বাক্যে উপদেশমূলক ASR

  for (let i = 0; i < sentences.length; i++) {
    if (state.cancelRequested) {
      report.status = 'cancelled';
      break;
    }
    const sentence = sentences[i];
    const voice: TtsVoice = i % 2 === 0 ? 'jam' : 'douji';
    const startedAt = Date.now();
    const normalized = normalizeBengaliSpeechText(sentence.text);
    const notes: string[] = [];
    if (normalized.changed) {
      notes.push(`টেক্সট-নর্মালাইজেশন প্রযোজ্য (${normalized.adjustments.length}টি সমন্বয়)।`);
    }

    let result: TtsBenchmarkSentenceResult;
    try {
      const speech = await cachedSynthesizeSpeech(normalized.text, voice, 1);
      const fileName = `${String(i + 1).padStart(2, '0')}-${sentence.id}.${speech.ext}`;
      await writeFile(path.join(runDir, fileName), speech.buffer);

      const expectedSec = estimateSpeechSec(normalized.text, 'bn');
      const checks = await measureAudio(speech.buffer, speech.ext, expectedSec);

      if (!checks) {
        // সংশ্লেষণ সফল কিন্তু যন্ত্র-পরিমাপ চালানো যায়নি — সৎ fail
        result = {
          sentenceId: sentence.id,
          category: sentence.category,
          text: sentence.text,
          normalizedText: normalized.text,
          voice,
          status: 'fail',
          notes: [...notes, 'অডিও-পরিমাপ চালানো যায়নি (ffprobe/ffmpeg) — ফাইলটি শুনে নিজেই যাচাই করুন।'],
          durationMs: Date.now() - startedAt,
        };
      } else {
        const { status, notes: verdictNotes } = verdictFor(speech.buffer, checks);
        if (status === 'pass') {
          verdictNotes.push('যন্ত্র-পরীক্ষা পাস — উচ্চারণ-সঠিকতা মানব-শ্রবণে যাচাই বাকি।');
        }
        result = {
          sentenceId: sentence.id,
          category: sentence.category,
          text: sentence.text,
          normalizedText: normalized.text,
          voice,
          status,
          checks,
          notes: [...notes, ...verdictNotes],
          durationMs: Date.now() - startedAt,
          audioUrl: `/api/benchmark/tts/audio?run=${report.id}&file=${encodeURIComponent(fileName)}`,
        };

        // উপদেশমূলক ASR ব্যাক-চেক — কেবল প্রথম ৩টি সফল বাক্যে (কোটা-সম্মান)
        if (asrAttempts < 3) {
          asrAttempts++;
          try {
            const transcript = await transcribeBuffer(speech.buffer, speech.ext);
            const bnChars = (transcript.match(/[\u0980-\u09FF]/g) ?? []).length;
            const allLetters = (transcript.match(/[\p{L}]/gu) ?? []).length;
            result.asr = {
              transcript: transcript.slice(0, 400),
              bnCharRatio: allLetters > 0 ? Math.round((bnChars / allLetters) * 1000) / 1000 : 0,
              advisoryOnly: true,
            };
          } catch {
            result.notes.push('ASR ব্যাক-চেক সাময়িকভাবে বাদ (রেট-লিমিট) — উপদেশমূলক ছিল মাত্র');
          }
        }
      }
      consecutiveRateLimited = 0; // সফল ডাক — গণনা রিসেট
    } catch (err) {
      const msg = String((err as { message?: unknown })?.message ?? err);
      if (/TEMPORARILY_UNAVAILABLE/.test(msg)) {
        // ৪২৯-নিঃশেষ — সাময়িক, কখনোই লাইসেন্স/ইন্টিগ্রেশন-সমস্যা নয়
        result = {
          sentenceId: sentence.id,
          category: sentence.category,
          text: sentence.text,
          normalizedText: normalized.text,
          voice,
          status: 'skipped_rate_limited',
          notes: [...notes, 'রেট-লিমিট — সাময়িক, লাইসেন্স/ইন্টিগ্রেশন-সমস্যা নয়; পরে আবার চালান'],
          durationMs: Date.now() - startedAt,
        };
        consecutiveRateLimited++;
        if (consecutiveRateLimited >= 4) {
          consecutiveRateLimited = 0;
          if (ratePauseCount < 2) {
            ratePauseCount++;
            // উইন্ডো রিসেটের জন্য ৪৫ সে. বিরতি (বাতিল-সচেতন)
            const ok = await sleepCancellable(45_000);
            if (!ok) {
              report.status = 'cancelled';
              report.results.push(result);
              report.progress.done = i + 1;
              break;
            }
          }
        }
      } else {
        result = {
          sentenceId: sentence.id,
          category: sentence.category,
          text: sentence.text,
          normalizedText: normalized.text,
          voice,
          status: 'error',
          notes: [...notes, `সংশ্লেষণ-ত্রুটি: ${msg.slice(0, 160)}`],
          durationMs: Date.now() - startedAt,
        };
      }
    }

    report.results.push(result);
    report.progress.done = i + 1;
    // প্রতি বাক্যের পরেই স্ন্যাপশট — পর্যবেক্ষণযোগ্যতা
    await persistReport(report).catch(() => {});
  }

  if (report.status !== 'cancelled') {
    report.status = 'completed';
  }
  report.finishedAt = new Date().toISOString();
  report.summary = {
    pass: report.results.filter(r => r.status === 'pass').length,
    warn: report.results.filter(r => r.status === 'warn').length,
    fail: report.results.filter(r => r.status === 'fail').length,
    skipped: report.results.filter(r => r.status === 'skipped_rate_limited').length,
    error: report.results.filter(r => r.status === 'error').length,
    machineChecked: true,
    humanListeningPending: true, // সবসময় true — মানব-শ্রবণ আলাদা বাধ্যতামূলক ধাপ
  };
  await persistReport(report).catch(() => {});
  if (report.status === 'completed') {
    // শেষ *সম্পন্ন* রানের পয়েন্টার — GET /api/benchmark/tts এখান থেকে পড়ে
    await mkdir(BENCHMARK_TTS_ROOT, { recursive: true });
    await writeFile(
      LATEST_JSON_PATH,
      JSON.stringify({ reportId: report.id, path: path.join(benchmarkAudioDir(report.id), 'report.json') }, null, 2),
      'utf-8'
    ).catch(() => {});
  }
}

// ------------------------------------------------------------
// প্রকাশিত নিয়ন্ত্রণ-পৃষ্ঠ
// ------------------------------------------------------------

/**
 * বেঞ্চমার্ক শুরু (ব্যাকগ্রাউন্ডে)। ইতিমধ্যে কোনো রান চলমান থাকলে
 * started:false + কারণ ফেরত দেয় (API-স্তরে ৪০৯)।
 */
export function startTtsBenchmark(
  scope: 'quick' | 'full'
): { started: true; reportId: string } | { started: false; reason: string } {
  if (state.inFlight) {
    return { started: false, reason: 'একটি বেঞ্চমার্ক রান এখনো চলছে — শেষ হওয়া পর্যন্ত অপেক্ষা করুন বা বর্তমান রানটি বাতিল করুন।' };
  }
  const sentences =
    scope === 'full'
      ? BN_TTS_BENCHMARK_SENTENCES
      : BN_TTS_BENCHMARK_SENTENCES.filter(s => QUICK_BENCHMARK_IDS.includes(s.id));
  if (sentences.length === 0) {
    return { started: false, reason: 'এই scope-এ কোনো বাক্য পাওয়া যায়নি।' };
  }

  const report: TtsBenchmarkReport = {
    id: makeReportId(),
    scope,
    status: 'running',
    startedAt: new Date().toISOString(),
    progress: { done: 0, total: sentences.length },
    voices: ['jam', 'douji'],
    results: [],
    honestNote: HONEST_NOTE,
  };
  state.current = report;
  state.cancelRequested = false;
  state.inFlight = (async () => {
    try {
      await runBenchmark(report, sentences);
    } catch (err) {
      // অপ্রত্যাশিত সামগ্রিক-ব্যর্থতা — সৎ 'failed' অবস্থায় স্থায়ী করা
      // (রিপোর্ট-টাইপে আলাদা error-ফিল্ড নেই — সার্ভার-লগেই কারণ থাকে)
      console.error('[tts-benchmark] রান-ব্যর্থতা:', err);
      report.status = 'failed';
      report.finishedAt = new Date().toISOString();
      await persistReport(report).catch(() => {});
    }
  })().finally(() => {
    state.inFlight = null;
  });
  return { started: true, reportId: report.id };
}

/** চলমান রান বাতিলের অনুরোধ — পরবর্তী বাক্য-সীমায় কার্যকর হয়। রান না থাকলে false। */
export function cancelTtsBenchmark(): boolean {
  if (!state.inFlight) return false;
  state.cancelRequested = true;
  return true;
}

/**
 * বর্তমান অবস্থা: current = মেমরিতে থাকা সর্বশেষ/চলমান রান,
 * latest = ডিস্কের latest.json → report.json থেকে পড়া শেষ *সম্পন্ন* রান।
 * ডিস্কে কিছু না থাকলে latest = null।
 */
export async function getTtsBenchmarkState(): Promise<{
  current: TtsBenchmarkReport | null;
  latest: TtsBenchmarkReport | null;
}> {
  let latest: TtsBenchmarkReport | null = null;
  try {
    const ptrRaw = await readFile(LATEST_JSON_PATH, 'utf-8');
    const ptr = JSON.parse(ptrRaw) as { reportId?: string; path?: string };
    if (ptr?.reportId && ptr?.path) {
      const raw = await readFile(ptr.path, 'utf-8');
      const parsed = JSON.parse(raw) as TtsBenchmarkReport;
      if (parsed?.id === ptr.reportId) latest = parsed;
    }
  } catch {
    latest = null;
  }
  return { current: state.current, latest };
}
