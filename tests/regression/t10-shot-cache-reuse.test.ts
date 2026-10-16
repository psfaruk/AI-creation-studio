// ============================================================
// REG-10 — successful-shot cache reuse (Phase-3 Workstream C,
// P0-BUG-04: প্রতি রানে সম্পূর্ণ প্রোভাইডার-খরচ, কোনো পুনঃব্যবহার নেই)
//
// generateVideoClip (ai_video.ts) এখন শট-ক্যাশ-সচেতন: (১) ডিস্ক-হিট হলে
// প্রোভাইডার-কল পুরো এড়ানো, (২) একই ফিঙ্গারপ্রিন্ট চলমান থাকলে ইন-ফ্লাইট
// ডিডুপ, (৩) মিসে প্রকৃত জেনারেশন + যাচাই-সফল হলে স্টোর। কী = সম্পূর্ণ
// প্রোভাইডার-অনুরোধ ফিঙ্গারপ্রিন্ট (sha256, shot_cache.ts)।
//
// Isolation: '@/lib/agent/llm' মক (getZAI → নকল zai SDK) — কোনো প্রকৃত
// SDK লোড হয় না; globalThis.fetch মক (ডাউনলোড) — নেটওয়ার্ক নেই; ক্যাশ-রুট
// টেম্প-ডিরেক্টরিতে ওভাররাইড (storage/ অপরিবৃত); AI_VIDEO_LIMITS-এর
// পোল-বিরতি/কুলডাউন মিলিসেকেন্ড-স্কেলে (রিয়েল-টাইম অপেক্ষা নেই);
// ffmpeg রিয়েল (প্রকৃত MP4 ফিক্সচার যাচাই)।
// ============================================================

import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test';
import { mkdtemp, rm, readdir, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

// ---- নকল z-ai SDK (সাবমিট/পোল) + fetch (ডাউনলোড) ---------------
let submitCount = 0;
const submittedBodies: Record<string, unknown>[] = [];

const FIXTURE_STATE: { mp4: Buffer | null } = { mp4: null };

mock.module('@/lib/agent/llm', () => {
  return {
    getZAI: async () => ({
      video: {
        generations: {
          create: async (body: Record<string, unknown>) => {
            submitCount++;
            submittedBodies.push(body);
            return { id: `mocktask-${submitCount}`, model: 'cogvideox-3' };
          },
        },
      },
      async: {
        result: {
          query: async () => ({
            task_status: 'SUCCESS',
            video_result: [{ url: 'mock://clip-latest' }],
          }),
        },
      },
    }),
    // sdk-helpers এই মডিউল থেকে chatComplete পুনঃরপ্যানি করে — গ্রাফ-লোডের
    // জন্য রপ্তানিটি থাকতেই হয়; এই টেস্টে কখনো ডাকা হবে না
    chatComplete: async () => {
      throw new Error('chatComplete should not be called in this test');
    },
    parseToolCall: () => null,
  };
});

const { generateVideoClip, prewarmVideoClip, consumePrewarmedClip, AI_VIDEO_LIMITS } = await import('@/lib/agent/video/ai_video');
const {
  shotCacheFingerprint,
  shotCacheLookup,
  shotCacheStore,
  shotCacheStats,
  resetShotCacheStatsForTests,
  SHOT_CACHE_SCHEMA_VERSION,
} = await import('@/lib/agent/video/shot_cache');
const { runFfmpeg } = await import('@/lib/media/ffmpeg');
const { validateVideoBuffer } = await import('@/lib/agent/video/ai_video');

// মূল গ্লোবাল অবস্থা — afterAll-এ পুনরুদ্ধারের জন্য
const REAL_FETCH = globalThis.fetch;
const REAL_POLL_MS = AI_VIDEO_LIMITS.pollIntervalMs;
const REAL_COOLDOWN_MS = AI_VIDEO_LIMITS.postCompletionCooldownMs;
const ROOTS: string[] = [];
const g = globalThis as unknown as Record<string, unknown>;

let fixtureMp4: Buffer;

async function freshRoot(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), 'reg10-shotcache-'));
  ROOTS.push(d);
  return d;
}
// স্যুট-শুরুর এককালীন সেটআপ (টপ-লেভেল await — টেস্টের আগেই সম্পূর্ণ):
// ১) প্রকৃত MP4 ফিক্সচার, ২) মিলিসেকেন্ড-স্কেল পোল/কুলডাউন (রিয়েল-টাইম অপেক্ষা নেই)
{
  const dir = await mkdtemp(path.join(tmpdir(), 'reg10-fixture-'));
  ROOTS.push(dir);
  FIXTURE_STATE.mp4 = await buildFixtureMp4(dir);
  AI_VIDEO_LIMITS.pollIntervalMs = 250;
  AI_VIDEO_LIMITS.postCompletionCooldownMs = 0;
}

