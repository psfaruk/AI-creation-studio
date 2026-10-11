// ============================================================
// scripts/gen-feature-matrix.ts
// চালান: `bun scripts/gen-feature-matrix.ts`
//
// উদ্দেশ্য: docs/FEATURE_MATRIX.json — মেশিন-পাঠযোগ্য ফিচার-ম্যাট্রিক্স —
// লাইভ সোর্স মডিউল থেকে পুনর্জেনারেট করা।
//
// ইনপুট (আপেক্ষাকৃত ইমপোর্ট — bun স্বতন্ত্র স্ক্রিপ্টে '@/...' path-alias
// ডিফল্টে সমাধান করে না বলে আপেক্ষিক পথ ব্যবহার করা হয়েছে):
//   - TOOL_CATALOG            ← ../src/lib/types.ts (শেয়ার্ড চুক্তি)
//   - AVAILABILITY_MATRIX /
//     availabilityMatrixResponse ← ../src/lib/agent/availability-matrix.ts
//   - MODEL_SEED              ← ../src/lib/agent/model-registry-data.ts
//
// টুল → বাস্তবায়ন-ম্যাপিং (IMPLEMENTATION_MAP) নিচে হার্ডকোড করা —
// এটি src/lib/agent/registry.ts ও src/lib/agent/tools/*.ts পড়ে
// যাচাই করা সারণির আয়না (S8-2a অডিট, ২০২৬-১০-১১)। registry বদলালে
// এই ম্যাপও হালনাগাদ করতে হবে।
// ============================================================

import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TOOL_CATALOG } from '../src/lib/types';
import {
  AVAILABILITY_MATRIX,
  availabilityMatrixResponse,
} from '../src/lib/agent/availability-matrix';
import { MODEL_SEED } from '../src/lib/agent/model-registry-data';

type Implementation =
  | 'sdk_cloud' // z-ai-web-dev-sdk ক্লাউড API (LLM/VLM/TTS/ASR/ছবি/ভিডিও)
  | 'local_engine' // স্থানীয় সংশ্লেষণ/বিশ্লেষণ ইঞ্জিন (PCM, sharp, Prisma)
  | 'ffmpeg' // স্থানীয় FFmpeg 7.1 র‍্যাপার
  | 'honest_gated' // সৎ structured error — এই পরিবেশে চালু নয়
  | 'planning_only'; // পরিকল্পনা/নিশ্চিতকরণ — কোনো জেনারেশন নয়

interface ImplementationInfo {
  implementation: Implementation;
  /** ফাইল + হ্যান্ডলার/স্পেক — registry.ts ও tools/*.ts থেকে যাচাইকৃত */
  implementationFile: string;
  /** হাইব্রিড/ফলব্যাক পথের সৎ নোট (ঐচ্ছিক) */
  implementationNote?: string;
}

/**
 * টুল-নাম → বাস্তবায়ন। সোর্স: src/lib/agent/registry.ts (CORE_TOOLS) +
 * src/lib/agent/tools/{image,audio,video,production}.ts — S8-2a অডিটে
 * প্রতিটি ফাইল পড়ে ম্যাপ করা হয়েছে।
 */
