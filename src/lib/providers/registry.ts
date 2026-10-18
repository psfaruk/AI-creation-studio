// ============================================================
// Provider Adapter Layer — capability registry (Phase 1)
//
// কোন ক্ষমতায় এখন কোন অ্যাডাপ্টার সক্রিয়, তার একক সত্যের উৎস
// (কোড-স্তরে)। UI-র বিস্তারিত ম্যাট্রিক্স
// (src/lib/agent/availability-matrix.ts) এর পরিপূরক — সে টুল/মডেল-স্তরের
// বিবরণ, এটি প্রদানকারী-নির্বাচন/প্রিফ্লাইট-স্তরের।
//
// সততা-নিয়ম (Phase 0 §6 + latest-fix প্রমাণ):
//  - "available" বলতে এই পরিবেশে লাইভ-যাচাইকৃত প্রদানকারী।
//  - sung_vocals/lip_sync সবসময় unsupported — কোনো প্রদানকারী নেই।
//  - HF Inference Providers সম্পর্কে কোনো "available" দাবি নেই — Phase 3
//    অ্যাডাপ্টার + বাজেট-অনুমোদিত লাইভ-প্রোবের আগে কিছুই দাবি করা হয় না।
// ============================================================

import { zAiConfigured } from './sandbox-detect';
import type { CapabilityKey, CapabilityReport, CapabilityStatus } from './types';

/** স্যান্ডবক্স-SDK-নির্ভর ক্ষমতার তালিকা (zAiConfigured() দিয়ে সনাক্ত) */
const SANDBOX_CAPS: CapabilityKey[] = [
  'chat',
  'image_generation',
  'image_editing',
  'image_search',
  'vision_analysis',
  'speech_tts',
  'asr',
  'video_generation',
];

/** পোর্টেবল ক্ষমতা — স্যান্ডবক্স-প্রমাণীকরণ ছাড়াই চলে (কোড যাচাইকৃত) */
const PORTABLE: Partial<Record<CapabilityKey, string>> = {
  bengali_tts: 'edge-neural → google-translate-fallback (bn চেইন)',
  instrumental_music: 'procedural-engine-v2 [PROCEDURAL_INSTRUMENTAL]',
};

interface CapabilityMeta {
  label: string;
  provider: string;
  honestNote: string;
  unblockPath: string;
}