/** প্রকৃত, যাচাই-উত্তীর্ণ MP4 (≥50KB ডাউনলোড-প্রাচীর + ≥3s + ≥360px + অডিও-স্ট্রিম
 *  — withAudio-রূপের অনুরোধও এই একই ফিক্সচার দিয়ে যাচাই উতরায়) */
async function buildFixtureMp4(dir: string): Promise<Buffer> {
  const p = path.join(dir, 'fixture-clip.mp4');
  await runFfmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=duration=3.5:size=480x270:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3.5',
    '-c:v', 'libx264', '-b:v', '200k', '-minrate', '200k', '-maxrate', '200k',
    '-c:a', 'aac', '-b:a', '64k', '-shortest',
    '-pix_fmt', 'yuv420p', p,
  ], { label: 'REG-10 ফিক্সচার' });
  const buf = await readFile(p);
  if (buf.length < 50_000) throw new Error(`REG-10 ফিক্সচার খুব ছোট (${buf.length}B < 50KB)`);
  return buf;
}

beforeEach(() => {
  fixtureMp4 = FIXTURE_STATE.mp4!;
  submitCount = 0;
  submittedBodies.length = 0;
  // প্রতি টেস্ট: ফ্রেশ কাউন্টার + ফ্রেশ গেট + ফ্রেশ ফেচ + আগের টেস্টের
  // বাজেট-ওভাররাইড মুছে ফেলা (REG-10g-এর ক্ষুদ্র বাজেট পরের টেস্টে লিক করবে না)
  resetShotCacheStatsForTests();
  delete g.__shotCacheMaxBytes;
  (g as any).__aiVideoGate = undefined; // HMR-নিরাপহ গেট-গ্লোবাল — টেস্টে পুনর্জন্ম
  globalThis.fetch = (async () => new Response(new Uint8Array(fixtureMp4), { status: 200 })) as typeof fetch;
});

afterAll(async () => {
  AI_VIDEO_LIMITS.pollIntervalMs = REAL_POLL_MS;
  AI_VIDEO_LIMITS.postCompletionCooldownMs = REAL_COOLDOWN_MS;
  globalThis.fetch = REAL_FETCH;
  delete g.__shotCacheRootOverride;
  delete g.__shotCacheMaxBytes;
  await Promise.all(ROOTS.map(d => rm(d, { recursive: true, force: true }).catch(() => {})));
});

const BASE_REQ = {
  prompt: 'A quiet river at dawn, mist over the water',
  durationSec: 5,
  quality: 'speed' as const,
};

