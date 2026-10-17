// ============================================================
// Model & Tool Availability Matrix — নতুন মাস্টার প্ল্যান §১৫-এর প্রথম
// Deliverable।
//
// §৫-এর ঐক্য ক্ষমতা-টেবিল: ব্যবহারকারীর টাস্ক-শ্রেণি → কোন টুল → কোন
// মডেল → লাইসেন্স/প্রোভাইডার/ইন্টিগ্রেশন/রানটাইম চার-মাত্রার সৎ রায়।
//
// নীতি:
//  - "ব্লকড" মানেই "লাইসেন্স নিষিদ্ধ" নয় — প্রতিটি অনুপলব্ধ সারিতে
//    প্রকৃত কারণ আলাদাভাবে লেখা।
//  - permission-check আর runtime-check আলাদা (§৩) — লাইসেন্স ঠিক থাকলেও
//    API/হার্ডওয়্যার না থাকলে চলবে না; উল্টোটাও সত্য।
//  - TTS-কে গান, Ken Burns-কে AI-ভিডিও, FFmpeg-কে জেনারেশন বলা নিষিদ্ধ।
// ============================================================

import type { AvailabilityMatrixRow, AvailabilityMatrixResponse } from '@/lib/types';
import { activeLipSyncProvider } from './video/lip_sync_module';

/** §৫ — ব্যবহারকারীর টাস্ক-শ্রেণির স্থিতিশীল কী */
export type CapabilityTaskType =
  | 'speech'
  | 'transcription'
  | 'instrumental_music'
  | 'full_song'
  | 'stem_separation'
  | 'image_generation'
  | 'image_editing'
  | 'image_search'
  | 'image_analysis'
  | 'text_to_video'
  | 'image_to_video'
  | 'character_animation'
  | 'video_native_audio'
  | 'talking_portrait'
  | 'singing_lipsync'
  | 'video_editing'
  | 'subtitles'
  | 'sound_design'
  | 'motion_video'
  | 'music_video'
  | 'short_film'
  | 'web_search'
  | 'page_reading';

const TESTED = '2026-10-11';

// D-5/B5: লিপ-সিঙ্ক-সারির চার-মাত্রিক রায় ও overall সরাসরি সক্রিয়
// লিপ-সিঙ্ক-প্রোভাইডারের ক্ষমতা-প্রতিবেদন থেকে উদ্ভূত (আজ
// available:false → সব মাত্রা 'unavailable_*' + overall 'unavailable_here';
// প্রকৃত অ্যাডাপ্টার যোগ হলে এই সারিগুলো নিজেই সৎ হয়ে যাবে)।
const LIP_SYNC_CAPS = activeLipSyncProvider().getCapabilities();
const LIP_SYNC_OVERALL: AvailabilityMatrixRow['overall'] = LIP_SYNC_CAPS.available
  ? 'available'
  : 'unavailable_here';

