// ============================================================
// REGRESSION TEST 27 — Provider Adapter Layer (Phase 1, B-D1)
//
// Boundaries — সম্পূর্ণ MOCK-FREE (কোনো mock.module নেই — এই স্যুটে
// মডিউল-মক প্রসেস-জুড়ে লিক হয়; ইনজেকশন-প্যারামিটার দিয়ে পরিবেশ-মোড
// সিমুলেট করা হয়, তাই অন্য কোনো টেস্ট-ফাইল দূষিত হয় না):
//  - src/lib/providers/sandbox-detect.ts (আসল): zAiConfigured,
//    assertZaiConfiguredOrThrow, classifyZaiCreateError — স্পষ্ট fake-পথ
//    দিয়ে (আসল /etc/.z-ai-config-এর উপস্থিতি নিরপেক্ষ)।
//  - src/lib/providers/registry.ts (আসল): getCapabilityReports({
//    sandboxConfigured }) ইনজেকশন।
//  - src/lib/agent/llm.ts (আসল): getZAI স্যান্ডবক্সে প্রকৃত কনফিপসহ
//    সফল (নেটওয়ার্ক-কল নেই — ZAI.create কেবল কনফিপ পড়ে)।
//
// Enforced contracts:
//  ১. zAiConfigured: বৈধ {baseUrl,apiKey} → true; অনুপস্থিত/ভাঙা/
//     অপূর্ণ → false; অগ্রাধিকার-ক্রম SDK-র মতো।
//  ২. registry: sandbox-cap available↔unavailable ইনজেকশনে ওলটে;
//     sung_vocals/lip_sync সবসময় unsupported; পোর্টেবল সবসময় available।
//  ৩. assertZaiConfiguredOrThrow/classifyZaiCreateError: কনফিপ-শূন্য
//     পথে সৎ ProviderUnavailableError (উভয় মার্কার); অন্য ত্রুটি
//     অপরিবর্তিত।
//  ৪. getZAI: স্যান্ডবক্সে (কনফিপ আছে) সফল — প্রকৃত আচরণ।
// ============================================================

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  zAiConfigured,
  defaultZaiConfigPaths,
  assertZaiConfiguredOrThrow,
  classifyZaiCreateError,
  __resetZaiConfigDetectionCache,
} from '@/lib/providers/sandbox-detect';
import { ProviderUnavailableError, isProviderUnavailableError } from '@/lib/providers/errors';
import { getCapabilityReports, getCapabilityReport, assertCapabilityPresent } from '@/lib/providers/registry';

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 't27-zai-detect-'));
}

const LABEL = 'z-ai SDK (t27)';

// --- সনাক্তকরণ (স্পষ্ট-পথ দিয়ে; পরিবেশ-নিরপেক্ষ, mock-free) ---

describe('t27 · zAiConfigured (sandbox প্রমাণীকরণ-সনাক্তকরণ)', () => {
  test('বৈধ {baseUrl,apiKey} JSON → true', () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, 'cfg'), JSON.stringify({ baseUrl: 'https://x', apiKey: 'k' }));
    expect(zAiConfigured([path.join(dir, 'cfg')])).toBe(true);
  });

  test('অনুপস্থিত ফাইল → false', () => {
    expect(zAiConfigured([path.join(tmpDir(), 'nope')])).toBe(false);
  });

  test('ভাঙা JSON → false', () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, 'cfg'), '{not json');
    expect(zAiConfigured([path.join(dir, 'cfg')])).toBe(false);
  });

  test('apiKey-বিহীন কনফিগ → false (আকৃতি-চুক্তি)', () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, 'cfg'), JSON.stringify({ baseUrl: 'https://x' }));
    expect(zAiConfigured([path.join(dir, 'cfg')])).toBe(false);
  });

  test('অগ্রাধিকার-ক্রম: প্রথম বৈধ পথ জয়ী (SDK-র মতো)', () => {
    const dir = tmpDir();
    const bad = path.join(dir, 'bad');
    const good = path.join(dir, 'good');
    writeFileSync(bad, 'not-json');
    writeFileSync(good, JSON.stringify({ baseUrl: 'https://x', apiKey: 'k' }));
    expect(zAiConfigured([bad, good])).toBe(true);
    expect(zAiConfigured([good, bad])).toBe(true);
    expect(zAiConfigured([bad])).toBe(false);
  });

  test('ডিফল্ট-পথ তালিকা SDK-র তিন-পথ চুক্তিতে (cwd/home/etc)', () => {
    const paths = defaultZaiConfigPaths();
    expect(paths.length).toBe(3);
    expect(paths[2]).toBe('/etc/.z-ai-config');
    expect(paths[0].endsWith('.z-ai-config')).toBe(true);
  });

  test('মেমো-ক্যাশ রিসেট সহায়ক কাজ করে (টেস্ট-চুক্তি)', () => {
    __resetZaiConfigDetectionCache();
    expect(typeof zAiConfigured()).toBe('boolean');
  });
});

// --- গার্ড + ত্রুটি-শ্রেণিবিভাগ (আসল মডিউল, fake-পথ/ফেক-ত্রুটি দিয়ে) ---

