// ============================================================
// Hardware Gate — নতুন পরিকল্পনা §১০ (হার্ডওয়্যার-সচেতন মডেল-ম্যানেজার)
//
// মূল নীতি:
//  - প্রতিটি রেজিস্ট্রি-মডেলের হার্ডওয়্যার-চাহিদা এক জায়গায় ঘোষিত
//    (cloud_sdk / local_engine / local_model — তিন শ্রেণি)।
//  - computeHardwareVerdicts() বাস্তব HardwareReport-এর বিপরীতে
//    প্রতিটি মডেলের জন্য §১০-এর ৯-অবস্থার রায় বের করে।
//  - রায় কখনোই "লাইসেন্স-অবরুদ্ধ" বলে না — লাইসেন্স ও হার্ডওয়্যার
//    সম্পূর্ণ আলাদা মাত্রা (লাইসেন্স রেজিস্ট্রিতে পৃথকভাবে থাকে)।
//  - cloud_sdk-পথে লোকাল হার্ডওয়্যার লাগে না — তাদের বাস্তব-স্বাস্থ্য
//    /api/system-এর মাইক্রো-চেক থেকে আসে, এই গেট থেকে নয়।
// ============================================================

import type { HardwareModelAssessment, HardwareReport, HardwareVerdict } from '@/lib/types';

/** প্রতি মডেলের হার্ডওয়্যার-চাহিদা — রেজিস্ট্রি-কী-ভিত্তিক */
export interface ModelHardwareRequirement {
  /** রেজিস্ট্রির (model-registry-data.ts) key-র সাথে মিলবে */
  modelKey: string;
  /** বাংলা প্রদর্শন-নাম */
  name: string;
  /** ন্যূনতম মোট RAM (GB) */
  minRamGb?: number;
  /** ন্যূনতম VRAM (GB) — GPU থাকলে কত দরকার */
  minVramGb?: number;
  /** GPU ছাড়া চলবে কি না */
  gpuRequired: boolean;
  /** লোকাল ওয়েট লাগলে তার পরিচয় + লাইসেন্স-ট্যাগ */
  localWeights?: string;
  /** কোন শ্রেণির নির্ভরতা */
  kind: 'cloud_sdk' | 'local_engine' | 'local_model';
  /** বাংলা টীকা (CPU-ভারী/ঝুঁকি/আনুমানিক-মান ইত্যাদি) */
  notesBn: string;
}

/** ইংরেজি সংখ্যা → বাংলা অঙ্ক (UI-facing স্ট্রিং-এ) */
function toBn(value: number | string): string {
  const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(value).replace(/[0-9]/g, d => BN_DIGITS[Number(d)]);
}

function fmtGb(v: number | undefined): string {
  return v == null ? '—' : toBn(v);
}

// ------------------------------------------------------------
// সব রেজিস্ট্রি-কী-এর হার্ডওয়্যার-চাহিদা (২৪ এন্ট্রি)
// ------------------------------------------------------------

