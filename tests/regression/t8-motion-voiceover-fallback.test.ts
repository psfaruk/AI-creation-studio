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
// ============================================================

import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test';
import { mkdtemp, rm, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
// encodeWav — রিয়েল PCM এনকোডার (music_engine-এর ভেতরের একই স্রোত)
import { encodeWav } from '@/lib/agent/audio/pcm';
// edge_tts খাঁটি রাউটিং-মডিউল (t1-এর মতোই রিয়েল — নেটওয়ার্ক নেই)
import { isEdgeVoice } from '@/lib/agent/audio/edge_tts';

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

// bn প্রোফাইল: ৩টি Edge-নিউরাল + jam + douji (language_controller.ts:68)
const BN_CHUNKS = [
  'এটি প্রথম খণ্ডের ভয়েসওভার পাঠ্য।',
  'এটি দ্বিতীয় খণ্ডের ভয়েসওভার পাঠ্য।',
];
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
  edgeMode = 'ok';
  zaiMode = 'ok';
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

  test('REG-8b: fallback success — Edge 403 → chain reaches z-ai voice, attempts>1, honest note', async () => {
    edgeMode = 'throw403';
    const wd = await freshWorkdir();
    const out = await synthesizeVoiceoverChunks({
      chunks: [BN_CHUNKS[0]],
      language: 'bn',
      voiceId: 'bn-BD-NabanitaNeural',
      workingDir: wd,
    });

    expect(out.chunks.length).toBe(1);
    expect(out.chunks[0].voice).toBe('jam'); // প্রথম z-ai ফলব্যাক কণ্ঠ
    expect(out.chunks[0].attempts).toBe(2); // Nabanita(ব্যর্থ) → jam(সফল)
    expect(out.chunks[0].notes.some(n => n.includes('ইঞ্জিন-ফলব্যাক'))).toBe(true);
    expect(out.failures.length).toBe(0); // খণ্ড হারেনি — এটিই ফিক্সের মূল দাবি
  });

  test('REG-8c: engine-aware skip — dead Edge engine never wastes calls on its remaining voices', async () => {
    edgeMode = 'throw403';
    const wd = await freshWorkdir();
    await synthesizeVoiceoverChunks({
      chunks: [BN_CHUNKS[0]],
      language: 'bn',
      voiceId: 'bn-BD-NabanitaNeural',
      workingDir: wd,
    });

    // প্রথম Edge 403-ই ইঞ্জিনকে অচল ঘোষণা করে — Pradeep/Tanishaa কখনো ডাকা হয় না
    expect(edgeCalls.map(c => c.voice)).toEqual(['bn-BD-NabanitaNeural']);
    expect(zaiCalls.map(c => c.voice)).toEqual(['jam']);
  });

  test('REG-8d: all engines dead — honest per-chunk failure, other chunks still processed', async () => {
    edgeMode = 'throw403';
    zaiMode = 'throw';
    const wd = await freshWorkdir();
    const out = await synthesizeVoiceoverChunks({
      chunks: BN_CHUNKS,
      language: 'bn',
      voiceId: 'bn-BD-NabanitaNeural',
      workingDir: wd,
    });

    expect(out.chunks.length).toBe(0);
    expect(out.failures.length).toBe(2);
    // সৎ ব্যর্থতা-বার্তা: সব ইঞ্জিন অচল — নীরব-ভান নয় (REG-1g-চুক্তির উত্তরাধিকার)
    expect(out.failures[0]).toContain('ভয়েসওভার খণ্ড 1 ব্যর্থ');
    expect(out.failures[0]).toContain('সব TTS ইঞ্জিন অচল');
    expect(out.failures[1]).toContain('ভয়েসওভার খণ্ড 2 ব্যর্থ');
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

  test('REG-8f: metadata truthfulness — actual voice, attempts and fallback notes recorded', async () => {
    edgeMode = 'throw403';
    const wd = await freshWorkdir();
    const out = await synthesizeVoiceoverChunks({
      chunks: BN_CHUNKS,
      language: 'bn',
      voiceId: 'bn-BD-NabanitaNeural',
      workingDir: wd,
    });

    expect(out.language).toBe('bn');
    expect(out.requestedVoice).toBe('bn-BD-NabanitaNeural');
    for (const c of out.chunks) {
      expect(c.voice).toBe('jam'); // আসল কণ্ঠ ≠ অনুরোধকৃত — মেটাডেটায় স্পষ্ট
      expect(c.attempts).toBe(2);
      const fb = c.notes.filter(n => n.includes('ইঞ্জিন-ফলব্যাক'));
      expect(fb.length).toBe(1);
      expect(fb[0]).toContain('Edge'); // কোন ইঞ্জিন ব্যর্থ হয়েছিল সেটিও সৎভাবে লেখা
    }
  });

  test('REG-8g: bounded retry — per-chunk chain never exceeds the profile, no infinite loop', async () => {
    edgeMode = 'throw403';
    zaiMode = 'throw';
    const wd = await freshWorkdir();
    const out = await synthesizeVoiceoverChunks({
      chunks: BN_CHUNKS,
      language: 'bn',
      voiceId: 'bn-BD-NabanitaNeural',
      workingDir: wd,
    });

    // ইঞ্জিন-সচেতন স্কিপসহ চেইন: প্রতি খণ্ডে সর্বোচ্চ ৫টি প্রোফাইল-কণ্ঠ,
    // কিন্তু ২টি ইঞ্জিন মরলে মাত্র ২টি বাস্তব কল-ই যথেষ্ট — সীমা কখনো ছাড়ায় না
    expect(edgeCalls.length).toBe(2); // প্রতি খণ্ডে ১টি Edge কল
    expect(zaiCalls.length).toBe(2); // প্রতি খণ্ডে ১টি z-ai কল
    expect(edgeCalls.length + zaiCalls.length).toBeLessThanOrEqual(BN_CHUNKS.length * 5);
    expect(out.chunks.length).toBe(0); // এবং লুপ স্বাভাবিকভাবে সমাপ্ত (টাইমআউট নয়)
  });
});
