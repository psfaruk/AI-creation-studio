// ============================================================
// Model & License Registry seed (মাস্টার প্ল্যান §৮)।
// সততার নীতি: অযাচাইকৃত/নন-কমার্শিয়াল মডেল production-এ চালু নয়।
// status: enabled (চালু) | experimental (পরীক্ষামূলক) |
//         blocked (লাইসেন্স-অবরুদ্ধ) | planned (ভবিষ্যৎ পরিকল্পনা)
// ============================================================

export interface SeedModelEntry {
  key: string;
  name: string;
  category: 'llm' | 'image' | 'audio' | 'video' | 'utility' | 'infrastructure';
  provider: string;
  license: string;
  licenseUrl?: string;
  commercialUse: 'allowed' | 'restricted' | 'unknown' | 'not_applicable';
  status: 'enabled' | 'experimental' | 'blocked' | 'planned';
  capabilities: Record<string, unknown>;
  hardwareNotes?: string;
  notes?: string;
  sortOrder: number;
}

export const MODEL_SEED: SeedModelEntry[] = [
  // ---- চালু (enabled) ----
  {
    key: 'platform-llm',
    name: 'Z.ai LLM (GLM)',
    category: 'llm',
    provider: 'z-ai-web-dev-sdk',
    license: 'প্ল্যাটফর্ম পরিষেবা শর্তাবলি',
    commercialUse: 'allowed',
    status: 'enabled',
    capabilities: { role: 'চ্যাট/পরিকল্পনা/স্ক্রিপ্ট/শট-প্ল্যান', json: true, bengali: 'ভালো' },
    notes: 'এজেন্ট অর্কেস্ট্রেটর, script_writer, scene_breakdown, shot_planner, dialogue_generator ইত্যাদি ধাপে ব্যবহৃত।',
    sortOrder: 10,
  },
  {
    key: 'platform-imagegen',
    name: 'Z.ai Image Generation',
    category: 'image',
    provider: 'z-ai-web-dev-sdk',
    license: 'প্ল্যাটফর্ম পরিষেবা শর্তাবলি',
    commercialUse: 'allowed',
    status: 'enabled',
    capabilities: { sizes: ['1024x1024', '1344x768', '768x1344', '864x1152', '1152x864', '1440x720', '720x1440'], formats: ['png'] },
    notes: 'text-to-image, স্টোরিবোর্ড ফ্রেম, চরিত্রের পোর্ট্রেট ও পোস্টার-বেস তৈরিতে ব্যবহৃত।',
    sortOrder: 20,
  },
  {
    key: 'platform-imageedit',
    name: 'Z.ai Image Edit',
    category: 'image',
    provider: 'z-ai-web-dev-sdk',
    license: 'প্ল্যাটফর্ম পরিষেবা শর্তাবলি',
    commercialUse: 'allowed',
    status: 'enabled',
    capabilities: { input: 'ছবি (data URL/পাবলিক URL) + প্রম্পট', output: 'PNG', regionPrompting: 'বর্ণনা-ভিত্তিক' },
    notes: 'edit_image, inpaint_image, remove_background, remove_object, restyle_image টুলের ভিত্তি।',
    sortOrder: 21,
  },
  {
    key: 'platform-tts',
    name: 'Z.ai TTS (কণ্ঠ-প্রিসেট)',
    category: 'audio',
    provider: 'z-ai-web-dev-sdk',
    license: 'প্ল্যাটফর্ম পরিষেবা শর্তাবলি',
    commercialUse: 'allowed',
    status: 'enabled',
    capabilities: { voices: ['tongtong', 'jam', 'kazi'], inputLimitChars: 1024, formats: ['wav', 'mp3 সার্ভার-সমর্থনভেদে'] },
    notes: 'ভয়েসওভার/সংলাপ (speech_generator) ধাপ ও text_to_speech টুলে ব্যবহৃত।',
    sortOrder: 30,
  },
  {
    key: 'platform-asr',
    name: 'Z.ai ASR (লিপিবদ্ধকরণ)',
    category: 'audio',
    provider: 'z-ai-web-dev-sdk',
    license: 'প্ল্যাটফর্ম পরিষেবা শর্তাবলি',
    commercialUse: 'allowed',
    status: 'enabled',
    capabilities: { input: 'অডিও ফাইল', bengali: 'সীমিত — বাংলা অডিওতে দুর্বল হতে পারে' },
    notes: 'transcribe_audio টুল ও অডিও অ্যাটাচমেন্ট প্রি-স্টেপ।',
    sortOrder: 31,
  },
  {
    key: 'platform-vlm',
    name: 'Z.ai VLM (ছবি-বোঝা)',
    category: 'image',
    provider: 'z-ai-web-dev-sdk',
    license: 'প্ল্যাটফর্ম পরিষেবা শর্তাবলি',
    commercialUse: 'allowed',
    status: 'enabled',
    capabilities: { input: 'ছবি + প্রশ্ন', use: 'ছবি বিশ্লেষণ, ইনপুট-গুণমান পরীক্ষা, continuity_checker' },
    notes: 'analyze_image, inspect_image ও চলমান ধারাবাহিকতা-যাচাইয়ে ব্যবহৃত।',
    sortOrder: 22,
  },
  {
    key: 'ffmpeg',
    name: 'FFmpeg 7.1',
    category: 'infrastructure',
    provider: 'স্থানীয় সিস্টেম',
    license: 'GPL-2.1+ (libass, libx264 সহ বিল্ড)',
    licenseUrl: 'https://ffmpeg.org/legal.html',
    commercialUse: 'restricted',
    status: 'enabled',
    capabilities: {
      video: ['mp4 (h264)', 'trim/concat/speed', 'xfade/fade transitions', 'subtitles burn-in (libass)', 'vidstab stabilize', 'minterpolate', 'eq/unsharp/hqdn3d'],
      audio: ['trim/concat', 'amix', 'loudnorm', 'equalizer/acompressor/aecho', 'silencedetect', 'ebur128'],
    },
    notes: 'প্রধান ভিডিও/অডিও প্রসেসিং ইঞ্জিন (মাস্টার প্ল্যান §১২)। GPL বিল্ড — অভ্যন্তরীণ ব্যবহার; পুনর্বণ্টনে GPL-এর শর্ত প্রযোজ্য।',
    sortOrder: 40,
  },
  {
    key: 'sharp',
    name: 'sharp (libvips)',
    category: 'utility',
    provider: 'npm',
    license: 'Apache-2.0',
    licenseUrl: 'https://github.com/lovell/sharp/blob/main/LICENSE',
    commercialUse: 'allowed',
    status: 'enabled',
    capabilities: { image: ['resize/crop/rotate/flip', 'upscale (lanczos)', 'sharpen/median', 'format: png/jpeg/webp', 'SVG টাইপোগ্রাফি (বাংলা ফন্টসহ)'] },
    notes: 'নিয়তিশুদ্ধ ইমেজ-অপারেশন (transform/enhance/color_grade/export/compose_text) টুলের ভিত্তি।',
    sortOrder: 41,
  },
  {
    key: 'noto-bengali-font',
    name: 'Noto Sans Bengali',
    category: 'utility',
    provider: 'Google Noto Fonts',
    license: 'OFL-1.1',
    licenseUrl: 'https://fonts.google.com/noto/specimen/Noto+Sans+Bengali',
    commercialUse: 'allowed',
    status: 'enabled',
    capabilities: { use: 'বাংলা টাইপোগ্রাফি/সাবটাইটেল রেন্ডারিং', weights: ['Regular', 'Bold'] },
    notes: 'assets/fonts/ ও ফন্টকনফিগে ইনস্টলড — পোস্টার/থাম্বনেইল ও সাবটাইটেলে বাংলা লেখা।',
    sortOrder: 42,
  },

  // ---- লাইসেন্স-অবরুদ্ধ (blocked) — production-এ চালু নয় ----
  {
    key: 'musicgen',
    name: 'MusicGen',
    category: 'audio',
    provider: 'Meta (ওপেন-ওয়েট)',
    license: 'CC-BY-NC 4.0 (ওয়েট)',
    licenseUrl: 'https://github.com/facebookresearch/audiocraft/blob/main/LICENSE',
    commercialUse: 'restricted',
    status: 'blocked',
    capabilities: { would: 'টেক্সট থেকে ইনস্ট্রুমেন্টাল সংগীত', vram: '≈৮–১৬GB' },
    hardwareNotes: 'GPU প্রয়োজন',
    notes: 'ওয়েট-লাইসেন্স non-commercial — মাস্টার প্ল্যান §৮ নীতি অনুযায়ী production-এ চালু করা হয়নি। বিকল্প: নিজের গান আপলোড বা plan_music দিয়ে কাঠামো-পরিকল্পনা।',
    sortOrder: 60,
  },

  // ---- পরীক্ষামূলক (experimental) ----
  {
    key: 'demucs-uvr',
    name: 'Demucs / UVR (স্টেম-পৃথকীকরণ)',
    category: 'audio',
    provider: 'ওপেন-সোর্স',
    license: 'MIT (কোড); মডেলভেদে ভিন্ন',
    licenseUrl: 'https://github.com/adefossez/demucs',
    commercialUse: 'unknown',
    status: 'experimental',
    capabilities: { would: 'কণ্ঠ/বাদ্য পৃথকীকরণ', vram: '≈৪–৮GB' },
    hardwareNotes: 'GPU প্রয়োজন — এই পরিবেশে স্থাপন করা নেই',
    notes: 'মডেল-লাইসেন্স যাচাই ও GPU স্থাপনার আগে চালু নয়।',
    sortOrder: 61,
  },

  // ---- ভবিষ্যৎ পরিকল্পনা (planned) ----
  {
    key: 'wan-video',
    name: 'Wan 2.x (ভিডিও জেনারেশন)',
    category: 'video',
    provider: 'Wan-Video (ওপেন-ওয়েট)',
    license: 'Apache-2.0 (কিছু checkpoint-এ ভিন্ন)',
    licenseUrl: 'https://github.com/Wan-Video/Wan2.2',
    commercialUse: 'unknown',
    status: 'planned',
    capabilities: { would: 'ডিফিউশন text-to-video / image-to-video, ৫–১৫s ক্লিপ', vram: '২৪GB+ (প্রকরণভেদে)' },
    hardwareNotes: 'শক্তিশালী GPU প্রয়োজন — স্থাপন করা হয়নি',
    notes: 'মাস্টার প্ল্যান §৮-এর পরামর্শ: checkpoint-ভেদে license/VRAM/duration যাচাই করে নিতে হবে। ততক্ষণ ভিডিও পাইপলাইন স্টোরিবোর্ড+মোশন পদ্ধতিতে চলে।',
    sortOrder: 70,
  },
  {
    key: 'cogvideox',
    name: 'CogVideoX',
    category: 'video',
    provider: 'THUDM (ওপেন-ওয়েট)',
    license: 'প্রকরণভেদে (CogVideoX-2B: Apache-2.0; 5B: CC-BY-NC)',
    licenseUrl: 'https://github.com/THUDM/CogVideo',
    commercialUse: 'unknown',
    status: 'planned',
    capabilities: { would: 'ডিফিউশন text-to-video', vram: '৮–২৪GB+ (প্রকরণভেদে)' },
    hardwareNotes: 'GPU প্রয়োজন — স্থাপন করা হয়নি',
    notes: 'বাণিজ্যিক ব্যবহারযোগ্য variant যাচাই করে নেওয়া জরুরি।',
    sortOrder: 71,
  },
  {
    key: 'real-esrgan',
    name: 'Real-ESRGAN (আপস্কেলার)',
    category: 'image',
    provider: 'xinntao (ওপেন-ওয়েট)',
    license: 'BSD-3-Clause',
    licenseUrl: 'https://github.com/xinntao/Real-ESRGAN',
    commercialUse: 'allowed',
    status: 'planned',
    capabilities: { would: 'AI আপস্কেল + ফেস-রিস্টোরেশন', vram: '≈২–৮GB' },
    hardwareNotes: 'GPU প্রয়োজন — স্থাপন করা হয়নি',
    notes: 'নিজস্ব GPU-তে যুক্ত করা হলে AI-আপস্কেল চালু হবে; এখন sharp-lanczos আপস্কেল ব্যবহৃত হয় (সততার নোট: নতুন ডিটেইল যোগ হয় না)।',
    sortOrder: 72,
  },
  {
    key: 'wav2lip-sadtalker',
    name: 'Wav2Lip / SadTalker (লিপ-সিঙ্ক)',
    category: 'video',
    provider: 'ওপেন-সোর্স',
    license: 'প্রকল্পভেদে (গবেষণামূলক শর্তসহ)',
    licenseUrl: 'https://github.com/Rudrabha/Wav2Lip',
    commercialUse: 'restricted',
    status: 'planned',
    capabilities: { would: 'অডিও-চালিত ঠোঁট-মিলানো ও ফেস-অ্যানিমেশন', vram: '≈৪–১২GB' },
    hardwareNotes: 'GPU প্রয়োজন',
    notes: 'গবেষণা-লাইসেন্স ও সম্মতি (consent) নীতির কারণে চালু নয় — মাস্টার প্ল্যানের সততা-নিয়ম মেনে।',
    sortOrder: 73,
  },
  {
    key: 'singing-tts',
    name: 'Singing Voice Model (যেমন ACE-Step / YuE)',
    category: 'audio',
    provider: 'ওপেন-ওয়েট',
    license: 'যাচাই বাকি',
    commercialUse: 'unknown',
    status: 'planned',
    capabilities: { would: 'সম্পূর্ণ গান (কণ্ঠসংগীত) সংশ্লেষণ', vram: '১২GB+' },
    hardwareNotes: 'GPU প্রয়োজন',
    notes: 'বাংলা উচ্চারণ, লিরিক্স-আনুগত্য ও ভয়েস-রাইটস আলাদাভাবে যাচাই করতে হবে (মাস্টার প্ল্যান §৪)।',
    sortOrder: 74,
  },
];