const IMPLEMENTATION_MAP: Record<string, ImplementationInfo> = {
  // ---- CORE_TOOLS — src/lib/agent/registry.ts ----
  web_search: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/registry.ts → webSearchSpec → zai.functions.invoke("web_search")',
  },
  read_web_page: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/registry.ts → readWebPageSpec → zai.functions.invoke("page_reader") + stripHtml',
  },
  generate_image: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/registry.ts → generateImageSpec → zai.images.generations.create',
  },
  search_images: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/registry.ts → searchImagesSpec → sdk-helpers.imageSearchSdkFirst',
    implementationNote: 'SDK zai.images.search প্রাথমিক; ব্যর্থ হলে CLI (z-ai image-search) ফলব্যাক — resultJson-এ via: "sdk"|"cli"',
  },
  analyze_image: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/registry.ts → analyzeImageSpec → zai.chat.completions.createVision (VLM)',
  },
  text_to_speech: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/registry.ts → textToSpeechSpec → zai.audio.tts.create',
    implementationNote: 'mp3 চেষ্টা → সার্ভার না নিলে (কোড ১২১৪) wav-এ সৎ ফলব্যাক; RIFF-হেডার স্নিফ করে mime ঠিক করে',
  },
  transcribe_audio: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/registry.ts → transcribeAudioSpec → zai.audio.asr.create',
    implementationNote: 'বাংলা অডিওতে ASR দুর্বল — ট্রান্সক্রিপ্ট উপদেশমূলক',
  },
  search_conversations: {
    implementation: 'local_engine',
    implementationFile: 'src/lib/agent/registry.ts → searchConversationsSpec → Prisma/SQLite কন্টেন্ট-সার্চ',
  },

  // ---- IMAGE_TOOLS — src/lib/agent/tools/image.ts ----
  edit_image: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/tools/image.ts → editImageSpec → sdk-helpers.editImageBuffer (zai.images.generations.edit)',
  },
  inpaint_image: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/tools/image.ts → inpaintImageSpec → editImageBuffer (inpaint-প্রম্পট)',
  },
  remove_background: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/tools/image.ts → removeBackgroundSpec → editImageBuffer',
  },
  remove_object: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/tools/image.ts → removeObjectSpec → editImageBuffer',
  },
  restyle_image: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/tools/image.ts → restyleImageSpec → editImageBuffer (image-to-image)',
  },
  enhance_image: {
    implementation: 'local_engine',
    implementationFile: 'src/lib/agent/tools/image.ts → enhanceImageSpec → sharp (lanczos + median + sharpen)',
    implementationNote: 'সৎ লেবেল: ক্লাসিক্যাল রিসাইজ/শার্পেন — নতুন AI-ডিটেইল নয়',
  },
  color_grade_image: {
    implementation: 'local_engine',
    implementationFile: 'src/lib/agent/tools/image.ts → colorGradeImageSpec → sharp (modulate/gamma/linear)',
  },
  transform_image: {
    implementation: 'local_engine',
    implementationFile: 'src/lib/agent/tools/image.ts → transformImageSpec → sharp (crop/resize/rotate/flip)',
  },
  compose_text_image: {
    implementation: 'local_engine',
    implementationFile: 'src/lib/agent/tools/image.ts → composeTextImageSpec → SVG + Noto Sans Bengali + sharp রেন্ডার',
    implementationNote: 'বেস-পোস্টার ছবি না দিলে SDK generateImageBuffer দিয়ে তৈরি হতে পারে; টাইপোগ্রাফি সম্পূর্ণ লোকাল',
  },
  export_image: {
    implementation: 'local_engine',
    implementationFile: 'src/lib/agent/tools/image.ts → exportImageSpec → sharp (png/jpeg/webp রপ্তানি)',
  },
  inspect_image: {
    implementation: 'local_engine',
    implementationFile: 'src/lib/agent/tools/image.ts → inspectImageSpec → sharp মেটাডেটা + visionAnalyze (VLM গুণমান-মূল্যায়ন)',
    implementationNote: 'হাইব্রিড: মেটাডেটা-পরীক্ষা লোকাল (sharp), গুণমান-মূল্যায়ন ক্লাউড VLM',
  },

  // ---- AUDIO_TOOLS — src/lib/agent/tools/audio.ts ----
  plan_music: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/tools/audio.ts → planMusicSpec → chatJson (LLM STRICT-JSON) → song-plan.txt',
  },
  speech_synthesis: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/tools/audio.ts → speechSynthesisSpec → audio/language_controller.synthesizeVerifiedSpeech (TTS → দৈর্ঘ্য-যাচাই → ASR ব্যাক-চেক → রায়)',
    implementationNote: 'TTS/ASR ক্লাউড; ভাষা-শনাক্তকরণ ও রায়-লজিক লোকাল; bn-রায় সবসময় "সতর্কতা" + মানব-প্রিভিউ বাধ্যতামূলক',
  },
  analyze_audio: {
    implementation: 'local_engine',
    implementationFile: 'src/lib/agent/tools/audio.ts → analyzeAudioSpec → audio/music_engine.analyzeAudioEnergy (FFmpeg ডিকোড → PCM RMS-হপ বিশ্লেষণ)',
    implementationNote: 'সৎ নোট: এনার্জি-ভিত্তিক সরলীকৃত বিট-ট্র্যাকিং — নিখুঁত নয়',
  },
  generate_instrumental: {
    implementation: 'local_engine',
    implementationFile: 'src/lib/agent/tools/audio.ts → generateInstrumentalSpec → audio/music_engine.synthesizeInstrumental (প্রসিডিউরাল PCM) + validateInstrumental',
    implementationNote: 'প্রসিডিউরাল সংশ্লেষণ — MusicGen-ধর্মী নিউরাল মডেল নয় (সৎ লেবেলসহ)',
  },
  generate_singing: {
    implementation: 'honest_gated',
    implementationFile: 'src/lib/agent/tools/audio.ts → generateSingingSpec → throw GATE_SINGING (সৎ structured error + বিকল্প)',
    implementationNote: 'প্রকৃত বাধা: GPU নেই + SDK-তে গান-জেনারেশন API নেই (লাইসেন্স নয় — ACE-Step/YuE অ-বাণিজ্যিকে অনুমোদিত)',
  },
  separate_stems: {
    implementation: 'honest_gated',
    implementationFile: 'src/lib/agent/tools/audio.ts → separateStemsSpec → throw GATE_STEMS (সৎ structured error + বিকল্প)',
    implementationNote: 'প্রকৃত বাধা: Demucs/UVR মডেল-ইনস্টল নেই + CPU/RAM-সীমা; কিছু checkpoint-লাইসেন্স যাচাই বাকি (needs_review)',
  },
  process_audio: {
    implementation: 'ffmpeg',
    implementationFile: 'src/lib/agent/tools/audio.ts → processAudioSpec → runFfmpeg (৯টি op; টেম্প-ডিরেক্টরি + finally-cleanup)',
  },
  mix_audio: {
    implementation: 'ffmpeg',
    implementationFile: 'src/lib/agent/tools/audio.ts → mixAudioSpec → runFfmpeg (aformat/afade/adelay/sidechaincompress/amix/alimiter — সময়-সংযুক্ত ডাকিং)',
  },
  validate_audio: {
    implementation: 'ffmpeg',
    implementationFile: 'src/lib/agent/tools/audio.ts → validateAudioSpec → runFfmpeg (astats + silencedetect + নিজস্ব নির্ভুল ebur128 পাস)',
  },
  inspect_media: {
    implementation: 'ffmpeg',
    implementationFile: 'src/lib/agent/tools/audio.ts → inspectMediaSpec → mediaInfo (ffprobe JSON)',
  },

  // ---- VIDEO_TOOLS — src/lib/agent/tools/video.ts ----
  plan_video: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/tools/video.ts → planVideoSpec → shotPlanFromLLM (chatJson LLM শট-তালিকা)',
  },
  generate_video: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/tools/video.ts → generateVideoSpec → video/ai_video.generateVideoClip (CogVideoX-3, withAudio, requestKey) + FFmpeg স্বাভাবিকীকরণ',
    implementationNote: 'ইঞ্জিন ai_diffusion (ডিফল্ট) বা cinematic_motion; AI-শট ব্যর্থ হলে সৎ-লেবেলসহ Ken Burns ফলব্যাক; native_ai সাউন্ডে প্রকৃত AAC',
  },
  image_to_video: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/tools/video.ts → imageToVideoSpec → video/ai_video.generateVideoClip (CogVideoX-3 image-to-video, data-URL ইনপুট)',
    implementationNote: 'দুই বার ব্যর্থ হলে সৎ ত্রুটি + animate_image-এর সুপারিশ (লুকানো ফলব্যাক নয়)',
  },
  animate_image: {
    implementation: 'ffmpeg',
    implementationFile: 'src/lib/agent/tools/video.ts → animateImageSpec → film-helpers.kenBurnsClip (zoompan, ২x ওভারস্যাম্পল)',
    implementationNote: 'ক্যামেরা-মোশন অ্যানিমেশন — নতুন AI-মোশন নয় (সৎ লেবেল)',
  },
  process_video: {
    implementation: 'ffmpeg',
    implementationFile: 'src/lib/agent/tools/video.ts → processVideoSpec → runFfmpeg (trim/concat/speed/scale/crop/add_audio/replace_audio)',
  },
  enhance_video: {
    implementation: 'ffmpeg',
    implementationFile: 'src/lib/agent/tools/video.ts → enhanceVideoSpec → runFfmpeg (eq/unsharp/hqdn3d/vidstab দুই-পাস)',
  },
  interpolate_video: {
    implementation: 'ffmpeg',
    implementationFile: 'src/lib/agent/tools/video.ts → interpolateVideoSpec → runFfmpeg (minterpolate)',
  },
  generate_subtitles: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/tools/video.ts → generateSubtitlesSpec → LLM কিউ-সেগমেন্টেশন + media/ffmpeg.buildSrt',
    implementationNote: 'হাইব্রিড: সেগমেন্টেশন ক্লাউড LLM, SRT-ফাইল তৈরি লোকাল',
  },
  validate_video: {
    implementation: 'ffmpeg',
    implementationFile: 'src/lib/agent/tools/video.ts → validateVideoSpec → mediaInfo/audioQuality (ffprobe যাচাই: দৈর্ঘ্য/রেজোলিউশন/fps/স্ট্রিম/A-V সিঙ্ক)',
  },
  lip_sync: {
    implementation: 'honest_gated',
    implementationFile: 'src/lib/agent/tools/video.ts → lipSyncSpec → lipSyncCapabilityReport (৪+১-মাত্রিক বাধা-প্রতিবেদন) → throw',
    implementationNote: 'বাধা: SDK-API নেই · GPU নেই · অ্যাডাপ্টার নেই · বেঞ্চমার্ক হয়নি (+লাইসেন্স needs_review) — মিথ্যা সফলতা নয়',
  },

  // ---- PRODUCTION_TOOLS — src/lib/agent/tools/production.ts ----
  propose_job: {
    implementation: 'planning_only',
    implementationFile: 'src/lib/agent/tools/production.ts → proposeJobSpec → capabilities.validateSpec + অটো-ওয়্যারিং → Production row (awaiting_confirmation)',
    implementationNote: 'কোনো জেনারেশন নয় — নিশ্চিতকরণ-কার্ড; কাজ শুরু হয় POST /api/productions/[id]/confirm-এ',
  },
  create_character: {
    implementation: 'sdk_cloud',
    implementationFile: 'src/lib/agent/tools/production.ts → createCharacterSpec → chatComplete (পোর্ট্রেট-প্রম্পট) + generateImageBuffer + Character upsert (Prisma)',
    implementationNote: 'হাইব্রিড: পোর্ট্রেট ক্লাউড ছবি-মডেল, Character Bible রেকর্ড লোকাল DB',
  },
};

