// ============================================================
// Provider Adapter Layer — types (Phase 1, Railway+HF প্রস্তুতি)
//
// উদ্দেশ্য (Phase 0 অডিট B-D1): সব AI-ক্ষমতার জন্য সুস্পষ্ট ইন্টারফেস
// ও সৎ-অবস্থা সংজ্ঞা — যাতে স্যান্ডবক্স-নির্দিষ্ট z-ai-web-dev-sdk
// প্রমাণীকরণ আর প্রতিটি পাইপলাইনের সরাসরি নির্ভরতা না হয়ে ওঠে।
//
// স্থাপত্য (মাস্টার-প্রম্পট Service 3):
//   capability interface (এই ফাইল)
//     ↑ ইমপ্লিমেন্ট করে
//   adapter (বর্তমান: sandbox-zai / google-translate-tts / edge-tts /
//            procedural-music — সবই যাচাইকৃত; Phase 3: HF-router)
//     ↑ নির্বাচন করে
//   registry.ts (কোন ক্ষমতায় কোন অ্যাডাপ্টার সক্রিয়, সৎ রিপোর্টসহ)
//
// নিয়ম:
//  - শুধু যাচাইকৃত প্রদানকারীর অ্যাডাপ্টার বলা যায় "available"।
//  - unsupported (ক্ষমতা কোথাও নেই) ≠ unavailable (এই পরিবেশে নেই)
//    ≠ error (কল ব্যর্থ) — তিনটি আলাদা সত্য।
//  - ভবিষ্যৎ HF-অ্যাডাপ্টার যুক্ত হলে ইন্টারফেস-চুক্তি অপরিবর্তিত থাকবে।
// ============================================================

/** রেপোতে ব্যবহৃত প্রকৃত AI-ক্ষমতাগুলোর স্থিতিশীল কী */
export type CapabilityKey =
  | 'chat' // চ্যাট + সৃজনশীল পরিকল্পনা (LLM)
  | 'image_generation' // টেক্সট → ছবি
  | 'image_editing' // ছবি সম্পাদনা (প্রম্পট-নির্দেশিত)
  | 'image_search' // ওয়েব-ছবি অনুসন্ধান
  | 'vision_analysis' // ছবি বর্ণনা/তুলনা (VLM)
  | 'speech_tts' // কথা-TTS (en/zh — স্যান্ডবক্স-SDK কণ্ঠ)
  | 'bengali_tts' // বাংলা কথা-TTS (Edge → Google-ফলব্যাক চেইন)
  | 'asr' // অডিও → লেখা (ASR)
  | 'instrumental_music' // ইনস্ট্রুমেন্টাল সংগীত (প্রসিডিউরাল — সৎ-লেবেলসহ)
  | 'sung_vocals' // গাওয়া কণ্ঠ / পূর্ণ-গান
  | 'video_generation' // AI ভিডিও (t2v/i2v)
  | 'lip_sync'; // লিপ-সিঙ্ক (কথা/গান)

/** সৎ-অবস্থা — তিনটি সত্য কখনো গুলবে না */
export type CapabilityStatus =
  | 'available' // এই পরিবেশে যাচাইকৃতভাবে কর্মরত
  | 'unavailable' // ইমপ্লিমেন্টেশন আছে, কিন্তু এই পরিবেশে প্রদানকারী-প্রমাণীকরণ/নেটওয়ার্ক নেই
  | 'unsupported'; // কোনো যাচাইকৃত প্রদানকারীই নেই (কোড-বাধা সৎ)

export interface CapabilityReport {
  key: CapabilityKey;
  /** বাংলা লেবেল (UI/ডকে ব্যবহারযোগ্য) */
  label: string;
  status: CapabilityStatus;
  /** সক্রিয় প্রদানকারীর স্থিতিশীল নাম */
  provider: string;
  /** সত্য হলে এই ক্ষমতা শুধু স্যান্ডবক্স-প্রমাণীকরণে চলে (.z-ai-config) */
  sandboxOnly: boolean;
  /** সত্য হলে Railway-ধরনের পরিবেশেও কোনো কোড-পরিবর্তন ছাড়াই চলে */
  portable: boolean;
  /** সীমা/শর্ত/বিকল্পের সৎ ব্যাখ্যা */
  honestNote: string;
  /** কী হলে খোলে (Phase 3 HF-router / পেইড key / GPU) */
  unblockPath: string;
}

// ------------------------------------------------------------
// অ্যাডাপ্টার-ইন্টারফেস (Phase 3-এ HF-অ্যাডাপ্টার এই চুক্তিতেই বসবে)
//
// বর্তমান ইমপ্লিমেন্টেশন প্রতিটি ইন্টারফেসের নোটে উল্লেখ করা —
// অ্যাডাপ্টারগুলো পাতলা প্রতিনিধি (delegate), যুক্তিবিদ্যার পুনর্লিখন নয়।
// ------------------------------------------------------------

