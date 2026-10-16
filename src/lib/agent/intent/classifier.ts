// ============================================================
// Intent classifier — Phase-4 Workstream B (নিয়ম-ভিত্তিক, নির্ধারক,
// পরীক্ষাযোগ্য)।
//
// নীতিমালা:
//  - বিশুদ্ধ ফাংশন: কোনো DB/SDK/নেটওয়ার্ক নেই — প্রসঙ্গ কলার দেয়।
//  - শ্রেণিবিভাগনির্ধারণ ≠ সম্পাদনা: রিটার্ন-অবজেক্ট কেবল প্রস্তাব।
//  - সাধারণ প্রশ্ন/আলাপ কখনো প্রোডাকশন-পাইপলাইনে যায় না (general_chat)।
//  - সৎ-অসমর্থিত: গাওয়া গান/লিপ-সিঙ্ক/স্টেম-পৃথকীকরণ অনুরোধ
//    স্পষ্টভাবে unsupported — লুকানো বা নীরব প্রতিস্থাপন নয়।
//  - বাংলা + ইংরেজি + মিশ্র বার্তা সমানভাবে চেনা।
//  - দ্রুত-পথ শুধু বড়-কাজের (music_video/motion_video/short_film)
//    উচ্চ-আত্মবিশ্বাসের অনুরোধ-আকৃতির বার্তায়।
// ============================================================

import type { ProductionType } from '@/lib/types';
import type {
  CapabilityVerdict,
  IntentCategory,
  IntentClassification,
  IntentContext,
  IntentConfidence,
  IntentExtracted,
} from './types';

// ------------------------------------------------------------
// অভ্যন্তরীণ সহায়ক
// ------------------------------------------------------------

/** বাংলা সংখ্যা → ইংরেজি সংখ্যা (৩০ → 30) — দৈর্ঘ্য-উদ্ধারে দরকার */
function bnDigitsToEn(text: string): string {
  const bn = '০১২৩৪৫৬৭৮৯';
  return text.replace(/[০-৯]/g, d => String(bn.indexOf(d)));
}

/** বার্তা থেকে সেকেন্ড-দৈর্ঘ্য উদ্ধার ("৩০ সেকেন্ড", "30s", "2 min", "২ মিনিট") */
function extractDurationSec(message: string): number | undefined {
  const m = bnDigitsToEn(message);
  const sec = /(\d{1,4})\s*(?:সেকেন্ড|সেঃ|sec(?:onds?)?\.?|\bs\b)/i.exec(m);
  if (sec) return clampDuration(Number(sec[1]));
  const min = /(\d{1,3})\s*(?:মিনিট|min(?:utes?)?\.?)/i.exec(m);
  if (min) return clampDuration(Number(min[1]) * 60);
  return undefined;
}

/** যেকোনো ধরনের প্রোডাকশন-দৈর্ঘ্য ৫–৩০০ সে. সীমার ভেতরে (validateSpec-পূর্ব মোটা বাঁধা)।
 *  অবৈধ ইনপুটে undefined — কখনো NaN প্রসারিত হয় না। */
function clampDuration(n: number): number | undefined {
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(300, Math.max(5, Math.round(n)));
}

function extractAspect(message: string): string | undefined {
  const m = bnDigitsToEn(message);
  if (/9[:\-]by\-?16|9[:\-]16|vertical|ভার্টিক্যাল|শর্টস|shorts|reels|রিলস/i.test(m)) return '9:16';
  if (/16[:\-]by\-?9|16[:\-]9|landscape|ল্যান্ডস্কেপ|widescreen|ইউটিউব(?!.*শর্ট)/i.test(m)) return '16:9';
  if (/1[:\-]by\-?1\b|1[:\-]1\b|square|স্কয়ার|বর্গ/i.test(m)) return '1:1';
  if (/4[:\-]by\-?5|4[:\-]5|portrait|পোর্ট্রেট/i.test(m)) return '4:5';
  if (/3[:\-]by\-?2|3[:\-]2/i.test(m)) return '3:2';
  return undefined;
}

function extractFps(message: string): number | undefined {
  const m = bnDigitsToEn(message);
  const f = /(\d{2,3})\s*(?:fps|এফপিএস|ফ্রেম)/i.exec(m);
  if (!f) return undefined;
  const n = Number(f[1]);
  // 24/25/30 সমর্থিত; ৬০-জাতীয় চাওয়া হলে সেটিই ফেরত দিই — সীমার নোট প্যানেলে সৎভাবে দেখাবে
  return [24, 25, 30, 60, 50, 120].includes(n) ? n : undefined;
}