const META: Record<CapabilityKey, CapabilityMeta> = {
  chat: {
    label: 'চ্যাট + সৃজনশীল পরিকল্পনা (LLM)',
    provider: 'sandbox-zai (SDK)',
    honestNote:
      'ডিফল্ট পথ z-ai SDK। পোর্টেবল বিকল্প এখনই আছে: মডেল-সিলেক্টরে ইউজার-কীসহ external GLM (Z.ai API / BigModel — external-llm.ts, OpenAI-সামঞ্জস্য)। ডিস্ক-ক্যাশ-হিটও প্রমাণীকরণ ছাড়াই কাজ করে।',
    unblockPath: 'Phase 3: HF-router চ্যাট-অ্যাডাপ্টার (router.huggingface.co, OpenAI-সামঞ্জস্য) — লাইভ-প্রোব-পরে।',
  },
  image_generation: {
    label: 'টেক্সট → ছবি',
    provider: 'sandbox-zai (SDK)',
    honestNote: 'গল্প-বোর্ড/চরিত্র-পোর্ট্রেট/শট-ফলব্যাকে ব্যবহৃত; স্যান্ডবক্স-প্রমাণীকরণ-নির্ভর।',
    unblockPath: 'Phase 3: HF-router text-to-image (fal/Replicate/Together-হোস্ট)।',
  },
  image_editing: {
    label: 'ছবি সম্পাদনা',
    provider: 'sandbox-zai (SDK)',
    honestNote: 'sdk-helpers.editImageBuffer — স্যান্ডবক্স-প্রমাণীকরণ-নির্ভর।',
    unblockPath: 'Phase 3: HF-router text-to-image (img2img-ধরন)।',
  },
  image_search: {
    label: 'ওয়েব-ছবি অনুসন্ধান',
    provider: 'sandbox-zai (SDK + CLI ফলব্যাক)',
    honestNote: 'উভয় পথই একই প্রমাণীকরণ পড়ে — স্যান্ডবক্স-নির্ভর।',
    unblockPath: 'Phase 3-প্রার্থী: পৃথক ওয়েব-সার্চ প্রদানকারী (HF-এ নয়)।',
  },
  vision_analysis: {
    label: 'ছবি বর্ণনা/তুলনা (VLM)',
    provider: 'sandbox-zai (SDK)',
    honestNote: 'ধারাবাহিকতা-যাচাই/পোর্ট্রেট-বিশ্লেষণে ব্যবহৃত।',
    unblockPath: 'Phase 3: HF-router chat-completion (VLM) প্রার্থী।',
  },
  speech_tts: {
    label: 'কথা-TTS (en/zh — SDK কণ্ঠ)',
    provider: 'sandbox-zai (SDK, ৭ কণ্ঠ)',
    honestNote: '৭ কণ্ঠই en/zh-সক্ষম, বাংলা-অসক্ষম (bn-চেইনে নিষিদ্ধ — R-FIX-1)।',
    unblockPath: 'Phase 3+: বাংলা-TTS-এর জন্য পৃথক প্রদানকারী (HF-router-এ TTS নেই)।',
  },
  bengali_tts: {
    label: 'বাংলা কথা-TTS (bn)',
    provider: 'edge-neural → google-translate-fallback',
    honestNote:
      'কোড-পোর্টেবল। এই স্যান্ডবক্সে Edge WSS 403 (নেটওয়ার্ক-পাশ) → Google-Translate সৎ-ফলব্যাক লাইভ-যাচাইকৃত (একক কণ্ঠ, অপ্রাতিষ্ঠানিক endpoint, SLA নেই)। Railway-নেটওয়ার্ক থেকে Edge আবার খুলতে পারে — Phase 4 লাইভ-পুনঃপরীক্ষা বাধ্যতামূলক।',
    unblockPath: 'Phase 4: Railway-নেটওয়ার্ক থেকে Edge-পুনঃপরীক্ষা; চাইলে পেইড bn-TTS প্রদানকারী-প্রোব (মালিকের বাজেট-অনুমোদনে)।',
  },
  asr: {
    label: 'অডিও → লেখা (ASR)',
    provider: 'sandbox-zai (SDK)',
    honestNote: 'en/zh ভালো; বাংলা চীনা-অনুবাদে ফেরে (script-preserving নয়) — bn-রায় সর্বোচ্চ AUDIO_VALIDATION_ONLY।',
    unblockPath: 'Phase 3-প্রার্থী: HF-router speech-to-text (Whisper-শ্রেণি) — bn-লিপি-যাচাই উত্তোলনের একমাত্র প্রমাণিত-সম্ভাবনা পথ।',
  },
  instrumental_music: {
    label: 'ইনস্ট্রুমেন্টাল সংগীত',
    provider: 'procedural-engine-v2 (local)',
    honestNote: 'নিউরাল-নয়, গাওয়া-নয় — প্রতিটি আর্টিফ্যাক্টে [PROCEDURAL_INSTRUMENTAL] সৎ-লেবেল (LF-2)। পুরোপুরি পোর্টেবল, বাইরের সেবা লাগে না।',
    unblockPath: 'ঐচ্ছিক ভবিষ্যৎ: MusicGen-শ্রেণির নিউরাল প্রদানকারী (পেইড) — সৎ-লেবেল-নীতি অপরিবর্তিত থাকবে।',
  },
  sung_vocals: {
    label: 'গাওয়া কণ্ঠ / পূর্ণ-গান',
    provider: '(কোনো যাচাইকৃত প্রদানকারী নেই)',
    honestNote:
      'BLOCKED — সব ভোকাল-সক্ষম API key+পেমেন্ট; HF Inference-এ lyrics-to-song নেই; লোকাল মডেল GPU-চাহিত (singing-provider-research.md)। বাংলা-গাওয়ার লাইভ-যাচাই + মানব-শ্রবণ বাধ্যতামূলক।',
    unblockPath: 'মালিকের বাজেট-অনুমোদনে ACE-Step 1.5 (MIT, fal/Replicate-হোস্ট ~$0.02/রান) + বাংলা-লাইভ-যাচাই।',
  },
  video_generation: {
    label: 'AI ভিডিও (t2v/i2v)',
    provider: 'sandbox-zai (CogVideoX-3)',
    honestNote: 'লাইভ-যাচাইকৃত (৫/১০ সে. শট; এক-ইন-ফ্লাইট-টাস্ক + ~২.২ মিনিট কুলডাউন) — স্যান্ডবক্স-প্রমাণীকরণ-নির্ভর।',
    unblockPath: 'Phase 3: HF-router text-to-video (fal/Replicate-হোস্ট CogVideoX/Wan-শ্রেণি) — প্রতি-সেকেন্ড মূল্য আগে সীমাবদ্ধ প্রোবে যাচাই।',
  },
  lip_sync: {
    label: 'লিপ-সিঙ্ক (কথা/গান)',
    provider: '(কোনো যাচাইকৃত প্রদানকারী নেই)',
    honestNote:
      'BLOCKED (৪-মাত্রিক) — Wav2Lip একাডেমিক-কেবল; MuseTalk 1.5 MIT ও SadTalker Apache-2.0 হলেও প্রদানকারী (সব key+পেমেন্ট) + GPU + অ্যাডাপ্টার বাধা বহাল (lipsync-provider-research.md)।',
    unblockPath: 'মালিকের বাজেট-অনুমোদনে হোস্টেড লিপ-সিঙ্ক API (~$0.05–0.14/রান) বা GPU + MuseTalk — bn-বেঞ্চমার্ক আগে।',
  },
};