/** ন্যূনতম চ্যাট-বার্তা গঠন (llm.ts-এর LLMMessage-এর সাথে কাঠামগতভাবে সামঞ্জস্যপূর্ণ) */
export interface ProviderChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** চ্যাট + পরিকল্পনা। ইমপ্লিমেন্ট: sandbox-zai (src/lib/agent/llm.ts getZAI-পথ),
 *  external-GLM (src/lib/agent/external-llm.ts — ইউজার-কী, পোর্টেবল)।
 *  Phase 3: HuggingFaceRouterChatAdapter (router.huggingface.co, OpenAI-সামঞ্জস্য)। */
export interface ChatProviderAdapter {
  complete(messages: ProviderChatMessage[]): Promise<string>;
}

/** ছবি-জেনারেশন। ইমপ্লিমেন্ট: sandbox-zai (sdk-helpers.generateImageBuffer)।
 *  Phase 3: HF-router text-to-image। */
export interface ImageProviderAdapter {
  generate(prompt: string, size: string): Promise<{ buffer: Buffer; size: string }>;
}

/** ASR। ইমপ্লিমেন্ট: sandbox-zai (sdk-helpers.transcribeBuffer)।
 *  Phase 3-প্রার্থী: HF-router speech-to-text (Whisper-শ্রেণি) — বাংলা-লিপি
 *  যাচাইয়ের সীমা-উত্তোলনের একমাত্র প্রমাণিত-সম্ভাবনা পথ। */
export interface AsrProviderAdapter {
  transcribe(buffer: Buffer, ext?: string): Promise<string>;
}

/** বাংলা কথা-TTS। ইমপ্লিমেন্ট: Edge-নিউরাল → Google-Translate সৎ-ফলব্যাক
 *  (src/lib/agent/audio/edge_tts.ts, google_tts.ts — উভয়ই পোর্টেবল কোড)।
 *  লক্ষণীয়: HF Inference Providers-এ TTS-ক্ষমতা নেই (Phase 0 §6-যাচাই)। */
export interface BengaliTtsProviderAdapter {
  synthesize(text: string, opts?: { voice?: string; speed?: number }): Promise<{
    buffer: Buffer;
    mimeType: string;
    ext: string;
    provider: string;
  }>;
}

/** ইনস্ট্রুমেন্টাল সংগীত। ইমপ্লিমেন্ট: প্রসিডিউরাল সংশ্লেষণ v2
 *  (src/lib/agent/audio/music_engine.ts — পোর্টেবল, [PROCEDURAL_INSTRUMENTAL]
 *  সৎ-লেবেলসহ; নিউরাল-নয়, গাওয়া-নয়)। */
export interface InstrumentalMusicProviderAdapter {
  synthesize(spec: { mood: string; durationSec: number }): Promise<{
    buffer: Buffer;
    mimeType: string;
    honestLabel: string;
  }>;
}

/** AI ভিডিও (t2v/i2v)। ইমপ্লিমেন্ট: sandbox-zai CogVideoX-3
 *  (src/lib/agent/video/ai_video.ts — এক-টাস্ক-সচেতন গেটসহ)।
 *  Phase 3: HF-router text-to-video (fal/Replicate-হোস্ট, ব্যয়-সীমা-সহ)। */
export interface VideoProviderAdapter {
  generateClip(input: {
    prompt: string;
    durationSec: number;
    imageUrl?: string;
    withAudio?: boolean;
    requestId: string;
  }): Promise<{ buffer: Buffer; mime: string }>;
}

/** গাওয়া কণ্ঠ / পূর্ণ-গান — কোনো যাচাইকৃত প্রদানকারী নেই (BLOCKED)।
 *  প্রার্থী: ACE-Step 1.5 (MIT) — fal/Replicate-হোস্ট, পেইড + বাংলা-গাওয়ার
 *  লাইভ-যাচাই বাধ্যতামূলক (docs/audit/latest-fix/singing-provider-research.md)। */
export interface SungVocalsProviderAdapter {
  synthesizeSong(input: {
    lyrics: string;
    stylePrompt: string;
    durationSec: number;
  }): Promise<{ audioBuffer: Buffer; honestLabel: string }>;
}

/** লিপ-সিঙ্ক — কোনো যাচাইকৃত প্রদানকারী নেই (BLOCKED, ৪-মাত্রিক;
 *  src/lib/agent/video/lip_sync_module.ts-এর সৎ-ঘোষণাই সত্য)। */
export interface LipSyncProviderAdapter {
  applyLipSync(input: {
    videoArtifactPath: string;
    audioArtifactPath: string;
    isSinging: boolean;
  }): Promise<{ videoBuffer: Buffer }>;
}