function extractResolution(message: string): string | undefined {
  const m = bnDigitsToEn(message);
  if (/4k|2160|৪কে/i.test(m)) return '4k';
  if (/1080p?|ফুলএইচডি|full\s*hd|fhd/i.test(m)) return '1080p';
  if (/720p?|এইচডি\b|hd\b/i.test(m)) return '720p';
  return undefined;
}

function extractMood(message: string): string | undefined {
  if (/রোমান্টিক|romantic|ভালোবাস/i.test(message)) return 'romantic';
  if (/বিষণ্ণ|দুঃখ|sad|melanchol/i.test(message)) return 'sad';
  if (/আনন্দ|হাসি|joyful|happy|cheerful/i.test(message)) return 'joyful';
  if (/রহস্য|সাসপেন্স|suspense|mystery|thriller/i.test(message)) return 'suspense';
  if (/অ্যাকশন|action/i.test(message)) return 'action';
  if (/শান্ত|peaceful|calm|মনোরম/i.test(message)) return 'peaceful';
  return undefined;
}

function extractStyle(message: string): string | undefined {
  if (/সিনেম্যাটিক|cinematic/i.test(message)) return 'cinematic';
  if (/অ্যানিমে|anime/i.test(message)) return 'anime';
  if (/ফ্যান্টাসি|fantasy/i.test(message)) return 'fantasy';
  if (/রেট্রো|retro|ভিনটেজ|vintage/i.test(message)) return 'retro';
  if (/নিয়ন|সাইবারপাংক|neon|cyberpunk/i.test(message)) return 'neon-cyberpunk';
  if (/ন্যাচারাল|natural|বাস্তবসম্মত/i.test(message)) return 'natural';
  if (/ডকুমেন্টারি|documentary/i.test(message)) return 'documentary';
  return undefined;
}

/** অনুরোধ-আকৃতির ক্রিয়া-সংকেত (বানাও-জাতীয়) — প্রশ্ন-আকৃতি থেকে আলাদা */
const CREATE_VERB =
  /বানাও|বানাতে|বানিয়ে|তৈরি|টাইরি|করে দাও|করে দেও|করতে চাই|চাই|দরকার|লাগবে|হবে|খুলে দাও|create|make|generate|build|produce|বানিরে|বানান/i;

/** প্রশ্ন-আকৃতির সংকেত — অনুরোধ-আকৃতির ক্রিয়া থাকলেও প্রশ্নকে আলাপ বলেই ধরা হয় */
const QUESTION_SHAPE =
  /কীভাবে|কিভাবে|কেন|কেমন করে|কি ভাবে|কোথায়|কখন|কার জন্য|how\s+(do|does|can|to|would)|why\b|what\s+is|explain|ব্যাখ্যা কর|explain কর|শেখাও|tutorial|টিউটোরিয়াল|\?$/i;

/** জ্ঞান-অন্বেষণ-সংকেত — অনুরোধ-ক্রিয়া থাকলেও প্রশ্নই জিতবে ("জানতে চাই") */
const FORCE_QUESTION =
  /জানতে চাই|জানতে|জানা যায়|বুঝতে চাই|বুঝি না|শেখাও|explain|tell me about|কী করে কাজ|কিভাবে কাজ|কীভাবে কাজ/i;

function isQuestionShaped(message: string): boolean {
  const msg = message.trim();
  if (FORCE_QUESTION.test(msg)) return true;
  if (QUESTION_SHAPE.test(msg)) {
    // "কীভাবে বানানো হয়?" প্রশ্ন; কিন্তু "কীভাবে সুন্দর বানাও" অনুরোধ —
    // শেষে অনুরোধ-ক্রিয়া + প্রশ্ন-চিহ্ন নেই হলে অনুরোধই জিতবে।
    if (/\?\s*$/.test(msg) || !CREATE_VERB.test(msg)) return true;
  }
  return false;
}

/** গাওয়া-গান (singing) আউটপুট চাওয়া হয়েছে কি না — সৎ-অসমর্থিত শাখার ভিত্তি।
 *  ক্রিয়া-রূপের বৈচিত্র্য: গাওয়া/গাইবে/গেয়ে/গাইয়ে/গেয়েছে/গায় — সবই গাওয়া-প্রত্যাশা */
const SUNG_OUTPUT =
  /গাওয়া|গাইবে|গাইতে|গাওয়াবে|গেয়ে|গাইয়ে|গেয়েছে|গাইল|ভোকালিস্ট|ভোকাল গান|singing|sung song|sing\s+(a\s+)?(song|it)|vocals?\s+(only|track)|গায়ক|গায়িকা|গাইছে/i;
/** "গান বানাও" জাতীয় বাক্যেও গাওয়ার ইঙ্গিত থাকতে পারে — আলাদা ঢঙে ধরা */
const SONG_MAKE = /গান\s*(বানাও|বানিয়ে|করে?\s*দাও|তৈরি|চাই)|song\s*(make|create|write|generate)/i;

