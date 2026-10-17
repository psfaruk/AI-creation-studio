// ============================================================
// REG-8 — motion-video voiceover fallback reliability
// (Phase-3 Workstream A: P0-BUG-01-এর শেষ বাদ-পড়া কল-সাইট)
//
// motion_video.ts:645 এ পর্যন্ত ভয়েসওভার-খণ্ডগুলো একক-কণ্ঠের
// cachedSynthesizeSpeech সরাসরি কলে তৈরি হতো — এক ইঞ্জিন অচল থাকলে
// (যেমন yrz3ymb7-এর Edge-403) সব খণ্ড একইভাবে ব্যর্থ হয়ে হারাত।
// Phase-3 থেকে খণ্ডগুলো synthesizeVoiceoverChunks (pipelines/voiceover.ts)
// দিয়ে যায় — synthesizeVerifiedSpeech-এর শেয়ার্ড ফলব্যাক-চেইনসহ।
//
// Isolation (tests/README.md চুক্তি): ইঞ্জিন-সীমানা মক (tts-cache +
// sdk-helpers — t1-এর একই প্যাটার্ন); ভাষা-নিয়ন্ত্রক/নর্মালাইজার/edge_tts
// রিয়েল; ffmpeg রিয়েল (শুধু os.tmpdir()-এ); কোনো provider/db/storage
// ছোঁয়া নেই। মক ইঞ্জিন রিয়েল encodeWav বাফার ফেরত দেয় — ফলে টাইমলাইনের
// duration/startSec হিসাব প্রকৃত ffprobe দিয়েই যাচাই হয়।
//
// R-FIX-1 চুক্তি-পরিবর্তন (Defect A, findings-b §১০): bn-চেইনে আর z-ai
// ফলব্যাক নেই — bn + Edge-403 এখন প্রতি-খণ্ড সৎ VOICE_UNAVAILABLE ব্যর্থতা
// (চীনা-ভাষা কণ্ঠে বাংলা পড়ানো নিষিদ্ধ); en-চেইনে z-ai ফলব্যাক বৈধ রয়েছে।
// ফলব্যাক-সফলতার কেসগুলো (8b/8f) এখন en-পথে, bn-পথের কেসগুলো (8c/8d/8g)
// সৎ-ব্যর্থতা লক করে। পুরোনো bn→jam চুক্তি ত্রুটিপূর্ণ ছিল (B-F01) — এই
// রিরাইট শক্তিশালীকরণ, দুর্বলীকরণ নয়।
// ============================================================

