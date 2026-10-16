// ============================================================
// Intent types — Phase-4 Workstream B (Intent-Aware Routing)।
//
// শ্রেণিবিভাগ ও সাধারণীকৃত ইন্টেন্ট-অবজেক্ট — বিদ্যমান রিপোজিটরির
// শব্দভাণ্ডারে (ProductionType + নিবন্ধিত টুল-নাম) ম্যাপ করা।
// শ্রেণিবিভাগনির্ধারণ সম্পাদনা থেকে সম্পূর্ণ আলাদা: এই অবজেক্ট কখনোই
// নিজে কোনো প্রোডাকশন/টুল চালায় না — শুধু রাউটিং-প্রস্তাব দেয়।
// ============================================================

import type { ProductionType } from '@/lib/types';

/** শ্রেণিবিভাগের সম্পূর্ণ তালিকা (Phase-4 §4 Workstream B) */
export type IntentCategory =
  | 'image_generate'
  | 'image_edit'
  | 'image_search'
  | 'audio_generate'
  | 'music_generate'
  | 'music_video'
  | 'motion_video'
  | 'short_film'
  | 'video_edit'
  | 'speech_or_voiceover'
  | 'general_chat'
  | 'unsupported_or_ambiguous';

/** নিয়ম-ভিত্তিক আত্মবিশ্বাসের স্তর — প্রতিটি নিয়ম নিজের স্তর ঘোষণা করে */
export type IntentConfidence = 'high' | 'medium' | 'low';

/**
 * ক্ষমতা-যাচাইয়ের রায় — Workstream D-এর প্যানেল-ভেরডিক্টের সাথে একই
 * শব্দভাণ্ডার (structured result)। ইন্টেন্ট-পর্যায়ে এটি প্রাথমিক রায় মাত্র;
 * চূড়ান্ত রায় সবসময় সার্ভারের validateSpec-ই দেয়।
 */
export type CapabilityVerdict =
  | 'supported'
  | 'supported_with_limitations'
  | 'unsupported'
  | 'requires_clarification'
  | 'temporarily_unavailable';

/** কলার-প্রসঙ্গ: কথোপকথনে ব্যবহারকাতার আপলোড (শুধু kind-গণনা, কোনো ফাইল-অ্যাক্সেস নয়) */
export interface IntentUploadContext {
  kind: 'image' | 'audio' | 'video';
}

/** classifyIntent-এর ইনপুট-প্রসঙ্গ (মডিউলটি বিশুদ্ধ/পরীক্ষাযোগ্য রাখতে DB-মুক্ত) */
export interface IntentContext {
  uploads?: IntentUploadContext[];
  /** ক্লাউড ভিজ্যুয়াল-চ্যানেল ব্লকড (৪২৯-উইন্ডো) — ইঞ্জিন-নির্বাচনে সৎ ফলব্যাক */
  cloudBlocked?: boolean;
}

/** বার্তা থেকে উদ্ধৃত অনুরোধ-সংকেত (শুধু যাচাইযোগ্য মান; কাঁচা টেক্সট নয়) */
export interface IntentExtracted {
  durationSec?: number;
  aspect?: string;
  style?: string;
  mood?: string;
  language?: 'bn' | 'en';
  fps?: number;
  resolution?: string;
  /** গাওয়া-গান (singing) চাওয়া হয়েছে — সৎ-অসমর্থিত পথের সংকেত */
  wantsSungSong?: boolean;
  /** লিপ-সিঙ্ক চাওয়া হয়েছে — সৎ-অসমর্থিত */
  wantsLipSync?: boolean;
  /** ব্যবহারকারী আপলোড-করা গানের কথা বলেছেন (আপলোড আছে কি না আলাদা তথ্য) */
  mentionsSongUpload?: boolean;
}

/** প্রস্তাবিত কর্মপথ — বিদ্যমান শব্দভাণ্ডারে */
export interface ProposedWorkflow {
  /** বড় কাজের প্রোডাকশন-ধরন (createProduction-এর জন্য); ছোট/আলাপ কাজে অনুপস্থিত */
  productionType?: ProductionType;
  /** ছোট কাজে সরাসরি-চলনোর নিবন্ধিত টুল-নাম (প্রস্তাব মাত্র — LLM/রাউটার ঠিক করবে) */
  directTools: string[];
}

/** সাধারণীকৃত ইন্টেন্ট-অবজেক্ট (Phase-4 §4-এর ধারণাগত রূপ, রিপো-রীতিতে) */
export interface IntentClassification {
  category: IntentCategory;
  confidence: IntentConfidence;
  /** রাউটিং-সিদ্ধান্তের সংক্ষিপ্ত ব্যাখ্যা (বাংলা; পর্যবেক্ষণ/ডিবাগিং-উপযোগী) */
  reason: string;
  extracted: IntentExtracted;
  inputAssets: {
    hasImageUpload: boolean;
    hasAudioUpload: boolean;
    hasVideoUpload: boolean;
  };
  proposedWorkflow: ProposedWorkflow;
  /** গুরুত্বপূর্ণ অনুপস্থিত তথ্য (বাংলা লেবেল) — প্রশ্ন-প্রয়োজনীয়তার ভিত্তি */
  missingFields: string[];
  /** শুধু যখন অস্পষ্টতা কর্মপথ পাল্টে দেয় — একটি সংক্ষিপ্ত স্পষ্টীকরণ-প্রশ্ন */
  clarificationQuestion?: string;
  /** প্রাথমিক ক্ষমতা-রায় (চূড়ান্ত রায় validateSpec-এ) */
  capabilityStatus: CapabilityVerdict;
  /**
   * দ্রুত-পথ যোগ্য কি না: উচ্চ-আত্মবিশ্বাসের বড়-কাজ অনুরোধ, যাতে LLM
   * রাউন্ড-ট্রিপ ছাড়াই সরাসরি সৎ-লেবেলসহ প্রস্তাব-কার্ড তৈরি করা যায়।
   */
  fastPathEligible: boolean;
  /** cloudBlocked প্রসঙ্গে ইঞ্জিন-নির্বাচনের সৎ ফলব্যাক */
  suggestedEngine?: 'ai_diffusion' | 'cinematic_motion';
}