const LIP_SYNC = /লিপ.?সিঙ্ক|লিপসিঙ্ক|(মুখ|ঠোঁট)\s*(মেলাও|মিলিয়ে|মিলাও|মিলিয়ে দাও)|lip.?sync/i;
const STEM_SEP = /স্টেম|স্টিম|stem|কণ্ঠ আলাদা|আওয়াজ আলাদা|separat(e|ion)/i;

const MUSIC_VIDEO =
  /মিউজিক\s*ভিডিও|মিউজিকভিডিও|গানে?র?\s*(ভিডিও|ভিডও|বিডিও)|music\s*video|\bmv\b/i;
const SHORT_FILM =
  /শর্ট\s*ফিল্ম|শর্টফিল্ম|ছোট\s*ফিল্ম|সিনেমা|চলচ্চিত্র|ফিল্ম|ফ্লিম|short\s*film|\bmovie\b|\bfilm\b/i;
const MOTION_VIDEO =
  /মোশন\s*ভিডিও|motion\s*video|মোশন বানাও|এনিমেট|animate|ভিডিও বানাও|video\s*(make|create|generate)|make (me )?a video/i;
const VIDEO_EDIT =
  /ভিডিও\w*\s*(কাট|কেট|ট্রিম|জোড়া|সম্পাদনা|এডিট)|(কাট|কেট|ট্রিম|জোড়া|এডিট)\s*ভিডিও|trim|cut\s+(the\s+)?video|merge\s+video|concat|সাবটাইটেল বসাও|subtitle/i;
const IMAGE_EDIT =
  /ছবি\w*\s*(সম্পাদনা|এডিট|বদলাও|পরিবর্তন)|এডিট|সম্পাদনা কর|পটভূমি সরাও|ব্যাকগ্রাউন্ড সরাও|remove\s+background|inpaint|restyle|রি-?স্টাইল|রং ঠিক|color\s+(grade|correct)|ছবি পরিষ্কার|enhance (the )?(image|photo)|upscale/i;
const IMAGE_SEARCH = /ছবি\w*\s*(খোঁজো|খুঁজে|খুঁজো|দেখাও|দাও)|ওয়েব থেকে ছবি|image search|search (for )?(images|photos)|find (me )?(images|photos|pictures)|প্রকৃত ছবি|বাস্তব ছবি/i;
const IMAGE_GENERATE =
  /ছবি\s*আঁকো|এঁকে|আঁকা|পোস্টার|poster|ইলাস্ট্রেশন|illustration|লোগো|logo|draw|paint|image\s*(make|create|generate|banao)|ছবি বানাও|generate (an? )?(image|picture)|AI দিয়ে ছবি/i;
const MUSIC_GENERATE =
  /ইনস্ট্রু?মেন্টাল|instrumental|শুধু?\s*সুর|সুর\s*(বানাও|তৈরি)|বিট\s*(বানাও|তৈরি)|beat\s*(make|create)|ব্যাকগ্রাউন্ড\s*মিউজিক|background\s*music|lo-?fi|সুর দাও|melody|মিউজিক বানাও|music\s*(make|create|generate)/i;
const SPEECH_VOICEOVER =
  /ভয়েসওভার|voice\s*over|voiceover|কণ্ঠে|নরম কণ্ঠে|পড়ে শোনাও|শুনিয়ে দাও|বলে ফেলো|বলো ফেলো|text\s*to\s*speech| tts\b|কণ্ঠ দাও|narration|বর্ণনা করে শোনাও|অডিও বুক/i;
const AUDIO_PROCESS =
  /অডিও\w*\s*(প্রসেস|পরিষ্কার|নরমালাইজ|কাট|জোড়া|ভলিউম|কনভার্ট)|audio\s*(process|clean|normalize|trim|merge|convert|boost)|(নরমালাইজ|ভলিউম বাড়াও|ভলিউম কমাও).*অডিও|convert (to )?(mp3|wav)/i;

/** আলাপ-সংকেত: শুভেচ্ছা, সাধারণ আলোচনা, নিজের সক্ষমতা নিয়ে প্রশ্ন */
const CHAT_ONLY =
  /হ্যালো|hello|hi\b|কেমন আছ|আসসালাম|ধন্যবাদ|thanks|thank you|তুমি কে|তোমার নাম|কি পারো|পারবে কি|কী পারো|what can you do|তোমার কী কী কাজ|সক্ষমতা|ক্যাপাবিলিটি/i;

// ------------------------------------------------------------
// ফ্যাক্ট্রি-সহায়ক: পূর্ণ অবজেক্ট বানানোর সাধারণ খোল
// ------------------------------------------------------------