import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test';
import { mkdtemp, rm, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
// encodeWav — রিয়েল PCM এনকোডার (music_engine-এর ভেতরের একই স্রোত)
import { encodeWav } from '@/lib/agent/audio/pcm';
// edge_tts খাঁটি রাউটিং-মডিউল (t1-এর মতোই রিয়েল — নেটওয়ার্ক নেই)
import { isEdgeVoice } from '@/lib/agent/audio/edge_tts';
// LF-0: Google-কণ্ঠ শনাক্তকরণ (খাঁটি — নেটওয়ার্ক নেই)
import { isGoogVoice, GOOGLE_TTS_VOICE } from '@/lib/agent/audio/google_tts';

// ---- ইঞ্জিন-সীমানা মক (t1-প্যাটার্ন) ------------------------------
let edgeMode: 'ok' | 'throw403' = 'ok';
let zaiMode: 'ok' | 'throw' = 'ok';
const edgeCalls: { voice: string; text: string }[] = [];
const zaiCalls: { voice: string; text: string }[] = [];

let okWav: Buffer;

function wavOfSeconds(sec: number): Buffer {
  const sr = 24000;
  const n = Math.round(sec * sr);
  return encodeWav(new Float32Array(n), new Float32Array(n), sr);
}

// LF-0: goog-বাকেট — bn-চেইনের শেষ প্রার্থী Google-বাংলা কণ্ঠ। এই ফাইলের
// ক্ষয়-পরীক্ষাগুলোর মূল প্রশ্ন "কোনো বাংলা কণ্ঠই পৌঁছানো যায় না" — তাই
// ডিফল্ট googMode='throw' (উভয় প্রোভাইডার অচল); সাফল্য-পথ Edge-ই দেয়।
let googMode: 'okWav' | 'throw' = 'throw';
const googCalls: { voice: string; text: string }[] = [];

mock.module('@/lib/agent/tts-cache', () => {
  return {
    cachedSynthesizeSpeech: async (text: string, voice: string, _speed: number) => {
      if (isEdgeVoice(voice)) {
        edgeCalls.push({ voice, text });
        if (edgeMode === 'throw403') {
          // yrz3ymb7-এ রেকর্ডকৃত প্রকৃত ব্যর্থতা-বার্তার হুবহু আকৃতি
          throw new Error('Edge TTS সংযোগ-ত্রুটি: Unexpected server response: 403');
        }
        return { buffer: okWav, mimeType: 'audio/wav', ext: 'wav' };
      }
      if (isGoogVoice(voice)) {
        googCalls.push({ voice, text });
        if (googMode === 'throw') {
          throw new Error('Google TTS ব্যর্থ — রেট-লিমিট (HTTP 429)');
        }
        return { buffer: okWav, mimeType: 'audio/wav', ext: 'wav' };
      }
      zaiCalls.push({ voice, text });
      if (zaiMode === 'throw') {
        throw new Error('z-ai TTS ব্যর্থ: সাময়িকভাবে অনুপলব্ধ (রেট-লিমিট)');
      }
      return { buffer: okWav, mimeType: 'audio/wav', ext: 'wav' };
    },
    ttsCacheStats: () => ({ hits: 0, misses: 0, inFlight: 0 }),
  };
});

mock.module('@/lib/agent/sdk-helpers', () => {
  return {
    // verify:false পথে ASR কখনো ডাকা হয় না — খালি স্টাব যথেষ্ট
    transcribeBuffer: async () => '',
    synthesizeSpeech: async () => {
      throw new Error('z-ai TTS should not be called directly in this test');
    },
  };
});

// পরীক্ষ্য মডিউল — উপরের মকের *পরে* ইম্পোর্ট
const { synthesizeVoiceoverChunks } = await import(
  '@/lib/agent/production/pipelines/voiceover'
);

// bn প্রোফাইল (R-FIX-1): ৪টি Edge-নিউরাল কণ্ঠ — z-ai ফলব্যাক নেই (Defect A)
const BN_CHUNKS = [
  'এটি প্রথম খণ্ডের ভয়েসওভার পাঠ্য।',
  'এটি দ্বিতীয় খণ্ডের ভয়েসওভার পাঠ্য।',
];
// en-পথ: z-ai ফলব্যাক বৈধ (en-সক্ষম ট্যাগসহ) — ফলব্যাক-সফলতার কেস এখানে
const EN_CHUNK = 'This is the first voiceover chunk text for the test.';
const WORKDIRS: string[] = [];

async function freshWorkdir(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), 'reg8-voiceover-'));
  WORKDIRS.push(d);
  return d;
}

beforeEach(() => {
  okWav = wavOfSeconds(1.6); // duration-OK স্টেরিও নীরবতা — প্রকৃত ffprobe দৈর্ঘ্য
  edgeCalls.length = 0;
  zaiCalls.length = 0;
  googCalls.length = 0;
  edgeMode = 'ok';
  zaiMode = 'ok';
  googMode = 'throw'; // LF-0: ক্ষয়-পরীক্ষার ডিফল্ট — উভয় বাংলা-প্রোভাইডার অচল
});

afterAll(async () => {
  await Promise.all(WORKDIRS.map(d => rm(d, { recursive: true, force: true }).catch(() => {})));
});