export const MODEL_HARDWARE_REQUIREMENTS: ModelHardwareRequirement[] = [
  // ---- স্তর ১: ক্লাউড SDK-পথ — লোকাল হার্ডওয়্যার লাগে না ----
  {
    modelKey: 'platform-llm',
    name: 'Z.ai LLM (GLM)',
    gpuRequired: false,
    kind: 'cloud_sdk',
    notesBn: 'ক্লাউড-পথ — ৪২৯/রেট-লিমিটে withRetry+TemporarilyUnavailableError সামলায়।',
  },
  {
    modelKey: 'platform-vlm',
    name: 'Z.ai VLM (ছবি-বোঝা)',
    gpuRequired: false,
    kind: 'cloud_sdk',
    notesBn: 'ক্লাউড-পথ — লোকাল রিসোর্স কিছুই লাগে না।',
  },
  {
    modelKey: 'platform-imagegen',
    name: 'Z.ai Image Generation',
    gpuRequired: false,
    kind: 'cloud_sdk',
    notesBn: 'ক্লাউড-পথ।',
  },
  {
    modelKey: 'platform-imageedit',
    name: 'Z.ai Image Edit',
    gpuRequired: false,
    kind: 'cloud_sdk',
    notesBn: 'ক্লাউড-পথ।',
  },
  {
    modelKey: 'platform-image-search',
    name: 'Z.ai Image Search (ওয়েব-ছবি অনুসন্ধান)',
    gpuRequired: false,
    kind: 'cloud_sdk',
    notesBn: 'ক্লাউড-পথ + CLI-ফলব্যাক।',
  },
  {
    modelKey: 'platform-functions',
    name: 'Z.ai Functions (web_search + page_reader)',
    gpuRequired: false,
    kind: 'cloud_sdk',
    notesBn: 'ক্লাউড-পথ।',
  },
  {
    modelKey: 'platform-tts',
    name: 'Z.ai TTS (কণ্ঠ-প্রিসেট, ৭টি কণ্ঠ)',
    gpuRequired: false,
    kind: 'cloud_sdk',
    notesBn: 'ক্লাউড-পথ; §১১-অনুযায়ী ডিস্ক-ক্যাশ + in-flight ডিডুপ (tts-cache) চালু।',
  },
  {
    modelKey: 'platform-asr',
    name: 'Z.ai ASR (লিপিবদ্ধকরণ)',
    gpuRequired: false,
    kind: 'cloud_sdk',
    notesBn: 'ক্লাউড-পথ; ৩০ সে.-সীমায় ২৮ সে. চাঙ্কিং।',
  },
  {
    modelKey: 'platform-videogen',
    name: 'CogVideoX-3 (ক্লাউড ভিডিও-জেনারেশন)',
    gpuRequired: false,
    kind: 'cloud_sdk',
    notesBn: 'ক্লাউড-পথ — জেনারেশন সার্ভারে হয়, এখানে নয়।',
  },
  {
    modelKey: 'platform-video-audio',
    name: 'CogVideoX-3 নেটিভ অডিও (with_audio)',
    gpuRequired: false,
    kind: 'cloud_sdk',
    notesBn: 'ক্লাউড-পথ।',
  },

  // ---- স্তর ২: লোকাল ইঞ্জিন — CPU-তে চলে, হালকা RAM লাগে ----
  {
    modelKey: 'procedural-music-engine',
    name: 'প্রসিডিউরাল সংগীত-সংশ্লেষণ ইঞ্জিন',
    minRamGb: 0.3,
    gpuRequired: false,
    kind: 'local_engine',
    notesBn: 'CPU-ভারী (PCM গণিত) কিন্তু হালকা — ২ কোরে দ্রুত; বড় দৈর্ঘ্যে এক-কোর দীর্ঘক্ষণ ব্যস্ত থাকে।',
  },
  {
    modelKey: 'sound-design-engine',
    name: 'সাউন্ড-ডিজাইন ইঞ্জিন (অ্যাম্বিয়েন্স/ফোলে)',
    minRamGb: 0.3,
    gpuRequired: false,
    kind: 'local_engine',
    notesBn: 'CPU-ভারী সংশ্লেষণ + FFmpeg মিক্স — RAM-চাপ কম।',
  },
  {
    modelKey: 'ffmpeg',
    name: 'FFmpeg 7.1',
    minRamGb: 0.3,
    gpuRequired: false,
    kind: 'local_engine',
    notesBn: 'ট্রিভিয়াল — সিস্টেম বাইনারি, স্বাভাবিক মিডিয়া-প্রসেসিং রিসোর্স।',
  },
  {
    modelKey: 'sharp',
    name: 'sharp (libvips)',
    minRamGb: 0.3,
    gpuRequired: false,
    kind: 'local_engine',
    notesBn: 'ট্রিভিয়াল — ছবি-অপারেশন হালকা।',
  },
  {
    modelKey: 'noto-bengali-font',
    name: 'Noto Sans Bengali',
    gpuRequired: false,
    kind: 'local_engine',
    notesBn: 'ট্রিভিয়াল — ফন্ট-ফাইল, রানটাইম-রিসোর্স প্রায় শূন্য।',
  },

  // ---- স্তর ৩: লোকাল ওপেন-ওয়েট মডেল — GPU/বড় RAM/ওয়েট-ডাউনলোড লাগে ----
  {
    modelKey: 'musicgen',
    name: 'MusicGen (Meta)',
    minRamGb: 8,
    minVramGb: 8,
    gpuRequired: true,
    localWeights: 'facebook/musicgen — CC-BY-NC 4.0',
    kind: 'local_model',
    notesBn: 'GPU-ভিত্তিক নিউরাল সংগীত-মডেল; CPU-তে অত্যন্ত ধীর।',
  },
  {
    modelKey: 'ace-step',
    name: 'ACE-Step (গান-জেনারেশন প্রার্থী #১)',
    minVramGb: 10,
    gpuRequired: true,
    localWeights: 'ACE-Step checkpoint — Apache-2.0 রিপো, ওয়েট-শর্ত যাচাই বাকি',
    kind: 'local_model',
    notesBn: 'VRAM-চাহিদা আনুমানিক ~৮–১২GB (নির্দিষ্ট checkpoint বাছাই হয়নি — মান অনুমিত)।',
  },
  {
    modelKey: 'yue',
    name: 'YuE (গান-জেনারেশন প্রার্থী #২)',
    minVramGb: 4.5,
    gpuRequired: true,
    localWeights: 'YuE — CC-BY-NC 4.0',
    kind: 'local_model',
    notesBn: 'ন্যূনতম ~৪.৫GB VRAM (প্রকরণভেদে বেশি); লম্বা গানে ধাপে-ধাপে মেমরি জমে।',
  },
  {
    modelKey: 'demucs-uvr',
    name: 'Demucs / UVR (স্টেম-পৃথকীকরণ)',
    minRamGb: 4.5,
    gpuRequired: false,
    localWeights: 'Demucs checkpoint — কোড MIT, ওয়েট-শর্ত মডেলভেদে যাচাই বাকি',
    kind: 'local_model',
    notesBn: 'GPU লাগে না, কিন্তু CPU-তে অত্যন্ত ধীর ও ৪.১GB RAM-এ ঝুঁকি — স্যান্ডবক্স-ক্র্যাশ এড়াতে ইনস্টলই করা হয়নি; needs_model_download।',
  },
  {
    modelKey: 'wav2lip-sadtalker',
    name: 'Wav2Lip / SadTalker / MuseTalk (লিপ-সিঙ্ক প্রার্থী)',
    minVramGb: 4,
    gpuRequired: true,
    localWeights: 'Wav2Lip/SadTalker/MuseTalk checkpoint — প্রকল্পভেদে শর্ত আলাদা',
    kind: 'local_model',
    notesBn: '≈৪–১২GB VRAM (প্রকল্পভেদে); GPU না থাকলে অসম্ভব-সধীর।',
  },
  {
    modelKey: 'real-esrgan',
    name: 'Real-ESRGAN (AI আপস্কেলার)',
    minVramGb: 2,
    gpuRequired: true,
    localWeights: 'Real-ESRGAN checkpoint — BSD-3-Clause',
    kind: 'local_model',
    notesBn: 'ছোট VRAM-এও চলে (~২GB), কিন্তু এই স্যান্ডবক্সে GPU-ই নেই।',
  },
  {
    modelKey: 'cogvideox',
    name: 'CogVideoX (ওপেন-ওয়েট, স্ব-হোস্টেড)',
    minVramGb: 8,
    gpuRequired: true,
    localWeights: 'THUDM CogVideoX checkpoint — প্রকরণভেদে Apache-2.0 / CC-BY-NC',
    kind: 'local_model',
    notesBn: '৮–২৪GB+ VRAM (প্রকরণভেদে); ক্লাউড CogVideoX-3 (platform-videogen) আলাদা ও চালু।',
  },
  {
    modelKey: 'wan-video',
    name: 'Wan 2.x (স্ব-হোস্টেড ভিডিও জেনারেশন)',
    minVramGb: 24,
    gpuRequired: true,
    localWeights: 'Wan-Video checkpoint — রিপো Apache-2.0, checkpoint-শর্ত ভেদে যাচাই বাকি',
    kind: 'local_model',
    notesBn: '২৪GB+ VRAM — কনজিউমার GPU-তেও কঠিন; ক্লাউড-পথই বাস্তবসম্মত।',
  },
  {
    modelKey: 'mms-tts-ben',
    name: 'Meta MMS TTS — বাংলা (লোকাল প্রার্থী-shortlist)',
    minRamGb: 1.5,
    gpuRequired: false,
    localWeights: 'facebook/mms-tts-ben (VITS, ~১৫০MB) — CC-BY-NC 4.0; CPU-তে চালানো সম্ভব, তবে Python+torch রানটাইম লাগবে যা এই স্যান্ডবক্সে নেই',
    kind: 'local_model',
    notesBn: 'GPU লাগে না — CPU-তেই চলে; বাধা হলো Python+torch রানটাইম-অনুপস্থিতি ও ওয়েট-ইনস্টল না-হওয়া।',
  },
];