function baseClassification(
  category: IntentCategory,
  confidence: IntentConfidence,
  reason: string,
  ctx: IntentContext
): IntentClassification {
  const uploads = ctx.uploads ?? [];
  return {
    category,
    confidence,
    reason,
    extracted: {},
    inputAssets: {
      hasImageUpload: uploads.some(u => u.kind === 'image'),
      hasAudioUpload: uploads.some(u => u.kind === 'audio'),
      hasVideoUpload: uploads.some(u => u.kind === 'video'),
    },
    proposedWorkflow: { directTools: [] },
    missingFields: [],
    capabilityStatus: 'supported',
    fastPathEligible: false,
  };
}

/** বড়-কাজের (video) সাধারণ উদ্ধার-সংযোগ + ইঞ্জিন-প্রস্তাব */
function applyVideoExtraction(c: IntentClassification, message: string, ctx: IntentContext): void {
  const ex: IntentExtracted = { ...c.extracted };
  const dur = extractDurationSec(message);
  if (dur !== undefined) ex.durationSec = dur;
  const aspect = extractAspect(message);
  if (aspect !== undefined) ex.aspect = aspect;
  const style = extractStyle(message);
  if (style !== undefined) ex.style = style;
  const mood = extractMood(message);
  if (mood !== undefined) ex.mood = mood;
  const fps = extractFps(message);
  if (fps !== undefined) ex.fps = fps;
  const res = extractResolution(message);
  if (res !== undefined) ex.resolution = res;
  if (/ইংরেজি|english|in english/i.test(message)) ex.language = 'en';
  if (ex.wantsSungSong === undefined && SUNG_OUTPUT.test(message)) ex.wantsSungSong = true;
  if (!ex.wantsLipSync && LIP_SYNC.test(message)) ex.wantsLipSync = true;
  c.extracted = ex;
  c.suggestedEngine = ctx.cloudBlocked ? 'cinematic_motion' : 'ai_diffusion';
}

// ------------------------------------------------------------
// মূল শ্রেণিবিভাজক
// ------------------------------------------------------------