export const AVAILABILITY_MATRIX: AvailabilityMatrixRow[] = [
  // ---------------- অডিও ----------------
  {
    key: 'cap-speech',
    quality: 'quality_not_verified',
    capability: 'কথা-উচ্চারণ (TTS) — বাংলা/ইংরেজি (bn/en লাইভ-চেষ্টিত); হিন্দি/উর্দু/চীনা রাউটিং-সমর্থিত, UNVERIFIED',
    taskType: 'speech',
    tools: ['text_to_speech', 'speech_synthesis'],
    modelKey: 'platform-tts',
    model: 'Z.ai TTS (৭ কণ্ঠ)',
    license: 'provider_api_only',
    provider: 'exposed_by_sdk',
    integration: 'integrated',
    runtime: 'healthy',
    apiEndpoint: 'zai.audio.tts.create',
    lastTestedAt: TESTED,
    lastTestNote: '৭-কণ্ঠ প্রোব + ভাষা-নিয়ন্ত্রক রাউন্ড-ট্রিপ যাচাই; ইংরেজি ASR-ব্যাক-চেক কার্যকর',
    overall: 'available_with_limits',
    honestNote:
      'বাংলা-পথ = Microsoft Edge-নিউরাল bn-BD/bn-IN (নবনীতা/প্রদীপ/তানিশা/ভাস্কর) — Edge সক্রিয় কালে দেশীয় উচ্চারণ, রায় "যাচাইকৃত"; Edge অচল হলে (যেমন ২০২৬-১০-১৬-এর রানে 403) সৎ ফলাফল VOICE_UNAVAILABLE — z-ai কণ্ঠ (jam/douji) বাংলা-অসক্ষম, bn-চেইনে নিষিদ্ধ (R-FIX-1)। ইংরেজিতে z-ai ফলব্যাক বৈধ (রায় সর্বোচ্চ "সতর্কতা") + ASR রাউন্ড-ট্রিপ-যাচাই চালু।',
  },
  {
    key: 'cap-transcription',
    quality: 'quality_not_verified',
    capability: 'অডিও → লেখা (ASR)',
    taskType: 'transcription',
    tools: ['transcribe_audio', 'TTS ব্যাক-চেক'],
    modelKey: 'platform-asr',
    model: 'Z.ai ASR',
    license: 'provider_api_only',
    provider: 'exposed_by_sdk',
    integration: 'integrated',
    runtime: 'healthy',
    apiEndpoint: 'zai.audio.asr.create',
    lastTestedAt: TESTED,
    lastTestNote: '৩০ সে.-সীমার জন্য ২৮ সে. চাঙ্কিং বাস্তবায়িত',
    overall: 'available_with_limits',
    honestNote: 'ইংরেজি ভালো; বাংলা দুর্বল — বাংলা অডিওর ট্রান্সক্রিপ্ট নির্ভরযোগ্য নয়।',
  },
  {
    key: 'cap-instrumental',
    quality: 'quality_not_verified',
    capability: 'ইনস্ট্রুমেন্টাল সংগীত',
    taskType: 'instrumental_music',
    tools: ['generate_instrumental', 'music_video পাইপলাইন (প্রসিডিউরাল স্কোর)'],
    modelKey: 'procedural-music-engine',
    model: 'প্রসিডিউরাল মিউজিক-ইঞ্জিন (স্থানীয়)',
    license: 'allowed',
    provider: 'local_engine',
    integration: 'integrated',
    runtime: 'healthy',
    lastTestedAt: TESTED,
    lastTestNote: '৬ মুড × স্কেল/কর্ড/ছন্দ; ধূমপরীক্ষা ৩২/৩২ পাস',
    overall: 'experimental',
    honestNote: 'প্রসিডিউরাল সংশ্লেষণ — MusicGen-ধর্মী নিউরাল মডেল নয় (SDK-তে মিউজিক API নেই)।',
    fallback: 'নিজের গান আপলোড করলে সেটিই মিউজিক-ভিডিওতে ব্যবহৃত হয়।',
  },
  {
    key: 'cap-full-song',
    quality: 'quality_not_verified',
    capability: 'সম্পূর্ণ গান (কণ্ঠসংগীত + সুর)',
    taskType: 'full_song',
    tools: ['generate_singing (⛔ এই পরিবেশে অবরুদ্ধ — সৎ-গেটেড)'],
    modelKey: 'ace-step',
    model: 'ACE-Step (প্রার্থী #১) · YuE (প্রার্থী #২)',
    license: 'allowed_noncommercial',
    provider: 'not_exposed_by_sdk',
    integration: 'not_integrated',
    runtime: 'unavailable_hardware',
    lastTestedAt: TESTED,
    lastTestNote:
      'দুই প্রার্থী: ACE-Step — রিপো Apache-2.0, তবে নির্দিষ্ট checkpoint ও dependency-শর্ত যাচাই বাকি; YuE — ওয়েট CC-BY-NC 4.0 (অ-বাণিজ্যিকে অনুমোদিত)',
    errorReason:
      '⛔ এই পরিবেশে অবরুদ্ধ। প্রকৃত বাধা: GPU নেই (ন্যূনতম ~৪.৫GB VRAM) + SDK-তে গান-জেনারেশন API নেই + বাংলা লিরিক্স-বেঞ্চমার্ক হয়নি। (লাইসেন্স এখানে বাধা নয় — YuE অ-বাণিজ্যিকে অনুমোদিত।)',
    overall: 'unavailable_here',
    honestNote: '⛔ গান গাওয়া এখন চালু নয় — TTS-কে কখনো "গান গাওয়া" বলে দেখানো হয় না। ভবিষ্যৎ GPU-পরিবেশে সম্ভব।',
    fallback: 'প্রসিডিউরাল ইনস্ট্রুমেন্টাল + লিরিক্স-ডকুমেন্ট (plan_music), অথবা নিজের রেকর্ড করা গান আপলোড।',
  },
  {
    key: 'cap-stems',
    quality: 'quality_not_verified',
    capability: 'স্টেম-পৃথকীকরণ (কণ্ঠ/বাদ্য আলাদা)',
    taskType: 'stem_separation',
    tools: ['separate_stems (⛔ এই পরিবেশে অবরুদ্ধ — সৎ-গেটেড)'],
    modelKey: 'demucs-uvr',
    model: 'Demucs / UVR',
    license: 'needs_review',
    provider: 'not_exposed_by_sdk',
    integration: 'not_integrated',
    runtime: 'unavailable_hardware',
    errorReason: '⛔ এই পরিবেশে অবরুদ্ধ। প্রকৃত বাধা: SDK-তে API নেই; CPU-তে অত্যন্ত ধীর ও ৪.১GB RAM-এ ঝুঁকিপূর্ণ (স্যান্ডবক্স-ক্র্যাশ এড়ানো হয়েছে); Demucs কোড MIT, তবে প্রতিটি checkpoint ও dependency-র শর্ত আলাদাভাবে যাচাই বাকি।',
    overall: 'unavailable_here',
    honestNote: '⛔ স্টেম-পৃথকীকরণ এখন চালু নয় — "শীঘ্রই আসছে" নয়, সত্যিই বন্ধ।',
    fallback: 'মিক্স-টুল দিয়ে ভলিউম/ডাকিং-সমন্বয় সম্ভব (পৃথকীকরণ ছাড়া)।',
  },
  // ---------------- ছবি ----------------
  {
    key: 'cap-imagegen',
    quality: 'quality_machine_checked',
    capability: 'টেক্সট থেকে ছবি',
    taskType: 'image_generation',
    tools: ['generate_image', 'সব পাইপলাইনের স্টোরিবোর্ড/পোর্ট্রেট ধাপ'],
    modelKey: 'platform-imagegen',
    model: 'Z.ai Image Generation',
    license: 'provider_api_only',
    provider: 'exposed_by_sdk',
    integration: 'integrated',
    runtime: 'healthy',
    apiEndpoint: 'zai.images.generations.create',
    lastTestedAt: TESTED,
    overall: 'available',
  },
  {
    key: 'cap-imageedit',
    quality: 'quality_machine_checked',
    capability: 'ছবি সম্পাদনা (AI)',
    taskType: 'image_editing',
    tools: ['edit_image', 'inpaint_image', 'remove_background', 'remove_object', 'restyle_image'],
    modelKey: 'platform-imageedit',
    model: 'Z.ai Image Edit',
    license: 'provider_api_only',
    provider: 'exposed_by_sdk',
    integration: 'integrated',
    runtime: 'healthy',
    apiEndpoint: 'zai.images.generations.edit',
    lastTestedAt: TESTED,
    lastTestNote: 'রেফারেন্স-কন্ডিশনড স্টোরিবোর্ডসহ E2E-সক্রিয়',
    overall: 'available',
  },
  {
    key: 'cap-imagesearch',
    quality: 'quality_machine_checked',
    capability: 'ওয়েব-ছবি অনুসন্ধান',
    taskType: 'image_search',
    tools: ['search_images'],
    modelKey: 'platform-image-search',
    model: 'Z.ai Image Search',
    license: 'provider_api_only',
    provider: 'exposed_by_sdk',
    integration: 'integrated',
    runtime: 'healthy',
    apiEndpoint: 'zai.images.search.create / CLI',
    lastTestedAt: TESTED,
    lastTestNote: 'লাইভ-প্রোব: SDK মেথডে ৩ ফলাফল ৯.৫ সে.-এ ✓',
    overall: 'available',
    honestNote: 'ফলাফল বাইরের ওয়েব-ছবি — AI-নির্মিত নয়, সেটাই সৎভাবে লেবেল করা হয়।',
  },
  {
    key: 'cap-vision',
    quality: 'quality_machine_checked',
    capability: 'ছবি বিশ্লেষণ (VLM)',
    taskType: 'image_analysis',
    tools: ['analyze_image', 'inspect_image', 'ধারাবাহিকতা-যাচাই'],
    modelKey: 'platform-vlm',
    model: 'Z.ai VLM',
    license: 'provider_api_only',
    provider: 'exposed_by_sdk',
    integration: 'integrated',
    runtime: 'healthy',
    apiEndpoint: 'zai.chat.completions.createVision',
    lastTestedAt: TESTED,
    overall: 'available',
  },
  // ---------------- ভিডিও ----------------
  {
    key: 'cap-t2v',
    quality: 'quality_machine_checked',
    capability: 'টেক্সট থেকে প্রকৃত AI ভিডিও',
    taskType: 'text_to_video',
    tools: ['generate_video (ইঞ্জিন: ai_diffusion)'],
    modelKey: 'platform-videogen',
    model: 'CogVideoX-3 (ক্লাউড)',
    license: 'provider_api_only',
    provider: 'exposed_by_sdk',
    integration: 'integrated',
    runtime: 'healthy',
    apiEndpoint: 'zai.video.generations.create',
    apiModelId: 'cogvideox-3',
    lastTestedAt: TESTED,
    lastTestNote: '৫ সে. t2v ১৩৮ সে.-এ প্রকৃত MP4; ৪২৯-রেট-সীমা — ব্যাকঅফ-সহ পুনঃচেষ্টা',
    overall: 'available',
    honestNote: 'প্রতি শটে ২–৪ মিনিট; ফলাফল ffprobe-যাচাইকৃত।',
    fallback: 'cinematic_motion ইঞ্জিন (স্টোরিবোর্ড + Ken Burns — স্বেচ্ছায় বেছে নিলে, সৎ লেবেলসহ)।',
  },
  {
    key: 'cap-i2v',
    quality: 'quality_machine_checked',
    capability: 'ছবি থেকে প্রকৃত AI ভিডিও',
    taskType: 'image_to_video',
    tools: ['image_to_video'],
    modelKey: 'platform-videogen',
    model: 'CogVideoX-3 i2v (ক্লাউড)',
    license: 'provider_api_only',
    provider: 'exposed_by_sdk',
    integration: 'integrated',
    runtime: 'healthy',
    apiEndpoint: 'zai.video.generations.create (image_url)',
    apiModelId: 'cogvideox-3',
    lastTestedAt: TESTED,
    lastTestNote: 'data-URL ইনপুট প্রোব-যাচাইকৃত (১০৮০×১০৮০ h264 আউটপুট)',
    overall: 'available',
  },
  {
    key: 'cap-character-motion',
    quality: 'quality_machine_checked',
    capability: 'চরিত্রের শরীর-নড়াচড়া (অভিনয়)',
    taskType: 'character_animation',
    tools: ['generate_video (অভিনয়-নির্দেশিত প্রম্পট)'],
    modelKey: 'platform-videogen',
    model: 'CogVideoX-3 (ক্যারেক্টার-মোশন প্রম্পট)',
    license: 'provider_api_only',
    provider: 'exposed_by_sdk',
    integration: 'integrated',
    runtime: 'healthy',
    apiEndpoint: 'zai.video.generations.create',
    apiModelId: 'cogvideox-3',
    lastTestedAt: TESTED,
    overall: 'experimental',
    honestNote: 'হাঁটা/বসা/অঙ্গ-ভঙ্গি প্রম্পটযোগ্য; জটিল অ্যাকশনে ফলাফল পরিবর্তনশীল — প্রিভিউ-যাচাই দরকার। মুখের ঠোঁট-সিঙ্ক এর অংশ নয়।',
  },
  {
    key: 'cap-video-audio',
    quality: 'quality_machine_checked',
    capability: 'ভিডিওর সাথে নেটিভ AI-অডিও',
    taskType: 'video_native_audio',
    tools: ['generate_video/image_to_video (withAudio)'],
    modelKey: 'platform-video-audio',
    model: 'CogVideoX-3 with_audio',
    license: 'provider_api_only',
    provider: 'exposed_by_sdk',
    integration: 'integrated',
    runtime: 'healthy',
    apiEndpoint: 'zai.video.generations.create (with_audio: true)',
    apiModelId: 'cogvideox-3',
    lastTestedAt: TESTED,
    lastTestNote: 'লাইভ-প্রোব সফল: ৫.২ সে. MP4-তে প্রকৃত AAC অডিও-স্ট্রিম (16kHz mono) ffprobe-নিশ্চিত',
    overall: 'available',
    honestNote: 'অডিও-স্ট্রিমের উপস্থিতি ffprobe দিয়ে যাচাই হয় — কেবল API-সফলতা যথেষ্ট নয়।',
  },
  {
    key: 'cap-talking-portrait',
    quality: 'quality_not_verified',
    capability: 'কথা বলার লিপ-সিঙ্ক (টকিং পোর্ট্রেট)',
    taskType: 'talking_portrait',
    tools: ['lip_sync (সৎ-গেটেড)'],
    modelKey: 'wav2lip-sadtalker',
    model: 'Wav2Lip / SadTalker / MuseTalk (প্রার্থী)',
    license: LIP_SYNC_CAPS.blockageDimensions.license,
    provider: LIP_SYNC_CAPS.blockageDimensions.provider,
    integration: LIP_SYNC_CAPS.blockageDimensions.integration,
    runtime: LIP_SYNC_CAPS.blockageDimensions.hardware,
    errorReason:
      'চার-মাত্রিক বাধা: প্রোভাইডার — SDK-তে লিপ-সিঙ্ক API নেই; হার্ডওয়্যার — GPU নেই (৪–১২GB VRAM দরকার); ইন্টিগ্রেশন — অ্যাডাপ্টার নেই; যাচাই — বাংলা সংলাপের বেঞ্চমার্ক হয়নি ও কিছু প্রকল্পের লাইসেন্স-শর্ত স্পষ্ট নয়।',
    overall: LIP_SYNC_OVERALL,
    honestNote: 'ছবিতে জুম করে "লিপ-সিঙ্ক সফল" দেখানো নিষিদ্ধ — মিথ্যা সফলতা নয়।',
    fallback: 'সংলাপ-অডিও (TTS) + AI-দৃশ্য আলাদাভাবে তৈরি হয়; অডিও-ভিডিও টাইমলাইন-সমলয় থাকে, মুখের নড়াচড়ার দাবি থাকে না।',
  },
  {
    key: 'cap-singing-lipsync',
    quality: 'quality_not_verified',
    capability: 'গান গাওয়ার লিপ-সিঙ্ক',
    taskType: 'singing_lipsync',
    tools: ['lip_sync (গান-মোড, সৎ-গেটেড)'],
    modelKey: 'wav2lip-sadtalker',
    model: '—',
    license: LIP_SYNC_CAPS.blockageDimensions.license,
    provider: LIP_SYNC_CAPS.blockageDimensions.provider,
    integration: LIP_SYNC_CAPS.blockageDimensions.integration,
    runtime: LIP_SYNC_CAPS.blockageDimensions.hardware,
    errorReason:
      'টকিং পোর্ট্রেটের চার-মাত্রিক বাধার সাথে অতিরিক্ষম: গানের vocal-টাইমিং/সিলেবল-অ্যালাইনমেন্ট আলাদা বেঞ্চমার্ক বাধ্যতামূলক (কথার মডেল পরীক্ষা ছাড়া গানে চালু করা নিষিদ্ধ); এই স্যান্ডবক্সে পূর্ণ-গান মডেলও নেই।',
    overall: LIP_SYNC_OVERALL,
    fallback: 'গান-অডিও + AI-দৃশ্যের মিউজিক-ভিডিও (কণ্ঠ শোনা যায়, মুখ নড়ে না — সৎভাবে ঘোষিত)।',
  },
  // ---------------- সম্পাদনা/পোস্ট ----------------
  {
    key: 'cap-video-editing',
    quality: 'quality_machine_checked',
    capability: 'ভিডিও সম্পাদনা (কাট/জোড়া/রং/স্থিতিশীলতা)',
    taskType: 'video_editing',
    tools: ['process_video', 'enhance_video', 'interpolate_video', 'validate_video', 'animate_image'],
    modelKey: 'ffmpeg',
    model: 'FFmpeg 7.1 (স্থানীয়)',
    license: 'allowed_with_conditions',
    provider: 'local_engine',
    integration: 'integrated',
    runtime: 'healthy',
    lastTestedAt: TESTED,
    overall: 'available',
    honestNote: 'এটি সম্পাদনা/অ্যানিমেশন — নতুন AI-জেনারেশন নয়; প্রতিটি আউটপুটে generation_mode লেবেল থাকে।',
  },
  {
    key: 'cap-subtitles',
    quality: 'quality_machine_checked',
    capability: 'সাবটাইটেল (SRT + বার্ন-ইন)',
    taskType: 'subtitles',
    tools: ['generate_subtitles', 'short_film পাইপলাইন'],
    modelKey: 'ffmpeg',
    model: 'LLM কিউ-সেগমেন্টেশন + FFmpeg libass (বাংলা ফন্ট)',
    license: 'allowed_with_conditions',
    provider: 'local_engine',
    integration: 'integrated',
    runtime: 'healthy',
    lastTestedAt: TESTED,
    overall: 'available',
  },
  {
    key: 'cap-sound-design',
    quality: 'quality_not_verified',
    capability: 'সাউন্ড-ডিজাইন (A1–A5 পাঁচ-স্তর)',
    taskType: 'sound_design',
    tools: ['short_film পাইপলাইনের sound_design ধাপ', 'process_audio', 'mix_audio'],
    modelKey: 'sound-design-engine',
    model: 'সাউন্ড-ডিজাইন ইঞ্জিন (স্থানীয়)',
    license: 'allowed',
    provider: 'local_engine',
    integration: 'integrated',
    runtime: 'healthy',
    lastTestedAt: TESTED,
    overall: 'experimental',
    honestNote: 'সংশ্লেষিত অ্যাম্বিয়েন্স/ফোলে — রেকর্ডেড লাইব্রেরি নয়; প্রতিটি ট্র্যাকের source ও mode সংরক্ষিত।',
  },
  // ---------------- পাইপলাইন ----------------
  {
    key: 'cap-motion-video',
    quality: 'quality_machine_checked',
    capability: 'মোশন ভিডিও (৫–২০ সে.)',
    taskType: 'motion_video',
    tools: ['propose_job (motion_video পাইপলাইন)'],
    modelKey: 'platform-videogen',
    model: 'CogVideoX-3 + FFmpeg অ্যাসেম্বলি',
    license: 'provider_api_only',
    provider: 'exposed_by_sdk',
    integration: 'integrated',
    runtime: 'healthy',
    lastTestedAt: TESTED,
    lastTestNote: 'AI-ইঞ্জিন পথ E2E সফল; cinematic-ফলব্যাকও সৎ-লেবেলসহ',
    overall: 'available',
    honestNote: 'ইঞ্জিন প্রতি আর্টিফ্যাক্টে generation_mode (ai_video/image_animation) লেবেল থাকে।',
  },
  {
    key: 'cap-music-video',
    quality: 'quality_machine_checked',
    capability: 'মিউজিক ভিডিও',
    taskType: 'music_video',
    tools: ['propose_job (music_video পাইপলাইন)'],
    modelKey: 'platform-videogen',
    model: 'CogVideoX-3 + গান-ইনপুট/প্রসিডিউরাল স্কোর + FFmpeg',
    license: 'provider_api_only',
    provider: 'exposed_by_sdk',
    integration: 'integrated',
    runtime: 'healthy',
    lastTestedAt: TESTED,
    lastTestNote: 'গান-সমলয় (avSyncOk) যাচাইসহ E2E সফল',
    overall: 'available_with_limits',
    honestNote: 'গায়কের মুখ নড়ে না (লিপ-সিঙ্ক নেই) — সৎভাবে ঘোষিত; গান আপলোড বা প্রসিডিউরাল স্কোর।',
    fallback: 'নিজের গান আপলোড করলে সেটির সাথে ভিজ্যুয়াল-টাইমলাইন বাঁধা যায়।',
  },
  {
    key: 'cap-short-film',
    quality: 'quality_machine_checked',
    capability: 'শর্ট ফিল্ম (৮-স্টেজ পাইপলাইন)',
    taskType: 'short_film',
    tools: ['propose_job (short_film পাইপলাইন)'],
    modelKey: 'platform-videogen',
    model: 'CogVideoX-3 + TTS + সাউন্ড-ডিজাইন + VLM + FFmpeg',
    license: 'provider_api_only',
    provider: 'exposed_by_sdk',
    integration: 'integrated',
    runtime: 'healthy',
    lastTestedAt: TESTED,
    lastTestNote: 'E2E: ৩৩.৫ সে. ফিল্ম — বাংলা সাবটাইটেল বার্ন-ইন VLM-নিশ্চিত',
    overall: 'available_with_limits',
    honestNote: 'সংলাপ-অডিও ও AI-দৃশ্য থাকে, ঠোঁট-সিঙ্ক নয়; প্রতিটি ধাপের ফলাফল ও আংশিক-ব্যর্থতা সৎভাবে রিপোর্ট হয়।',
  },
  // ---------------- তথ্য ----------------
  {
    key: 'cap-web-search',
    quality: 'quality_machine_checked',
    capability: 'ওয়েব অনুসন্ধান',
    taskType: 'web_search',
    tools: ['web_search'],
    modelKey: 'platform-functions',
    model: 'Z.ai web_search',
    license: 'provider_api_only',
    provider: 'exposed_by_sdk',
    integration: 'integrated',
    runtime: 'healthy',
    apiEndpoint: "zai.functions.invoke('web_search')",
    lastTestedAt: TESTED,
    overall: 'available',
  },
  {
    key: 'cap-page-reader',
    quality: 'quality_machine_checked',
    capability: 'ওয়েবপেজ পড়া',
    taskType: 'page_reading',
    tools: ['read_web_page'],
    modelKey: 'platform-functions',
    model: 'Z.ai page_reader',
    license: 'provider_api_only',
    provider: 'exposed_by_sdk',
    integration: 'integrated',
    runtime: 'healthy',
    apiEndpoint: "zai.functions.invoke('page_reader')",
    lastTestedAt: TESTED,
    overall: 'available',
  },
];