// ------------------------------------------------------------
// রায় গণনা — §১০-এর ৯-অবস্থার সেট থেকে হার্ডওয়্যার-মাত্রার রায়
// ------------------------------------------------------------

/**
 * বাস্তব হার্ডওয়্যার-পরিমাপের বিপরীতে প্রতিটি মডেলের রায়।
 * প্রাধিকার-ক্রম (নতুন পরিকল্পনা §১০):
 *   1. cloud_sdk → ready (লোকাল হার্ডওয়্যার লাগে না)
 *   2. local_engine → মোট RAM-সীমা পার হলে ready, নয়তো needs_more_ram
 *   3. local_model:
 *      a) GPU লাগবে ও GPU নেই → needs_gpu
 *      b) ন্যূনতম RAM-এর ঘাটতি → needs_more_ram
 *      c) নয়তো → needs_model_download (ওয়েট ডাউনলোড/ইনস্টল হয়নি, অ্যাডাপ্টার নেই)
 *         — ব্যতিক্রম: mms-tts-ben (Python+torch রানটাইম-অনুপস্থিতির বিশেষ ব্যাখ্যা)
 *
 * দ্রষ্টব্য: রায়ে কখনোই "লাইসেন্স-অবরুদ্ধ" শব্দ নেই — লাইসেন্স আলাদা মাত্রা
 * (রেজিস্ট্রির licenseStatus)।
 */