export function classifyIntent(message: string, ctx: IntentContext = {}): IntentClassification {
  const msg = (message ?? '').trim();
  if (msg.length < 3) {
    const c = baseClassification('unsupported_or_ambiguous', 'low', 'বার্তা খালি/অতি ছোট', ctx);
    c.capabilityStatus = 'requires_clarification';
    c.clarificationQuestion = 'কী তৈরি করতে চান — ছবি, অডিও, নাকি ভিডিও?';
    return c;
  }

  const question = isQuestionShaped(msg);

  // --- ০. সৎ-অসমর্থিত ক্ষমতা-চাওয়া (সবার আগে — গাওয়া/লিপ-সিঙ্ক/স্টেম) ---
  if (LIP_SYNC.test(msg)) {
    const c = baseClassification(
      'unsupported_or_ambiguous',
      'high',
      'লিপ-সিঙ্ক চাওয়া হয়েছে — লিপ-সিঙ্ক মডেল নেই (সৎ-অসমর্থিত)',
      ctx
    );
    c.extracted.wantsLipSync = true;
    c.capabilityStatus = 'unsupported';
    c.proposedWorkflow.directTools = [];
    c.clarificationQuestion =
      'লিপ-সিঙ্ক মডেল এখন নেই — ঠোঁট মেলানো দাবি করা হয় না। বিকল্প: সংলাপ-অডিও + সাবটাইটেলসহ শর্টফিল্ম বা মিউজিক ভিডিও চান?';
    return c;
  }
  if (SUNG_OUTPUT.test(msg) && !MUSIC_VIDEO.test(msg)) {
    // "গান গেয়ে দাও" জাতীয় — গাওয়া আউটপুট চাওয়া; মিউজিক-ভিডিওর সাথে না হলে স্পষ্ট অসমর্থিত
    const c = baseClassification(
      'unsupported_or_ambiguous',
      'high',
      'গাওয়া গান (singing) চাওয়া হয়েছে — গাওয়ার মডেল নেই (সৎ-অসমর্থিত)',
      ctx
    );
    c.extracted.wantsSungSong = true;
    c.capabilityStatus = 'unsupported';
    c.clarificationQuestion =
      'গান গাওয়ার (singing) মডেল এখন চালু নেই — ভুয়া গান বানানো হবে না। বিকল্প: ইনস্ট্রুমেন্টাল সুর, লিরিক্স লেখা, বা নিজের গান আপলোড?';
    return c;
  }
  if (STEM_SEP.test(msg)) {
    const c = baseClassification(
      'unsupported_or_ambiguous',
      'medium',
      'স্টেম-পৃথকীকরণ চাওয়া হয়েছে — সক্ষমতাটি অবরুদ্ধ',
      ctx
    );
    c.capabilityStatus = 'unsupported';
    c.clarificationQuestion =
      'স্টেম-পৃথকীকরণ (কণ্ঠ/বাদ্য আলাদা করা) এখন সমর্থিত নয়। নিজের গান আপলোড করলে সেটি দিয়ে মিউজিক ভিডিও বানানো যায় — চান?';
    return c;
  }

  // --- ০-ক. প্রশ্ন-আকৃতির বার্তা কখনো প্রোডাকশনে যায় না (§4-B.11)।
  //       উৎপাদন-শব্দ থাকলেও প্রশ্ন হলে general_chat; LLM পথ পূর্ণ বার্তা
  //       দেখে দরকার হলে টুলই বেছে নিতে পারবে — শ্রেণিবিভাগনির্ধারণ প্রস্তাব মাত্র।
  //       (নিরাপত্তা-দিক: মিথ্যা-নেতিবাচক হলে দ্রুত-পথ বন্ধ থাকে — সবচেয়ে খারাপ
  //       অবস্থায় শুধু লেটেন্সি-সুবিধা হারায়, ভুল প্রোডাকশন তৈরি হয় না।)
  if (question || CHAT_ONLY.test(msg)) {
    const c = baseClassification(
      'general_chat',
      question ? 'high' : 'medium',
      question ? 'প্রশ্ন-আকৃতির বার্তা — সরাসরি উত্তর, প্রোডাকশন নয়' : 'সাধারণ আলাপ-সংকেত',
      ctx
    );
    return c;
  }

  // --- ১. মিউজিক ভিডিও (সবচেয়ে নির্দিষ্ট ভিডিও-ধরন — আগে) ---
  if (MUSIC_VIDEO.test(msg)) {
    const c = baseClassification('music_video', 'high', 'মিউজিক-ভিডিও প্যাটার্ন মিলেছে', ctx);
    applyVideoExtraction(c, msg, ctx);
    // গাওয়া-প্রসঙ্গ: "গান দিয়ে" = সঙ্গীত-উৎস, "গেয়ে/গাওয়া" = গাওয়া-আউটপুট
    if (SUNG_OUTPUT.test(msg)) c.extracted.wantsSungSong = true;
    if (/আপলোড|নিজের গান|my song|আমার গান|এই গান|uploaded/i.test(msg)) c.extracted.mentionsSongUpload = true;
    c.proposedWorkflow.productionType = 'music_video';
    c.capabilityStatus = 'supported_with_limitations';
    c.fastPathEligible = !question && !c.extracted.wantsSungSong;
    // গান-প্রত্যাশা কিন্তু আপলোড নেই → উপাদান-স্পষ্টীকরণ দরকার (প্রসিডিউরাল বিকল্প সৎভাবে বলা যায়,
    // তবে ব্যবহারকারী নিজের গানই চাইলে প্রশ্নই ন্যায্য) — দ্রুত-পথ বন্ধ, প্রশ্ন থাকবে।
    if (c.extracted.mentionsSongUpload && !c.inputAssets.hasAudioUpload) {
      c.fastPathEligible = false;
      c.missingFields.push('গানের অডিও ফাইল');
      c.clarificationQuestion =
        'আপলোড করা কোনো গান পাওয়া যায়নি — নিজের গানের অডিও আপলোড করবেন, নাকি প্রসিডিউরাল ইনস্ট্রুমেন্টাল সুর (পরীক্ষামূলক, গাওয়া নয়) দিয়ে চালাবো?';
    }
    return c;
  }

  // --- ২. শর্ট ফিল্ম ---
  if (SHORT_FILM.test(msg)) {
    const c = baseClassification('short_film', 'high', 'শর্টফিল্ম/সিনেমা প্যাটার্ন মিলেছে', ctx);
    applyVideoExtraction(c, msg, ctx);
    c.proposedWorkflow.productionType = 'short_film';
    c.capabilityStatus = 'supported_with_limitations';
    c.fastPathEligible = !question;
    return c;
  }

  // --- ৩. মোশন ভিডিও ---
  if (MOTION_VIDEO.test(msg) && !VIDEO_EDIT.test(msg)) {
    const c = baseClassification('motion_video', 'high', 'মোশন-ভিডিও প্যাটার্ন মিলেছে', ctx);
    applyVideoExtraction(c, msg, ctx);
    c.proposedWorkflow.productionType = 'motion_video';
    c.capabilityStatus = 'supported_with_limitations';
    c.fastPathEligible = !question;
    return c;
  }

  // --- ৪. ভিডিও সম্পাদনা ---
  if (VIDEO_EDIT.test(msg)) {
    const hasVideo = (ctx.uploads ?? []).some(u => u.kind === 'video');
    const c = baseClassification(
      'video_edit',
      hasVideo ? 'high' : 'medium',
      hasVideo ? 'ভিডিও-সম্পাদনা ক্রিয়া + ভিডিও আপলোড উপস্থিত' : 'ভিডিও-সম্পাদনা ক্রিয়া — কিন্তু আপলোড নেই',
      ctx
    );
    c.proposedWorkflow.directTools = ['process_video'];
    if (hasVideo) {
      c.capabilityStatus = 'supported_with_limitations';
    } else {
      // সৎ-স্পষ্টীকরণ: সম্পাদনার উৎস-ভিডিও নেই — অনুমান নয়, আপলোড-অনুরোধ
      c.capabilityStatus = 'requires_clarification';
      c.missingFields.push('সম্পাদনার ভিডিও ফাইল');
      c.clarificationQuestion = 'কোন ভিডিও সম্পাদনা করবো? ভিডিও ফাইলটি আপলোড করুন।';
    }
    return c;
  }

  // --- ৫. ছবি সম্পাদনা ---
  if (IMAGE_EDIT.test(msg)) {
    const hasImage = (ctx.uploads ?? []).some(u => u.kind === 'image');
    const c = baseClassification(
      'image_edit',
      hasImage ? 'high' : 'medium',
      hasImage ? 'ছবি-সম্পাদনা ক্রিয়া + ছবি আপলোড উপস্থিত' : 'ছবি-সম্পাদনা ক্রিয়া — কিন্তু আপলোড নেই',
      ctx
    );
    c.proposedWorkflow.directTools = ['edit_image', 'remove_background', 'restyle_image', 'enhance_image'];
    if (hasImage) {
      c.capabilityStatus = 'supported';
    } else {
      c.capabilityStatus = 'requires_clarification';
      c.missingFields.push('সম্পাদনার ছবি ফাইল');
      c.clarificationQuestion = 'কোন ছবি সম্পাদনা করবো? ছবিটি আপলোড করুন।';
    }
    return c;
  }

  // --- ৬. ছবি অনুসন্ধান (বাস্তব ছবি খোঁজা — তৈরি নয়) ---
  if (IMAGE_SEARCH.test(msg) && !IMAGE_GENERATE.test(msg)) {
    const c = baseClassification('image_search', 'high', 'ওয়েবে ছবি-অনুসন্ধান প্যাটার্ন', ctx);
    c.proposedWorkflow.directTools = ['search_images'];
    c.capabilityStatus = 'supported';
    return c;
  }

  // --- ৭. ছবি তৈরি ---
  if (IMAGE_GENERATE.test(msg)) {
    const c = baseClassification('image_generate', 'high', 'ছবি-তৈরি প্যাটার্ন', ctx);
    const aspect = extractAspect(msg);
    if (aspect !== undefined) c.extracted.aspect = aspect;
    const style = extractStyle(msg);
    if (style !== undefined) c.extracted.style = style;
    c.proposedWorkflow.directTools = ['generate_image'];
    c.proposedWorkflow.productionType = 'image';
    c.capabilityStatus = 'supported';
    return c;
  }

  // --- ৮. ইনস্ট্রুমেন্টাল/সুর তৈরি ---
  if (MUSIC_GENERATE.test(msg) && !SUNG_OUTPUT.test(msg)) {
    const c = baseClassification('music_generate', 'high', 'ইনস্ট্রুমেন্টাল/সুর-তৈরি প্যাটার্ন', ctx);
    const dur = extractDurationSec(msg);
    if (dur !== undefined) c.extracted.durationSec = dur;
    const mood = extractMood(msg);
    if (mood !== undefined) c.extracted.mood = mood;
    c.proposedWorkflow.directTools = ['generate_instrumental'];
    c.proposedWorkflow.productionType = 'audio';
    // সৎ-সীমা: প্রসিডিউরাল সংশ্লেষণ — নিউরাল মিউজিক-মডেল নয়
    c.capabilityStatus = 'supported_with_limitations';
    return c;
  }

  // --- ৯. ভাষণ/ভয়েসওভার ---
  if (SPEECH_VOICEOVER.test(msg)) {
    const c = baseClassification('speech_or_voiceover', 'high', 'ভাষণ/ভয়েসওভার প্যাটার্ন', ctx);
    if (/ইংরেজি|english/i.test(msg)) c.extracted.language = 'en';
    c.proposedWorkflow.directTools = ['speech_synthesis'];
    c.proposedWorkflow.productionType = 'audio';
    c.capabilityStatus = 'supported';
    return c;
  }

  // --- ১০. অডিও প্রসেসিং ---
  if (AUDIO_PROCESS.test(msg)) {
    const c = baseClassification('audio_generate', 'medium', 'অডিও-প্রসেসিং প্যাটার্ন', ctx);
    c.proposedWorkflow.directTools = ['process_audio', 'mix_audio'];
    c.capabilityStatus = 'supported';
    return c;
  }

  // --- ১১. অন্য সবকিছু: অস্পষ্ট ---
  const c = baseClassification(
    'unsupported_or_ambiguous',
    'low',
    'কোনো নিয়মের সাথেই স্পষ্ট মিল হয়নি',
    ctx
  );
  c.capabilityStatus = 'requires_clarification';
  c.clarificationQuestion = 'কী তৈরি করতে চান? যেমন: মিউজিক ভিডিও, শর্টফিল্ম, ছবি, ভয়েসওভার বা ইনস্ট্রুমেন্টাল সুর।';
  return c;
}