describe('t27 · assertZaiConfiguredOrThrow + classifyZaiCreateError', () => {
  test('কনফিপ-শূন্য পথে সৎ ProviderUnavailableError (উভয় মার্কার)', () => {
    const emptyDir = path.join(tmpDir(), 'nope');
    let caught: unknown;
    try {
      assertZaiConfiguredOrThrow(LABEL, [emptyDir]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProviderUnavailableError);
    const msg = caught instanceof Error ? caught.message : '';
    expect(msg).toContain('TEMPORARILY_UNAVAILABLE');
    expect(msg).toContain('PROVIDER_UNAVAILABLE');
    expect(isProviderUnavailableError(caught)).toBe(true);
  });

  test('বৈধ পথে নীরব', () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, 'cfg'), JSON.stringify({ baseUrl: 'https://x', apiKey: 'k' }));
    expect(() => assertZaiConfiguredOrThrow(LABEL, [path.join(dir, 'cfg')])).not.toThrow();
  });

  test('classify: SDK-র কনফিপ-ত্রুটি → ProviderUnavailableError', () => {
    const wrapped = classifyZaiCreateError(
      new Error('Configuration file not found or invalid. Please create .z-ai-config ...'),
      LABEL
    );
    expect(wrapped).toBeInstanceOf(ProviderUnavailableError);
    expect(wrapped.message).toContain('PROVIDER_UNAVAILABLE');
  });

  test('classify: অন্য ত্রুটি অপরিবর্তিত (একই অবজেক্ট)', () => {
    const original = new Error('network socket hang up');
    expect(classifyZaiCreateError(original, LABEL)).toBe(original);
  });
});

// --- রেজিস্ট্রি (ইনজেকশন দিয়ে উভয় পরিবেশ-মোড; mock-free) ---

describe('t27 · capability registry (সৎ ক্ষমতা-ম্যাট্রিক্স)', () => {
  test('স্যান্ডবক্স-কনফিপ থাকলে সব SDK-cap available', () => {
    const reports = getCapabilityReports({ sandboxConfigured: true });
    expect(reports.length).toBeGreaterThanOrEqual(12);
    for (const key of ['chat', 'image_generation', 'video_generation', 'asr'] as const) {
      const r = reports.find(x => x.key === key);
      expect(r?.status).toBe('available');
      expect(r?.sandboxOnly).toBe(true);
      expect(r?.portable).toBe(false);
    }
  });

  test('কনফিগ না থাকলে SDK-cap গুলো unavailable — কিন্তু বাতিল নয়', () => {
    const reports = getCapabilityReports({ sandboxConfigured: false });
    for (const key of ['chat', 'image_generation', 'image_editing', 'image_search', 'vision_analysis', 'speech_tts', 'asr', 'video_generation'] as const) {
      expect(reports.find(x => x.key === key)?.status).toBe('unavailable');
    }
  });

  test('sung_vocals ও lip_sync কনফিগ-নির্বিশেষে সবসময় unsupported', () => {
    for (const sandboxConfigured of [true, false]) {
      expect(getCapabilityReport('sung_vocals', { sandboxConfigured })?.status).toBe('unsupported');
      expect(getCapabilityReport('lip_sync', { sandboxConfigured })?.status).toBe('unsupported');
    }
  });

  test('পোর্টেবল ক্ষমতা (bn-TTS চেইন, প্রসিডিউরাল ইনস্ট্রুমেন্টাল) সবসময় available', () => {
    for (const sandboxConfigured of [true, false]) {
      const bn = getCapabilityReport('bengali_tts', { sandboxConfigured });
      const music = getCapabilityReport('instrumental_music', { sandboxConfigured });
      expect(bn?.status).toBe('available');
      expect(bn?.portable).toBe(true);
      expect(music?.status).toBe('available');
      expect(music?.portable).toBe(true);
    }
  });

  test('প্রতিটি রিপোর্টে সৎ ব্যাখ্যা ও খোলার-পথ অ-খালি', () => {
    for (const r of getCapabilityReports()) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.honestNote.length).toBeGreaterThan(10);
      expect(r.unblockPath.length).toBeGreaterThan(5);
    }
  });

  test('assertCapabilityPresent: unavailable → PROVIDER_UNAVAILABLE ত্রুটি', () => {
    expect(() => assertCapabilityPresent('video_generation', { sandboxConfigured: false })).toThrow(
      /PROVIDER_UNAVAILABLE/
    );
    expect(() => assertCapabilityPresent('video_generation', { sandboxConfigured: false })).toThrow(/Phase 3/);
  });

  test('assertCapabilityPresent: unsupported → UNSUPPORTED ত্রুটি (আলাদা সত্য)', () => {
    expect(() => assertCapabilityPresent('sung_vocals')).toThrow(/UNSUPPORTED/);
    expect(() => assertCapabilityPresent('sung_vocals')).not.toThrow(/PROVIDER_UNAVAILABLE/);
  });

  test('assertCapabilityPresent: available হলে নীরব', () => {
    expect(() => assertCapabilityPresent('chat', { sandboxConfigured: true })).not.toThrow();
  });

  test('অজানা কী → সৎ ত্রুটি (কল্পনা নয়)', () => {
    expect(() => assertCapabilityPresent('nonexistent' as never)).toThrow(/অজানা ক্ষমতা/);
  });
});

// --- getZAI: প্রকৃত স্যান্ডবক্স-আচরণ (এই পরিবেশে কনফিগ আছে) ---

describe('t27 · getZAI (প্রকৃত পথ)', () => {
  test('স্যান্ডবক্সে কনফিপসহ সফল — নেটওয়ার্ক-কল ছাড়াই (create কেবল কনফিপ পড়ে)', async () => {
    // এই পরিবেশে /etc/.z-ai-config আছে (Phase 0-যাচাই) — প্রকৃত আচরণ:
    // প্রিফ্লাইট পাস + ZAI.create() সফল
    expect(zAiConfigured()).toBe(true);
    const { getZAI } = await import('@/lib/agent/llm');
    const zai = await getZAI();
    expect(zai).toBeTruthy();
    expect(typeof zai.chat.completions.create).toBe('function');
  });
});