// ------------------------------------------------------------
// মূল জেনারেশন
// ------------------------------------------------------------

const matrixResponse = availabilityMatrixResponse();

const tools = TOOL_CATALOG.map(t => {
  const impl = IMPLEMENTATION_MAP[t.name];
  if (!impl) {
    // নতুন টুল যোগ হলে ম্যাপ আপডেট না হলে সৎভাবে ধরা পড়বে
    throw new Error(
      `IMPLEMENTATION_MAP-এ "${t.name}" নেই — src/lib/agent/registry.ts ও tools/*.ts পড়ে ম্যাপে যোগ করো (স্ক্রিপ্টটি ম্যানুয়ালি সিঙ্ক করা হয়)।`
    );
  }
  return {
    name: t.name,
    title: t.title,
    category: t.category,
    implementation: impl.implementation,
    implementationFile: impl.implementationFile,
    ...(impl.implementationNote ? { implementationNote: impl.implementationNote } : {}),
  };
});

// MODEL_SEED-এর এন্ট্রিগুলো প্লেইন অবজেক্ট — সিরিয়ালাইজযোগ্য ফিল্ডগুলো হুবহু
const models = MODEL_SEED.map(entry => ({ ...entry }));

const overallCounts = AVAILABILITY_MATRIX.reduce<Record<string, number>>((acc, row) => {
  acc[row.overall] = (acc[row.overall] ?? 0) + 1;
  return acc;
}, {});