// ------------------------------------------------------------
// ইন্টেন্ট → CreativeJobSpec প্রাথমিক খসড়া (দ্রুত-পথ + ফলব্যাক উভয়ে)
// চূড়ান্ত যুক্তি সবসময় validateSpec-এ — এটি শুধু প্রস্তাবিত খসড়া।
// ------------------------------------------------------------

export function specDraftFromIntent(
  classification: IntentClassification,
  message: string
): { type: ProductionType; title: string; [k: string]: unknown } | null {
  const t = classification.proposedWorkflow.productionType;
  if (!t) return null;
  const flat = (message ?? '').replace(/\s+/g, ' ').trim();
  const title = (flat.slice(0, 40) + (flat.length > 40 ? '…' : '')) || 'ক্রিয়েটিভ কাজ';
  const ex = classification.extracted;
  const spec: { type: ProductionType; title: string; [k: string]: unknown } = { type: t, title };

  if (t === 'music_video' || t === 'motion_video' || t === 'short_film') {
    if (t === 'music_video') (spec as any).idea = flat.slice(0, 2000);
    if (t === 'short_film') (spec as any).story = flat.slice(0, 4000);
    if (t === 'motion_video') (spec as any).idea = flat.slice(0, 2000);
    (spec as any).durationSec = ex.durationSec ?? (t === 'motion_video' ? 12 : t === 'music_video' ? 40 : 40);
    (spec as any).aspect = ex.aspect ?? (t === 'short_film' ? '16:9' : t === 'motion_video' ? '16:9' : '9:16');
    (spec as any).quality = 'standard';
    (spec as any).videoEngine = classification.suggestedEngine ?? 'ai_diffusion';
    if (t === 'music_video') (spec as any).musicSource = 'procedural';
    if (ex.style !== undefined) (spec as any).style = ex.style;
    if (ex.mood !== undefined) (spec as any).mood = ex.mood;
    if (ex.fps !== undefined) (spec as any).fps = ex.fps;
    if (ex.resolution !== undefined && ['720p', '1080p'].includes(ex.resolution)) {
      (spec as any).resolution = ex.resolution;
    }
  } else if (t === 'image') {
    (spec as any).instructions = flat.slice(0, 2000);
    (spec as any).quality = 'standard';
    if (ex.aspect !== undefined) (spec as any).aspect = ex.aspect;
  } else if (t === 'audio') {
    const instrumental = classification.category === 'music_generate';
    (spec as any).audioOperation = instrumental ? 'instrumental' : 'voiceover';
    (spec as any).text = flat.slice(0, 2000);
    (spec as any).durationSec = ex.durationSec ?? 30;
    (spec as any).quality = 'standard';
    if (ex.mood !== undefined) (spec as any).mood = ex.mood;
  }
  return spec;
}