export function computeHardwareVerdicts(profile: HardwareReport): HardwareModelAssessment[] {
  return MODEL_HARDWARE_REQUIREMENTS.map(req => {
    const requires: HardwareModelAssessment['requires'] = {
      ...(req.minRamGb != null ? { minRamGb: req.minRamGb } : {}),
      ...(req.minVramGb != null ? { minVramGb: req.minVramGb } : {}),
      gpuRequired: req.gpuRequired,
      ...(req.localWeights != null ? { localWeights: req.localWeights } : {}),
    };

    const base = {
      modelKey: req.modelKey,
      name: req.name,
      requires,
    };

    // ১) ক্লাউড SDK-পথ — লোকাল হার্ডওয়্যার-চাহিদা নেই
    if (req.kind === 'cloud_sdk') {
      return {
        ...base,
        verdict: 'ready' as HardwareVerdict,
        reason: 'ক্লাউড-পথ, লোকাল হার্ডওয়্যার লাগে না — বাস্তব-স্বাস্থ্য /api/system-এ (মাইক্রো-চেক)।',
      };
    }

    // ২) লোকাল ইঞ্জিন — কেবল মোট RAM-সীমা যাচাই
    if (req.kind === 'local_engine') {
      const minRam = req.minRamGb ?? 0.3;
      const ok = profile.totalMemGb >= minRam;
      return {
        ...base,
        verdict: ok ? ('ready' as HardwareVerdict) : ('needs_more_ram' as HardwareVerdict),
        reason: ok
          ? `স্থানীয় ইঞ্জিন — ন্যূনতম ${fmtGb(minRam)}GB RAM লাগে, পাওয়া গেছে ${fmtGb(profile.totalMemGb)}GB। ${req.notesBn}`
          : `স্থানীয় ইঞ্জিন — ন্যূনতম ${fmtGb(minRam)}GB RAM লাগে, পাওয়া গেছে ${fmtGb(profile.totalMemGb)}GB।`,
      };
    }

    // ৩) লোকাল ওপেন-ওয়েট মডেল
    // ৩ক) GPU লাগবে কিন্তু নেই
    if (req.gpuRequired && !profile.gpu.present) {
      return {
        ...base,
        verdict: 'needs_gpu' as HardwareVerdict,
        reason: `GPU প্রয়োজন (ন্যূনতম ~${fmtGb(req.minVramGb)}GB VRAM) — ${profile.gpu.note} · CPU-কোর ${toBn(profile.cpuCores)}, RAM ${fmtGb(profile.totalMemGb)}GB।`,
        ...(FALLBACKS[req.modelKey] ? { fallback: FALLBACKS[req.modelKey] } : {}),
      };
    }

    // ৩খ) বিশেষ কেস — mms-tts-ben: হার্ডওয়্যার CPU-তেই চলে, বাধা রানটাইম+ওয়েট
    if (req.modelKey === 'mms-tts-ben') {
      return {
        ...base,
        verdict: 'needs_model_download' as HardwareVerdict,
        reason:
          'হার্ডওয়্যার-দিক থেকে CPU-তেই চলে (VITS ওয়েট ~১৫০MB, ~১.৫GB RAM), কিন্তু এই স্যান্ডবক্সে Python+torch রানটাইম নেই ও ওয়েট ইনস্টল করা হয়নি; অ্যাপ-অ্যাডাপ্টারও নেই। ব্যবহারকারীর নিজের CPU/GPU মেশিনে বাংলা TTS-এর সবচেয়ে বাস্তবসম্মত লোকাল প্রার্থী।',
        ...(FALLBACKS[req.modelKey] ? { fallback: FALLBACKS[req.modelKey] } : {}),
      };
    }

    // ৩গ) RAM-ঘাটতি
    if (req.minRamGb != null && profile.totalMemGb < req.minRamGb) {
      return {
        ...base,
        verdict: 'needs_more_ram' as HardwareVerdict,
        reason: `ন্যূনতম ${fmtGb(req.minRamGb)}GB RAM লাগে — পাওয়া গেছে ${fmtGb(profile.totalMemGb)}GB। ${req.notesBn}`,
        ...(FALLBACKS[req.modelKey] ? { fallback: FALLBACKS[req.modelKey] } : {}),
      };
    }

    // ৩ঘ) হার্ডওয়্যার পার হলেও ওয়েট ডাউনলোড/ইনস্টল হয়নি
    return {
      ...base,
      verdict: 'needs_model_download' as HardwareVerdict,
      reason: `হার্ডওয়্যার-সীমা পার হলেও ওয়েট ডাউনলোড/ইনস্টল করা হয়নি ও অ্যাপে অ্যাডাপ্টার নেই — needs_model_download। ${req.notesBn}`,
      ...(FALLBACKS[req.modelKey] ? { fallback: FALLBACKS[req.modelKey] } : {}),
    };
  });
}