/** §৫ — টাস্ক-শ্রেণি অনুযায়ী রুট (permission + provider + runtime একসাথে) */
export function matrixRowForTask(taskType: CapabilityTaskType): AvailabilityMatrixRow | undefined {
  return AVAILABILITY_MATRIX.find(r => r.taskType === taskType);
}

/** §১১ — ম্যাট্রিক্সের সম্পূর্ণ API-প্রতিক্রিয়া (legend-সহ) */
export function availabilityMatrixResponse(): AvailabilityMatrixResponse {
  return {
    matrix: AVAILABILITY_MATRIX,
    generatedAt: new Date().toISOString(),
    usageMode: {
      environment: 'Z.ai স্যান্ডবক্স (২ CPU কোর, ~৪.১GB RAM, GPU নেই)',
      usage: 'ব্যক্তিগত / অ-বাণিজ্যিক ব্যবহার',
      note:
        'লাইসেন্স-রায় এই ঘোষিত ব্যবহার-ভিত্তিক। "non-commercial" লাইসেন্স এই ব্যবহারে অনুমোদিত; তাই কোনো মডেল শুধু এই কারণে অবরুদ্ধ নয়। বাস্তব বাধা (GPU/API/ইন্টিগ্রেশন) আলাদাভাবে দেখানো হয়েছে।',
    },
    legend: {
      // লাইসেন্স
      allowed: 'লাইসেন্স: অনুমোদিত',
      allowed_noncommercial: 'লাইসেন্স: অ-বাণিজ্যিক ব্যবহারে অনুমোদিত',
      allowed_with_conditions: 'লাইসেন্স: শর্তসাপেক্ষে অনুমোদিত (attribution/পুনর্বণ্টন-শর্ত)',
      provider_api_only: 'লাইসেন্স: অনুমোদিত প্রোভাইডার-API পথ ধরে ব্যবহার',
      needs_review: 'লাইসেন্স/শর্ত: যাচাই বাকি',
      blocked_by_license: 'লাইসেন্স: বর্তমান ব্যবহারে নিষিদ্ধ',
      // প্রোভাইডার
      exposed_by_sdk: 'প্রোভাইডার: স্যান্ডবক্স SDK-তে API আছে',
      not_exposed_by_sdk: 'প্রোভাইডার: SDK-তে API প্রকাশিত নয়',
      local_engine: 'প্রোভাইডার লাগে না — স্থানীয় ইঞ্জিন',
      unknown: 'প্রোভাইডার: অজানা',
      // ইন্টিগ্রেশন
      integrated: 'ইন্টিগ্রেশন: অ্যাডাপ্টার/পাইপলাইন সম্পূর্ণ',
      partial: 'ইন্টিগ্রেশন: আংশিক',
      not_integrated: 'ইন্টিগ্রেশন: সংযুক্ত নয়',
      // রানটাইম
      healthy: 'রানটাইম: এই পরিবেশে চালু ও স্বাস্থ্যবান',
      degraded: 'রানটাইম: চলে, কিন্তু সীমাবদ্ধতা আছে',
      temporarily_unavailable: 'রানটাইম: সাময়িকভাবে অনুপলব্ধ (রেট-লিমিট/আউটেজ)',
      unavailable_hardware: 'রানটাইম: এই হার্ডওয়্যারে অসম্ভব (GPU/RAM)',
      not_applicable: 'রানটাইম: প্রযোজ্য নয়',
      // গুণমান (নতুন পরিকল্পনা §১ — পাঁচম মাত্রা)
      quality_not_verified: 'গুণমান: বাস্তব মান-পরীক্ষা এখনো হয়নি',
      quality_machine_checked: 'গুণমান: যন্ত্র-পরীক্ষায় উত্তীর্ণ (মানব-শ্রবণ বাকি)',
      quality_human_verified: 'গুণমান: মানব-যাচাইতেও উত্তীর্ণ',
      quality_not_applicable: 'গুণমান: প্রযোজ্য নয় (অবকাঠামো/টুলিং)',
      // সামগ্রিক
      available: 'সামগ্রিক: চালু',
      available_with_limits: 'সামগ্রিক: চালু — নির্দিষ্ট সীমা/সতর্কতাসহ',
      experimental: 'সামগ্রিক: পরীক্ষামূলক (সৎ লেবেলসহ)',
      unavailable_here: 'সামগ্রিক: ⛔ এই পরিবেশে অবরুদ্ধ (কারণ: হার্ডওয়্যার/API/ইন্টিগ্রেশন — লাইসেন্স নয়)',
      future: 'সামগ্রিক: ভবিষ্যৎ পরিবেশে সম্ভব (এখানে নয়)',
    },
  };
}