/** সৎ-বিকল্প-বার্তা: অসমর্থিত ক্ষমতার জন্য (একই স্বর, শ্রেণিবিভাজকের সাথে সামঞ্জস্য) */
export function unsupportedAlternativeText(c: IntentClassification): string | null {
  if (c.extracted.wantsLipSync) {
    return 'লিপ-সিঙ্ক মডেল নেই — চরিত্রের মুখের নড়াচড়ার দাবি করা হয় না। বিকল্প: সংলাপ-অডিও + সাবটাইটেল।';
  }
  if (c.extracted.wantsSungSong) {
    return 'গান গাওয়ার (singing) মডেল এখন চালু নেই — ভুয়া গান বানানো হবে না। বিকল্প: ইন্স্ট্রুমেন্টাল সুর (পরীক্ষামূলক), লিরিক্স লেখা, বা নিজের গান আপলোড করা।';
  }
  return null;
}

/** ভেরডিক্ট → মানব-পাঠযোগ্য লেবেল (পর্যবেক্ষণ/নোটে) */
export function verdictLabelBn(v: CapabilityVerdict): string {
  switch (v) {
    case 'supported':
      return 'সমর্থিত';
    case 'supported_with_limitations':
      return 'সীমাসহ সমর্থিত';
    case 'unsupported':
      return 'অসমর্থিত';
    case 'requires_clarification':
      return 'স্পষ্টীকরণ প্রয়োজন';
    case 'temporarily_unavailable':
      return 'সাময়িকভাবে অনুপলব্ধ';
  }
}