describe('REG-10: shot cache reuse (Phase-3 C)', () => {
  test('REG-10a: same input → validated hit — no second provider submit, honest counters', async () => {
    const root = await freshRoot();
    g.__shotCacheRootOverride = root;

    // ১ম কল: মিস → প্রকৃত (মকড) প্রোভাইডার চক্র → স্টোর
    const first = await generateVideoClip({ ...BASE_REQ });
    expect(submitCount).toBe(1);
    expect(first.fromCache).toBeUndefined(); // প্রকৃত প্রজন্ম — সৎ চিহ্ন নেই
    expect(first.taskId).toBe('mocktask-1');
    expect(shotCacheStats().misses).toBe(1);
    expect(shotCacheStats().stores).toBe(1);

    // ২য় কল (হুবহু একই অনুরোধ): ডিস্ক-হিট — কোনো নতুন সাবমিট নয়
    const second = await generateVideoClip({ ...BASE_REQ });
    expect(submitCount).toBe(1); // ← দাবির মূল: ডুপ্লিকেট সাবমিট হয়নি
    expect(second.fromCache).toBe(true);
    expect(second.taskId).toBe('mocktask-1'); // মূল প্রজন্মের টাস্ক-আইডি
    expect(second.model).toBe('cogvideox-3');
    expect(second.buffer.equals(first.buffer)).toBe(true); // বাইট-হুবহু পুনঃব্যবহার
    expect(second.info).toBeDefined(); // পুনঃযাচাইকৃত ffprobe-তথ্য
    expect(shotCacheStats().hits).toBe(1);
    expect(shotCacheStats().misses).toBe(1); // বাড়েনি
  });

  test('REG-10b: changed input → miss (every fingerprint field matters)', async () => {
    const root = await freshRoot();
    g.__shotCacheRootOverride = root;

    await generateVideoClip({ ...BASE_REQ });
    expect(shotCacheStats().misses).toBe(1);

    // প্রম্পট বদলালে → নতুন কী → মিস
    (g as any).__aiVideoGate = undefined; // কুলডাউন-নিরপেক্ষ ফ্রেশ গেট
    await generateVideoClip({ ...BASE_REQ, prompt: 'A busy city street at night, neon reflections' });
    expect(shotCacheStats().misses).toBe(2);

    // স্থায়িত্ব বদলালে (৫→১০ সে.) → মিস
    (g as any).__aiVideoGate = undefined;
    await generateVideoClip({ ...BASE_REQ, durationSec: 10 });
    expect(shotCacheStats().misses).toBe(3);

    // withAudio বদলালে → মিস
    (g as any).__aiVideoGate = undefined;
    await generateVideoClip({ ...BASE_REQ, withAudio: true });
    expect(shotCacheStats().misses).toBe(4);

    // রেফারেন্স-ছবি যোগ হলে → মিস
    (g as any).__aiVideoGate = undefined;
    await generateVideoClip({ ...BASE_REQ, imageUrl: 'data:image/png;base64,AAAA' });
    expect(shotCacheStats().misses).toBe(5);
    expect(shotCacheStats().stores).toBe(5);
    expect(shotCacheStats().hits).toBe(0); // একটিও হিট হয়নি — সব ভিন্ন ইনপুট
    expect(shotCacheStats().invalid).toBe(0); // পরিষ্কার মিস কখনো invalid-নয়

    // আবার মূল অনুরোধ → এখন সেটি ক্যাশে আছে → হিট
    (g as any).__aiVideoGate = undefined;
    const again = await generateVideoClip({ ...BASE_REQ });
    expect(again.fromCache).toBe(true);
    expect(shotCacheStats().hits).toBe(1);
  });

  test('REG-10c: hit output equivalence — cached bytes identical to provider output', async () => {
    const root = await freshRoot();
    g.__shotCacheRootOverride = root;
    const fresh = await generateVideoClip({ ...BASE_REQ });
    const hit = await generateVideoClip({ ...BASE_REQ });
    expect(hit.buffer.equals(fresh.buffer)).toBe(true);
    expect(hit.mimeType).toBe(fresh.mimeType);
    expect(hit.nativeAudio).toBe(fresh.nativeAudio);
    // স্বীকারোক্তি: লোকাল w/h/fps-স্বাভাবিকীকরণ (generateAiShot-এ) নির্ধারক
    // ffmpeg-চরণ — একই বাইটে একই আউটপুট; সেটি কোড-পরিদর্শিত, এখানে পৃথক
    // করে চালানো হয়নি (সম্পূর্ণ পাইপলাইন-হার্নেস পরবর্তী ধাপ)
  });

  test('REG-10d: invalid entry discarded → honest invalid counter → regenerates', async () => {
    const root = await freshRoot();
    g.__shotCacheRootOverride = root;
    await generateVideoClip({ ...BASE_REQ });
    expect(shotCacheStats().stores).toBe(1);

    // ডিস্কে মিডিয়া নষ্ট করে দিই (ভাঙা-এন্ট্রি সিমুলেশন)
    const fp = shotCacheFingerprint({
      v: SHOT_CACHE_SCHEMA_VERSION,
      model: 'cogvideox-3',
      prompt: BASE_REQ.prompt,
      durationSec: 5,
      quality: 'speed',
      imageUrl: null,
      withAudio: false,
      size: null,
    });
    const mediaPath = path.join(root, fp.sha256.slice(0, 2), fp.sha256.slice(2, 4), `${fp.sha256}.mp4`);
    await writeFile(mediaPath, Buffer.from('corrupted media bytes'));

    // লুকআপ এন্ট্রি বাতিল করে (invalid++) এবং null ফেরায়
    const hit = await shotCacheLookup(fp.sha256, { validate: validateVideoBuffer });
    expect(hit).toBeNull();
    expect(shotCacheStats().invalid).toBe(1);

    // পরের generateVideoClip মিস হয়ে নতুন করে জেনারেট+স্টোর করে
    (g as any).__aiVideoGate = undefined;
    const clip = await generateVideoClip({ ...BASE_REQ });
    expect(clip.fromCache).toBeUndefined();
    expect(submitCount).toBe(2);
    expect(shotCacheStats().stores).toBe(2);
  });

  test('REG-10e: in-flight join — two concurrent identical calls, ONE submit', async () => {
    const root = await freshRoot();
    g.__shotCacheRootOverride = root;
    const [a, b] = await Promise.all([
      generateVideoClip({ ...BASE_REQ }),
      generateVideoClip({ ...BASE_REQ }),
    ]);
    expect(submitCount).toBe(1); // একটাই সাবমিট — দ্বিতীয়টি প্রথমটির সাথে যোগ দিয়েছে
    expect(a.buffer.equals(b.buffer)).toBe(true);
    const fromCacheCount = [a, b].filter(c => c.fromCache === true).length;
    expect(fromCacheCount).toBe(1); // যোগদানকারী কলটি সৎভাবে চিহ্নিত
    expect(shotCacheStats().joined).toBe(1);
    expect(shotCacheStats().misses).toBe(1);
    expect(shotCacheStats().stores).toBe(1);
  });

  test('REG-10f: bypassCache — provider called, nothing stored, bypass counted', async () => {
    const root = await freshRoot();
    g.__shotCacheRootOverride = root;
    const clip = await generateVideoClip({ ...BASE_REQ }, { bypassCache: true });
    expect(submitCount).toBe(1);
    expect(clip.fromCache).toBeUndefined();
    expect(shotCacheStats().bypass).toBe(1);
    expect(shotCacheStats().stores).toBe(0); // বাইপাসে কিছুই জমা হয়নি
    expect(shotCacheStats().misses).toBe(0); // মিস-হিসাবেও গণনা হয়নি
    // ক্যাশ ফাঁকা — পরের সাধারণ কল মিস হবে
    (g as any).__aiVideoGate = undefined;
    await generateVideoClip({ ...BASE_REQ });
    expect(shotCacheStats().misses).toBe(1);
  });

  test('REG-10g: eviction honesty — tiny budget evicts oldest first with counters', async () => {
    const root = await freshRoot();
    g.__shotCacheRootOverride = root;
    const entryBytes = fixtureMp4.length;
    // বাজেট: দুটি এন্ট্রি জায়গা হবে না — প্রথমটি উচ্ছেদিত হবে
    g.__shotCacheMaxBytes = Math.floor(entryBytes * 1.6);

    await generateVideoClip({ ...BASE_REQ, prompt: 'shot one' });
    await new Promise(r => setTimeout(r, 25)); // storedAt-ক্রম নির্ধারক করতে
    (g as any).__aiVideoGate = undefined;
    await generateVideoClip({ ...BASE_REQ, prompt: 'shot two' });

    const s = shotCacheStats();
    expect(s.stores).toBe(2);
    expect(s.evictions).toBe(1); // বাজেট ছাড়িয়ে পুরোনোটি উচ্ছেদ
    expect(s.entries).toBe(1);
    // বেঁচে-থাকা এন্ট্রিটি নতুনটি ('shot two')
    const hitOld = await shotCacheLookup(
      shotCacheFingerprint({ v: SHOT_CACHE_SCHEMA_VERSION, model: 'cogvideox-3', prompt: 'shot one', durationSec: 5, quality: 'speed', imageUrl: null, withAudio: false, size: null }).sha256,
      { validate: validateVideoBuffer }
    );
    expect(hitOld).toBeNull(); // পুরোনোটি আর নেই
  });

  test('REG-10h: path safety — hex-only keys, invalid fingerprints rejected', async () => {
    const root = await freshRoot();
    g.__shotCacheRootOverride = root;
    const fp = shotCacheFingerprint({
      v: SHOT_CACHE_SCHEMA_VERSION, model: 'cogvideox-3', prompt: 'x',
      durationSec: 5, quality: 'speed', imageUrl: null, withAudio: false, size: null,
    });
    expect(/^[0-9a-f]{64}$/.test(fp.sha256)).toBe(true); // কী = খাঁটি হেক্স

    // অ-হেক্স ফিঙ্গারপ্রিন্ট = নীরব মিস/স্টোর-ব্যর্থতা — কখনো থ্রো-পথ নয়
    const evil = '../../../etc/passwd';
    expect(await shotCacheLookup(evil, { validate: validateVideoBuffer })).toBeNull();
    expect(await shotCacheStore(evil, { buffer: fixtureMp4, model: 'm', taskId: 't', hasAudio: false })).toBe(false);

    // জমা-পরে ডিরেক্টরি-গাছে শুধু হেক্স-নাম
    await generateVideoClip({ ...BASE_REQ, prompt: 'hex check' });
    const names: string[] = [];
    for (const a of await readdir(root)) {
      for (const b of await readdir(path.join(root, a))) {
        for (const f of await readdir(path.join(root, a, b))) names.push(f);
      }
    }
    expect(names.length).toBe(2); // .mp4 + .meta.json
    for (const n of names) {
      expect(n).toMatch(/^([0-9a-f]{64}\.(mp4|meta\.json))$/); // কোনো ইনপুট-স্ট্রিং পথে নেই
    }
  });

  test('REG-10i: prewarm on a cached request resolves from cache — no submit', async () => {
    const root = await freshRoot();
    g.__shotCacheRootOverride = root;
    // প্রথমে ক্যাশে রাখি
    await generateVideoClip({ ...BASE_REQ });
    expect(submitCount).toBe(1);
    (g as any).__aiVideoGate = undefined;

    // প্রি-ওয়ার্ম একই অনুরোধে — ক্যাশ-হিট হওয়ার কারণে সাবমিট হয় না;
    // consumePrewarmedClip দিয়ে প্রি-ওয়ার্ম-ফল সরাসরি যাচাই
    prewarmVideoClip({ ...BASE_REQ, requestKey: 'reg10i-rk' });
    const warmed = consumePrewarmedClip('reg10i-rk');
    expect(warmed).toBeTruthy();
    const clip = await warmed!;
    expect(clip.fromCache).toBe(true);
    expect(submitCount).toBe(1); // প্রি-ওয়ার্মেও নতুন সাবমিট হয়নি
    expect(shotCacheStats().hits).toBeGreaterThanOrEqual(1);
  });

  test('REG-10j: counter honesty — exact final snapshot over a scripted scenario', async () => {
    const root = await freshRoot();
    g.__shotCacheRootOverride = root;
    await generateVideoClip({ ...BASE_REQ }); // miss+store
    await generateVideoClip({ ...BASE_REQ }); // hit
    (g as any).__aiVideoGate = undefined;
    await generateVideoClip({ ...BASE_REQ, prompt: 'different' }); // miss+store
    (g as any).__aiVideoGate = undefined;
    await generateVideoClip({ ...BASE_REQ, prompt: 'different' }, { bypassCache: true }); // bypass (no store)
    expect(shotCacheStats()).toEqual({
      hits: 1,
      joined: 0,
      misses: 2,
      bypass: 1,
      invalid: 0,
      stores: 2,
      evictions: 0,
      bytesStored: fixtureMp4.length * 2,
      entries: 2,
    });
  });
});