/**
 * সব ক্ষমতার সৎ রিপোর্ট। স্যান্ডবক্স-SDK-নির্ভর ক্ষমতাগুলোর অবস্থা
 * zAiConfigured() দিয়ে রানটাইমে নির্ণীত হয়; বাকিগুলো স্থির সত্য।
 *
 * @param opts.sandboxConfigured টেস্ট-ইনজেকশন (নির্দিষ্ট পরিবেশ-মোড
 *   সিমুলেট; না দিলে প্রকৃত সনাক্তকরণ) — mock-free টেস্টযোগ্যতার জন্য।
 */
export function getCapabilityReports(opts?: { sandboxConfigured?: boolean }): CapabilityReport[] {
  const sandboxOk = opts && typeof opts.sandboxConfigured === 'boolean' ? opts.sandboxConfigured : zAiConfigured();
  const statusOf = (key: CapabilityKey): CapabilityStatus => {
    if (key === 'sung_vocals' || key === 'lip_sync') return 'unsupported';
    if (SANDBOX_CAPS.includes(key)) return sandboxOk ? 'available' : 'unavailable';
    return 'available'; // পোর্টেবল ক্ষমতা (bengali_tts / instrumental_music)
  };
  return (Object.keys(META) as CapabilityKey[]).map(key => {
    const meta = META[key];
    return {
      key,
      label: meta.label,
      status: statusOf(key),
      provider: meta.provider,
      sandboxOnly: SANDBOX_CAPS.includes(key),
      portable: key in PORTABLE,
      honestNote: meta.honestNote,
      unblockPath: meta.unblockPath,
    };
  });
}

/** একক ক্ষমতার রিপোর্ট (না পেলে undefined — কল্পনা নয়) */
export function getCapabilityReport(key: CapabilityKey, opts?: { sandboxConfigured?: boolean }): CapabilityReport | undefined {
  return getCapabilityReports(opts).find(r => r.key === key);
}

/**
 * প্রিফ্লাইট: ক্ষমতাটি এই পরিবেশে আছে কি না — সংক্ষিপ্ত সৎ-ব্যর্থতা।
 * (পাইপলাইন-গার্ডের জন্য; কোনো নেটওয়ার্ক-কল হয় না।)
 */
export function assertCapabilityPresent(key: CapabilityKey, opts?: { sandboxConfigured?: boolean }): void {
  const report = getCapabilityReport(key, opts);
  if (!report) throw new Error(`অজানা ক্ষমতা-কী: ${key}`);
  if (report.status === 'available') return;
  if (report.status === 'unsupported') {
    throw new Error(`UNSUPPORTED: ${report.label} — ${report.honestNote}`);
  }
  throw new Error(
    `PROVIDER_UNAVAILABLE: ${report.label} — এই পরিবেশে সক্রিয় প্রদানকারী নেই। ${report.unblockPath}`
  );
}
