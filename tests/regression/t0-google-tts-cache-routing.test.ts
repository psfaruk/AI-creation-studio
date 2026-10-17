// ============================================================
// REGRESSION TEST 0 (Google-টেস্ট-গোষ্ঠীর রাউটিং-অংশ) — tts-cache ইঞ্জিন-
// রাউটিং: bn-GOOG-Default → Google ইঞ্জিন + ডিস্ক-ক্যাশ ডিডুপ (LF-0, §1.5-৮)
//
// কেন আলাদা ফাইল এবং কেন নামটি বর্ণমালায় সবার আগে (t0-…):
//  - bun একই প্রসেসে সব টেস্ট-ফাইল চালায়; mock.module প্রসেস-জুড়ে
//    থেকে যায় এবং mock.restore() শুধু নিজ-ফাইলের মক ফেরায়। t1/t12/t19/t25
//    সবাই '@/lib/agent/tts-cache' মক করে — তাদের পরে চললে এখানকার
//    প্রকৃত tts-cache আমদানি মক-ই পেত।
//  - তাই এই ফাইলটির নাম t0- — নির্ধারিতভাবে সব tts-cache-মককারী ফাইলের
//    আগে চলে, এবং এখানে কোনো মকই নেই: প্রকৃত tts-cache + প্রকৃত google_tts,
//    শুধু HTTP-ফেচার ইনজেক্ট করা (নেটওয়ার্ক-মুক্ত)।
//  - TTS_CACHE_DIR প্রিলোডে টেম্পে রাউট থাকায় প্রকৃত ক্যাশ অস্পৃশ্য।
//
// CONTRACT (§1.5-৮: refresh/retry এবং cache hit):
//  - গুগল-কণ্ঠের সংশ্লেষণ প্রকৃত google-ইঞ্জিন পথ দিয়ে যায় (audio/mpeg);
//  - একই (text, voice, speed)-এর দ্বিতীয় কল ডিস্ক-ক্যাশ থেকে আসে —
//    নতুন HTTP-fetch হয় না; hits-গণনা বাড়ে।
// ============================================================

import { describe, expect, test, beforeEach, afterAll } from 'bun:test';
import {
  setGoogleTtsFetcherForTests,
  GOOGLE_TTS_VOICE,
  type GoogleTtsFetchResult,
} from '@/lib/agent/audio/google_tts';
import { cachedSynthesizeSpeech, ttsCacheStats } from '@/lib/agent/tts-cache';

function fakeMp3(bytes = 40_000): Buffer {
  const b = Buffer.alloc(bytes, 0x10);
  b[0] = 0xff;
  b[1] = 0xfb;
  return b;
}

const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  setGoogleTtsFetcherForTests(async (url): Promise<GoogleTtsFetchResult> => {
    calls.push(url);
    return { status: 200, contentType: 'audio/mpeg', body: fakeMp3() };
  });
});

afterAll(() => {
  setGoogleTtsFetcherForTests(null);
});

describe('REG-26q [tts-cache রাউটিং — প্রকৃত মডিউল, মক-মুক্ত]: Google voice → goog engine + cache dedup', () => {
  test('REG-26q: bn-GOOG-Default → প্রকৃত Google-ইঞ্জিন (audio/mpeg) + দ্বিতীয় অভিন্ন কল ক্যাশ-হিট', async () => {
    const text = 'ক্যাশ-রাউটিং পরীক্ষার বাক্য।';
    const before = ttsCacheStats();
    const r1 = await cachedSynthesizeSpeech(text, GOOGLE_TTS_VOICE, 1);
    // গুগল-ইঞ্জিন-পথ (z-ai হলে audio/wav আসত; Edge হলেও mp3 কিন্তু ভিন্ন কণ্ঠ-সেট)
    expect(r1.mimeType).toBe('audio/mpeg');
    expect(r1.ext).toBe('mp3');
    expect(calls.length).toBe(1); // প্রকৃত গুগল-fetch হয়েছে (ইনজেক্টেড)
    expect(calls[0]).toContain('tl=bn');
    const r2 = await cachedSynthesizeSpeech(text, GOOGLE_TTS_VOICE, 1);
    expect(calls.length).toBe(1); // দ্বিতীয় কলে নতুন fetch নয়
    expect(r2.buffer.length).toBe(r1.buffer.length);
    expect(ttsCacheStats().hits).toBe(before.hits + 1);
    // পৃথিবী-তথ্য: ভিন্ন টেক্সট নতুন fetch করে (ক্যাশ-কী টেক্সট-সচেতন)
    const r3 = await cachedSynthesizeSpeech('ভিন্ন বাক্য।', GOOGLE_TTS_VOICE, 1);
    expect(r3.mimeType).toBe('audio/mpeg');
    expect(calls.length).toBe(2);
  });
});