describe('REG-8: motion-video voiceover fallback (Phase-3 A)', () => {
  test('REG-8a: primary voice success — 1 attempt, no fallback note, cursor timing correct', async () => {
    const wd = await freshWorkdir();
    const out = await synthesizeVoiceoverChunks({
      chunks: BN_CHUNKS,
      language: 'bn',
      voiceId: 'bn-BD-NabanitaNeural',
      workingDir: wd,
    });

    expect(out.chunks.length).toBe(2);
    expect(out.failures.length).toBe(0);
    expect(out.requestedVoice).toBe('bn-BD-NabanitaNeural');
    for (const c of out.chunks) {
      expect(c.voice).toBe('bn-BD-NabanitaNeural'); // প্রাথমিক কণ্ঠই সফল
      expect(c.attempts).toBe(1);
      expect(c.notes.some(n => n.includes('ইঞ্জিন-ফলব্যাক'))).toBe(false);
    }
    // টাইমলাইন: প্রথম খণ্ড ০ সে. থেকে; ১.৬ সে. অডিও + ০.২ ফাঁক → দ্বিতীয়টি ১.৮ সে. থেকে
    // (আগের লুপের cursor += durationSec + 0.2 নীতি হুবহু অক্ষত)
    expect(out.chunks[0].startSec).toBe(0);
    expect(out.chunks[1].startSec).toBeCloseTo(1.8, 2);
    expect(edgeCalls.length).toBe(2); // প্রতি খণ্ডে ঠিক একটি কল
    expect(zaiCalls.length).toBe(0);
    // ফাইলগুলো সত্যিই লেখা হয়েছে (আগের লুপের voice-<i>.wav নাম-চুক্তি)
    const files = await readdir(wd);
    expect(files.sort()).toEqual(['voice-0.wav', 'voice-1.wav']);
  });

  test('REG-8b [R-FIX-1]: en fallback success — Edge 403 → chain reaches the en-capable z-ai voice, attempts>1, honest notes', async () => {
    edgeMode = 'throw403';
    const wd = await freshWorkdir();
    const out = await synthesizeVoiceoverChunks({
      chunks: [EN_CHUNK],
      language: 'en',
      voiceId: 'en-US-AriaNeural',
      workingDir: wd,
    });

    expect(out.chunks.length).toBe(1);
    expect(out.chunks[0].voice).toBe('jam'); // প্রথম en-সক্ষম z-ai ফলব্যাক কণ্ঠ
    expect(out.chunks[0].attempts).toBe(2); // Aria(৪০৩) → jam(সফল)
    expect(out.chunks[0].notes.some(n => n.includes('ইঞ্জিন-ফলব্যাক'))).toBe(true);
    expect(out.failures.length).toBe(0); // খণ্ড হারেনি — চেইন-নির্ভরতার মূল দাবি অক্ষত
    // B-F09: সৎ নোট ডিডুপ-সমষ্টিতেও দৃশ্যমান (নীরব মেটাডেটা নয়)
    expect(out.honestyNotes.some(n => n.includes('ইঞ্জিন-ফলব্যাক'))).toBe(true);
  });

  test('REG-8c [R-FIX-1 — Defect A]: bn + Edge 403 ⇒ engine-aware skip AND no cross-language fallback — the chunk fails honestly', async () => {
    edgeMode = 'throw403';
    const wd = await freshWorkdir();
    const out = await synthesizeVoiceoverChunks({
      chunks: [BN_CHUNKS[0]],
      language: 'bn',
      voiceId: 'bn-BD-NabanitaNeural',
      workingDir: wd,
    });

    // প্রথম Edge 403-ই ইঞ্জিনকে অচল করে — Pradeep/Tanishaa/Bashkar কখনো ডাকা হয় না
    expect(edgeCalls.map(c => c.voice)).toEqual(['bn-BD-NabanitaNeural']);
    // LF-0: শেষ প্রার্থী Google-ও চেষ্টিত ও অচল — উভয়ের নথি আছে
    expect(googCalls.map(c => c.voice)).toEqual([GOOGLE_TTS_VOICE]);
    // Defect-A লক: z-ai (চীনা-ভাষা) কণ্ঠ কখনোই বাংলা পড়তে বসে না
    expect(zaiCalls.length).toBe(0);
    // খণ্ডটি সৎভাবে ব্যর্থ — টাইপড VOICE_UNAVAILABLE বার্তাসহ (নীরব-ভান নয়)
    expect(out.chunks.length).toBe(0);
    expect(out.failures.length).toBe(1);
    expect(out.failures[0]).toContain('ভয়েসওভার খণ্ড 1 ব্যর্থ');
    expect(out.failures[0]).toContain('VOICE_UNAVAILABLE');
    expect(out.failures[0]).toContain('Bengali locale');
  });

  test('REG-8d [R-FIX-1]: bn + Edge 403 — every chunk fails honestly (VOICE_UNAVAILABLE), no silent wrong-language audio', async () => {
    edgeMode = 'throw403';
    const wd = await freshWorkdir();
    const out = await synthesizeVoiceoverChunks({
      chunks: BN_CHUNKS,
      language: 'bn',
      voiceId: 'bn-BD-NabanitaNeural',
      workingDir: wd,
    });

    expect(out.chunks.length).toBe(0);
    expect(out.failures.length).toBe(2);
    // সৎ ব্যর্থতা-বার্তা: টাইপড VOICE_UNAVAILABLE — নীরব-ভান বা ভুল-ভাষা নয়
    expect(out.failures[0]).toContain('ভয়েসওভার খণ্ড 1 ব্যর্থ');
    expect(out.failures[0]).toContain('VOICE_UNAVAILABLE');
    expect(out.failures[1]).toContain('ভয়েসওভার খণ্ড 2 ব্যর্থ');
    expect(out.failures[1]).toContain('VOICE_UNAVAILABLE');
  });

  test('REG-8e: optional speech truly optional — total voiceover failure resolves, caller can continue', async () => {
    edgeMode = 'throw403';
    zaiMode = 'throw';
    const wd = await freshWorkdir();
    const out = await synthesizeVoiceoverChunks({
      chunks: BN_CHUNKS,
      language: 'bn',
      voiceId: 'bn-BD-NabanitaNeural',
      workingDir: wd,
    });

    // হেল্পার নিজে কখনো থ্রো করে না — পাইপলাইন ambient/নীরব পথে চলতে পারে
    expect(out.chunks).toEqual([]);
    expect(out.failures.length).toBe(2);
  });

  test('REG-8f [R-FIX-1]: metadata truthfulness — actual voice ≠ requested recorded, attempts + fallback notes honest (en path)', async () => {
    edgeMode = 'throw403';
    const wd = await freshWorkdir();
    const out = await synthesizeVoiceoverChunks({
      chunks: [EN_CHUNK],
      language: 'en',
      voiceId: 'en-US-AriaNeural',
      workingDir: wd,
    });

    expect(out.language).toBe('en');
    expect(out.requestedVoice).toBe('en-US-AriaNeural');
    for (const c of out.chunks) {
      expect(c.voice).toBe('jam'); // আসল কণ্ঠ ≠ অনুরোধকৃত — মেটাডেটায় স্পষ্ট
      expect(c.attempts).toBe(2);
      const fb = c.notes.filter(n => n.includes('ইঞ্জিন-ফলব্যাক'));
      expect(fb.length).toBe(1);
      expect(fb[0]).toContain('Edge'); // কোন ইঞ্জিন ব্যর্থ হয়েছিল সেটিও সৎভাবে লেখা
    }
  });

  test('REG-8g [R-FIX-1]: bounded retry — bn + Edge 403: exactly one real call per chunk, loop always terminates', async () => {
    edgeMode = 'throw403';
    zaiMode = 'throw'; // bn-চেইনে z-ai নেই — অপ্রাসঙ্গিক, কিন্তু সীমা-প্রমাণে রাখা
    const wd = await freshWorkdir();
    const out = await synthesizeVoiceoverChunks({
      chunks: BN_CHUNKS,
      language: 'bn',
      voiceId: 'bn-BD-NabanitaNeural',
      workingDir: wd,
    });

    // প্রতি খণ্ডে সর্বোচ্চ ৫টি প্রোফাইল-কণ্ঠ (৪ Edge + ১ Google) — কিন্তু
    // ইঞ্জিন মরলে প্রতি মৃত ইঞ্জিনে মাত্র ১টি বাস্তব কল-ই যথেষ্ট; সীমা কখনো ছাড়ায় না
    expect(edgeCalls.length).toBe(2); // প্রতি খণ্ডে ১টি Edge কল
    expect(googCalls.length).toBe(2); // LF-0: প্রতি খণ্ডে ১টি Google কল
    expect(zaiCalls.length).toBe(0); // bn-চেইনে z-ai কণ্ঠ নেই
    expect(edgeCalls.length + googCalls.length + zaiCalls.length).toBeLessThanOrEqual(BN_CHUNKS.length * 5);
    expect(out.chunks.length).toBe(0); // লুপ স্বাভাবিকভাবে সমাপ্ত (টাইমআউট নয়)
  });
});