const featureMatrix = {
  generatedAt: new Date().toISOString(),
  environment: {
    hardware: '2 CPU cores, ~4.1GB RAM, no GPU (Z.ai sandbox)',
    usage: 'ব্যক্তিগত / অ-বাণিজ্যিক',
    stack: 'Next.js 16 + TypeScript + Prisma(SQLite) + FFmpeg 7.1 + z-ai-web-dev-sdk',
  },
  summary: {
    toolCount: TOOL_CATALOG.length,
    modelCount: MODEL_SEED.length,
    matrixRowCount: AVAILABILITY_MATRIX.length,
    overallVerdicts: overallCounts,
    honestyNote:
      'কোনো মডেল blocked_by_license নয়; প্রকৃত বাধা GPU / SDK-API-প্রকাশনা / ইন্টিগ্রেশন / গুণমান-যাচাই — ম্যাট্রিক্স-সারিতে মাত্রাভিত্তিক লেখা।',
  },
  tools,
  models,
  matrix: matrixResponse.matrix,
  legend: matrixResponse.legend,
  usageMode: matrixResponse.usageMode,
};

// import.meta.dir কেবল bun-runtime টাইপে আছে — tsc-সামঞ্জস্যে fileURLToPath
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'FEATURE_MATRIX.json');
writeFileSync(outPath, JSON.stringify(featureMatrix, null, 2) + '\n', 'utf-8');

console.log(`✓ docs/FEATURE_MATRIX.json লেখা হয়েছে (${outPath})`);
console.log(`  - টুল: ${tools.length}টি (IMPLEMENTATION_MAP দিয়ে ম্যাপড)`);
console.log(`  - মডেল: ${models.length}টি (MODEL_SEED)`);
console.log(
  `  - ম্যাট্রিক্স: ${matrixResponse.matrix.length}টি সারি — সামগ্রিক রায়: ${Object.entries(
    overallCounts
  )
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')}`
);