// ------------------------------------------------------------
// সৎ বিকল্প-পথ (ম্যাট্রিক্সের সিদ্ধান্তের সাথে মিলবে)
// ------------------------------------------------------------

const FALLBACKS: Record<string, string> = {
  musicgen:
    'প্রসিডিউরাল ইনস্ট্রুমেন্টাল ইঞ্জিন (generate_instrumental) চালু — সৎ লেবেলসহ; নিজের গান আপলোডও সম্ভব।',
  'ace-step':
    'প্রসিডিউরাল ইনস্ট্রুমেন্টাল + লিরিক্স-ডকুমেন্ট (plan_music), অথবা নিজের রেকর্ড করা গান আপলোড।',
  yue: 'প্রসিডিউরাল ইনস্ট্রুমেন্টাল + লিরিক্স-ডকুমেন্ট (plan_music), অথবা নিজের রেকর্ড করা গান আপলোড।',
  'demucs-uvr': 'মিক্স-টুল দিয়ে ভলিউম/ডাকিং-সমন্বয় সম্ভব (পৃথকীকরণ ছাড়া)।',
  'wav2lip-sadtalker':
    'সংলাপ-অডিও (TTS) + AI-দৃশ্য আলাদাভাবে তৈরি হয়; অডিও-ভিডিও টাইমলাইন-সমলয় থাকে, মুখের নড়াচড়ার দাবি থাকে না।',
  'real-esrgan': 'sharp-lanczos আপস্কেল চালু (সৎ নোট: নতুন AI-ডিটেইল যোগ হয় না)।',
  cogvideox: 'ক্লাউড CogVideoX-3 (platform-videogen) ইতিমধ্যে চালু — স্ব-হোস্টিং GPU-সমৃদ্ধ ভবিষ্যৎ পরিবেশের বিকল্প।',
  'wan-video': 'ক্লাউড CogVideoX-3 (platform-videogen) চালু — স্ব-হোস্টিং GPU-সমৃদ্ধ ভবিষ্যৎ পরিবেশের বিকল্প।',
  'mms-tts-ben':
    'ক্লাউড TTS (platform-tts — jam/douji কণ্ঠ) এখন চালু; বাংলায় মানব-প্রিভিউ বাধ্যতামূলক ও গুণমান-বেঞ্চমার্ক চলছে।',
};