// ------------------------------------------------------------
// LLM-ইঙ্গিত-নোট — শ্রেণিবিভাগনির্ধারণের ফল এজেন্ট-লুপের context-এ
// পাঠানোর একমাত্র রূপ। এটি কেবল রাউটিং-প্রস্তাব: LLM-এর টুল-কল সবসময়
// validateToolCall + (propose_job হলে) validateSpec দিয়েই যায়।
// ------------------------------------------------------------

export function buildIntentHintNote(c: IntentClassification): string {
  const bits: string[] = [
    `[ইন্টেন্ট-শ্রেণিবিভাগনির্ধারণ — নিয়ম-ভিত্তিক অভ্যন্তরীণ বিশ্লেষণ] শ্রেণি: ${c.category} (${c.confidence} আত্মবিশ্বাস)। কারণ: ${c.reason}`,
  ];
  const pw = c.proposedWorkflow;
  if (pw.productionType && (pw.productionType === 'music_video' || pw.productionType === 'short_film' || pw.productionType === 'motion_video')) {
    bits.push(
      `এটি বড় কাজের প্রস্তাবিত ধরন: ${pw.productionType} — অবশ্যই propose_job দিয়ে সেটিংস-সহ নিশ্চিতকরণ-প্রস্তাব দাও, সরাসরি তৈরি শুরু করবে না।`
    );
  } else if (pw.directTools.length > 0) {
    bits.push(`ছোট কাজের প্রাসঙ্গিক নিবন্ধিত টুল: ${pw.directTools.join(', ')}।`);
  }
  const ex = c.extracted;
  const exBits: string[] = [];
  if (ex.durationSec !== undefined) exBits.push(`দৈর্ঘ্য≈${ex.durationSec}s`);
  if (ex.aspect !== undefined) exBits.push(`অনুপাত=${ex.aspect}`);
  if (ex.style !== undefined) exBits.push(`স্টাইল=${ex.style}`);
  if (ex.mood !== undefined) exBits.push(`মুড=${ex.mood}`);
  if (ex.fps !== undefined) exBits.push(`fps=${ex.fps}`);
  if (ex.resolution !== undefined) exBits.push(`রেজোলিউশন-চাওয়া=${ex.resolution}`);
  if (ex.language !== undefined) exBits.push(`ভাষা=${ex.language}`);
  if (exBits.length > 0) {
    bits.push(`বার্তা থেকে উদ্ধৃত সংকেত: ${exBits.join(' · ')} — spec-এর টাইপড ফিল্ডে বসাও (প্রম্পট-টেক্সটে নয়)।`);
  }
  if (c.missingFields.length > 0) {
    bits.push(
      `অনুপস্থিত গুরুত্বপূর্ণ তথ্য: ${c.missingFields.join('; ')} — প্রথমে একটি সংক্ষিপ্ত প্রশ্ন করো; তবে বাকি সব স্পষ্ট থাকলে ডিফল্ট-সহ প্রস্তাবও দিতে পারো (ব্যবহারকারী কার্ডেই বদলাতে পারবেন)।`
    );
  }
  if (c.clarificationQuestion) {
    bits.push(`স্পষ্টীকরণ-প্রশ্নের প্রস্তাব: "${c.clarificationQuestion}" — প্রযোজ্য হলে অন্য কিছুর আগে এটিই জিজ্ঞাসা করো।`);
  }
  if (c.inputAssets.hasAudioUpload) {
    bits.push('ব্যবহারকারীর আপলোড-করা অডিও আছে — মিউজিক ভিডিওর প্রস্তাবে spec.songArtifactId-তে সেই artifact আইডি দাও।');
  }
  if (c.inputAssets.hasImageUpload) {
    bits.push('ব্যবহারকারীর আপলোড-করা ছবি আছে — প্রযোজ্য হলে sourceArtifactId / sourceImageArtifactId-তে artifact আইডি দাও।');
  }
  if (c.category === 'general_chat' && c.confidence !== 'low') {
    bits.push('বার্তাটি আলাপ/প্রশ্ন বলে চেনা হয়েছে — সাধারণ উত্তরই দাও; ব্যবহারকারী স্পষ্টভাবে কিছু তৈরি করতে না বললে প্রস্তাব-কার্ড বা টুল-কল করবে না।');
  }
  if (c.capabilityStatus === 'unsupported') {
    const alt = unsupportedAlternativeText(c);
    if (alt) bits.push(`সতর্কতা (সৎ-অসমর্থিত): ${alt}`);
  }
  return bits.join('\n');
}
