// ============================================================
// SHARED CONTRACT — Agentic AI Creative Studio
// এই ফাইলটি frontend ও backend উভয়ের জন্য একমাত্র সত্যের উৎস।
// কোনো এজেন্ট পক্ষ চুক্তি ছাড়া এটি পরিবর্তন করবে না।
// ============================================================

export type ToolCategory =
  | 'research'
  | 'media'
  | 'vision'
  | 'audio'
  | 'memory'
  | 'image_studio'
  | 'audio_studio'
  | 'video_studio'
  | 'production';

export interface ToolInfo {
  name: string;
  title: string; // Bengali display title
  description: string; // Bengali short description
  icon: string; // lucide icon name
  category: ToolCategory;
}

// ------------------------------------------------------------
// Tool Catalog — সম্পূর্ণ তালিকা (মাস্টার প্ল্যানের সব স্টুডিও)
// ------------------------------------------------------------

export const TOOL_CATALOG: ToolInfo[] = [
  // ---- মূল এজেন্ট টুল (আগের ৮টি) ----
  {
    name: 'web_search',
    title: 'ওয়েব সার্চ',
    description: 'ইন্টারনেট থেকে সর্বশেষ তথ্য খুঁজে আনে',
    icon: 'Globe',
    category: 'research',
  },
  {
    name: 'read_web_page',
    title: 'ওয়েব পেজ পড়া',
    description: 'নির্দিষ্ট URL-এর পুরো বিষয়বস্তু পড়ে বোঝে',
    icon: 'FileText',
    category: 'research',
  },
  {
    name: 'generate_image',
    title: 'ছবি তৈরি',
    description: 'টেক্সট বর্ণনা থেকে AI দিয়ে নতুন ছবি আঁকে',
    icon: 'ImagePlus',
    category: 'media',
  },
  {
    name: 'search_images',
    title: 'ছবি খোঁজা',
    description: 'ওয়েব থেকে প্রাসঙ্গিক বাস্তব ছবি খুঁজে আনে',
    icon: 'Images',
    category: 'media',
  },
  {
    name: 'analyze_image',
    title: 'ছবি বিশ্লেষণ',
    description: 'ছবি দেখে প্রশ্নের উত্তর দেয়',
    icon: 'ScanEye',
    category: 'vision',
  },
  {
    name: 'text_to_speech',
    title: 'কণ্ঠ তৈরি (TTS)',
    description: 'লেখাকে স্বাভাবিক কণ্ঠের অডিওতে রূপ দেয়',
    icon: 'AudioLines',
    category: 'audio',
  },
  {
    name: 'speech_synthesis',
    title: 'ভাষা-নিশ্চিত কণ্ঠ (যাচাইসহ)',
    description: 'ভাষা শনাক্ত করে সঠিক কণ্ঠে TTS + ASR ব্যাক-চেক দিয়ে যাচাই করে',
    icon: 'Languages',
    category: 'audio',
  },
  {
    name: 'analyze_audio',
    title: 'অডিও বিশ্লেষণ',
    description: 'গান/অডিওর বিট-মার্কার, এনার্জি-বিভাগ ও টেম্পো বের করে',
    icon: 'AudioWaveform',
    category: 'audio_studio',
  },
  {
    name: 'transcribe_audio',
    title: 'অডিও লিপিবদ্ধকরণ',
    description: 'অডিও শুনে লেখিত রূপে রূপান্তর করে',
    icon: 'Mic',
    category: 'audio',
  },
  {
    name: 'search_conversations',
    title: 'স্মৃতি খোঁজা',
    description: 'পুরনো কথোপকথন থেকে প্রাসঙ্গিক তথ্য খুঁজে আনে',
    icon: 'History',
    category: 'memory',
  },

  // ---- Image Studio (মাস্টার প্ল্যান §৩ — ১২টি প্রয়োজনের সবকটি) ----
  {
    name: 'edit_image',
    title: 'ছবি সম্পাদনা',
    description: 'আপলোড করা ছবিতে স্বাভাবিক ভাষার নির্দেশে পরিবর্তন আনে',
    icon: 'Paintbrush',
    category: 'image_studio',
  },
  {
    name: 'inpaint_image',
    title: 'নির্দিষ্ট অংশ পূরণ',
    description: 'ছবির নির্দিষ্ট অংশ বর্ণনা অনুযায়ী নতুন করে আঁকে (generative fill)',
    icon: 'Brush',
    category: 'image_studio',
  },
  {
    name: 'remove_background',
    title: 'ব্যাকগ্রাউন্ড পরিবর্তন',
    description: 'পটভূমি সরিয়ে ফেলে বা নতুন পটভূমি বসায়',
    icon: 'Scissors',
    category: 'image_studio',
  },
  {
    name: 'remove_object',
    title: 'বস্তু অপসারণ',
    description: 'ছবি থেকে অবাঞ্ছিত বস্তু মুছে ফেলে',
    icon: 'Eraser',
    category: 'image_studio',
  },
  {
    name: 'restyle_image',
    title: 'স্টাইল রূপান্তর',
    description: 'ছবিকে নতুন শৈলীতে রূপান্তর করে (image-to-image)',
    icon: 'Wand2',
    category: 'image_studio',
  },
  {
    name: 'enhance_image',
    title: 'ছবি উন্নতকরণ',
    description: 'আপস্কেল, শার্পেন ও ডিনয়েজ করে ছবির মান বাড়ায়',
    icon: 'ZoomIn',
    category: 'image_studio',
  },
  {
    name: 'color_grade_image',
    title: 'রং সংশোধন',
    description: 'উজ্জ্বলতা, স্যাচুরেশন, হিউ ও কনট্রাস্ট নিয়ন্ত্রণ করে',
    icon: 'Palette',
    category: 'image_studio',
  },
  {
    name: 'transform_image',
    title: 'ক্রপ/রিসাইজ/ঘোরানো',
    description: 'ছবি ক্রপ, রিসাইজ, ঘোরানো, ফ্লিপ ও অনুপাত বদলায়',
    icon: 'Crop',
    category: 'image_studio',
  },
  {
    name: 'compose_text_image',
    title: 'টাইপোগ্রাফি/পোস্টার',
    description: 'ছবিতে বাংলা/ইংরেজি লেখা বসিয়ে পোস্টার, থাম্বনেইল, ব্যানার বানায়',
    icon: 'Type',
    category: 'image_studio',
  },
  {
    name: 'export_image',
    title: 'ফরম্যাট রপ্তানি',
    description: 'PNG, JPEG বা WebP ফরম্যাটে মানসম্মত রপ্তানি করে',
    icon: 'FileOutput',
    category: 'image_studio',
  },
  {
    name: 'inspect_image',
    title: 'ছবির গুণমান পরীক্ষা',
    description: 'মাত্রা, ফরম্যাট, ঝাপসা ভাব ইত্যাদি পরীক্ষা করে রিপোর্ট দেয়',
    icon: 'ScanSearch',
    category: 'image_studio',
  },

  // ---- Audio Studio (মাস্টার প্ল্যান §৪) ----
  {
    name: 'plan_music',
    title: 'গানের কাঠামো পরিকল্পনা',
    description: 'গানের কথা, সুরের ধরন, টেম্পো ও সেকশন-পরিকল্পনা তৈরি করে',
    icon: 'Music4',
    category: 'audio_studio',
  },
  {
    name: 'generate_instrumental',
    title: 'ইনস্ট্রুমেন্টাল (পরীক্ষামূলক)',
    description: 'মুড/টেম্পো-সচেতন প্রসিডিউরাল সংগীত-সংশ্লেষণ + বিট-মার্কার',
    icon: 'Piano',
    category: 'audio_studio',
  },
  {
    name: 'generate_singing',
    title: 'কণ্ঠসংগীত (ভবিষ্যৎ)',
    description:
      'গান-জেনারেশন মডেল (ACE-Step/YuE) — লাইসেন্স অ-বাণিজ্যিকে অনুমোদিত, কিন্তু GPU-হীন এই পরিবেশে ও SDK-API-তে চালু নয়',
    icon: 'MicVocal',
    category: 'audio_studio',
  },
  {
    name: 'separate_stems',
    title: 'স্টেম পৃথকীকরণ (ভবিষ্যৎ)',
    description:
      'কণ্ঠ/বাদ্য পৃথক করার মডেল (Demucs) — এই পরিবেশে মডেল-ইনস্টল/হার্ডওয়্যার-বাধায় চালু নয়',
    icon: 'Split',
    category: 'audio_studio',
  },
  {
    name: 'process_audio',
    title: 'অডিও সম্পাদনা',
    description: 'ট্রিম, জোড়া, ফেড, ভলিউম, নরমালাইজ, ইকুয়ালাইজ, কমপ্রেস, রিভার্ব, রূপান্তর',
    icon: 'SlidersHorizontal',
    category: 'audio_studio',
  },
  {
    name: 'mix_audio',
    title: 'অডিও মিক্সিং',
    description: 'একাধিক ট্র্যাক মিক্স করে (ভলিউম ব্যালেন্স, ডাকিং, ক্রসফেড)',
    icon: 'Blend',
    category: 'audio_studio',
  },
  {
    name: 'validate_audio',
    title: 'অডিও গুণমান পরীক্ষা',
    description: 'দৈর্ঘ্য, স্যাম্পল-রেট, পিক, ক্লিপিং, নীরবতা ও লাউডনেস যাচাই করে',
    icon: 'AudioWaveform',
    category: 'audio_studio',
  },
  {
    name: 'inspect_media',
    title: 'মিডিয়া পরিদর্শন',
    description: 'অডিও/ভিডিও ফাইলের মেটাডেটা (দৈর্ঘ্য, কোডেক, রেজোলিউশন) দেখায়',
    icon: 'FileSearch',
    category: 'audio_studio',
  },

  // ---- Video Studio (মাস্টার প্ল্যান §৫) ----
  {
    name: 'plan_video',
    title: 'দৃশ্য-পরিকল্পনা',
    description: 'আইডিয়াকে দৃশ্য ও শট-তালিকায় ভাগ করে (ক্যামেরা, দৈর্ঘ্য, অভিনয়)',
    icon: 'Clapperboard',
    category: 'video_studio',
  },
  {
    name: 'generate_video',
    title: 'রিয়েল AI ভিডিও',
    description: 'CogVideoX-3 ডিফিউশন মডেলে লেখা থেকে প্রকৃত চলমান দৃশ্য',
    icon: 'Film',
    category: 'video_studio',
  },
  {
    name: 'image_to_video',
    title: 'ছবি → রিয়েল AI ভিডিও',
    description: 'রেফারেন্স ছবি থেকে CogVideoX-3 দিয়ে চলমান দৃশ্য তৈরি',
    icon: 'ImagePlay',
    category: 'video_studio',
  },
  {
    name: 'animate_image',
    title: 'ছবি থেকে ভিডিও',
    description: 'স্থির ছবিতে ক্যামেরা-মুভমেন্ট যোগ করে চলমান দৃশ্য বানায়',
    icon: 'ImagePlay',
    category: 'video_studio',
  },
  {
    name: 'process_video',
    title: 'ভিডিও সম্পাদনা',
    description: 'ট্রিম, জোড়া, স্পিড, ক্রপ, রেজোলিউশন, ট্রানজিশন ও অডিও সংযোজন',
    icon: 'ScissorsLineDashed',
    category: 'video_studio',
  },
  {
    name: 'enhance_video',
    title: 'ভিডিও উন্নতকরণ',
    description: 'কালার গ্রেডিং, শার্পেন, ডিনয়েজ ও স্ট্যাবিলাইজ করে',
    icon: 'Sparkle',
    category: 'video_studio',
  },
  {
    name: 'interpolate_video',
    title: 'ফ্রেম ইন্টারপোলেশন',
    description: 'ফ্রেম-রেট বাড়িয়ে মোশন মসৃণ করে (minterpolate)',
    icon: 'Gauge',
    category: 'video_studio',
  },
  {
    name: 'generate_subtitles',
    title: 'সাবটাইটেল তৈরি',
    description: 'স্ক্রিপ্ট/সংলাপ থেকে SRT সাবটাইটেল ফাইল বানায়',
    icon: 'Captions',
    category: 'video_studio',
  },
  {
    name: 'validate_video',
    title: 'ভিডিও গুণমান পরীক্ষা',
    description: 'দৈর্ঘ্য, রেজোলিউশন, FPS, স্ট্রিম ও অডিও-সিঙ্ক যাচাই করে',
    icon: 'BadgeCheck',
    category: 'video_studio',
  },
  {
    name: 'lip_sync',
    title: 'লিপ-সিঙ্ক (ভবিষ্যৎ)',
    description:
      'ঠোঁট-মিলানো মডেল — ৪-মাত্রিক বাধায় চালু নয় (SDK-API নেই · GPU নেই · অ্যাডাপ্টার নেই · বেঞ্চমার্ক হয়নি)',
    icon: 'SmilePlus',
    category: 'video_studio',
  },

  // ---- Production / Film Director (মাস্টার প্ল্যান §৬, D) ----
  {
    name: 'propose_job',
    title: 'প্রোডাকশন প্রস্তাব',
    description: 'বড় কাজের সেটিংস-সহ নিশ্চিতকরণ কার্ড তৈরি করে (Creative Job Spec)',
    icon: 'ClipboardCheck',
    category: 'production',
  },
  {
    name: 'create_character',
    title: 'চরিত্র সৃষ্টি',
    description: 'চরিত্রের পরিচয়পত্র ও রেফারেন্স পোর্ট্রেট তৈরি করে (Character Bible)',
    icon: 'UserRoundCog',
    category: 'production',
  },
];

export function getToolInfo(name: string): ToolInfo | undefined {
  return TOOL_CATALOG.find(t => t.name === name);
}

// ------------------------------------------------------------
// Chat contract (আগেরটির সম্প্রসারণ — পশ্চাদসম্পাতী)
// ------------------------------------------------------------

export type RunStatus = 'running' | 'completed' | 'failed' | 'interrupted';
export type ActivityStatus = 'running' | 'done' | 'failed';

export interface ArtifactMeta {
  id: string;
  kind: 'image' | 'audio' | 'video' | 'text';
  mimeType: string;
  fileName: string;
  size: number; // bytes (0 if external)
  url: string; // always /api/artifacts/{id}/file (redirects if external)
  external: boolean; // true → url redirects to a remote image
  /** মিডিয়া-মেটাডেটা (যাচাই-রায়, ইঞ্জিন-লেবেল, বিট-মার্কার ইত্যাদি) — §২.৩ প্রিভিউ-কার্ডের জন্য */
  meta?: Record<string, unknown>;
}

export interface AttachmentView {
  kind: 'image' | 'audio' | 'video';
  name: string;
  url: string;
}

export interface RunStats {
  steps: number;
  toolCalls: number;
  durationMs: number;
}

export interface ActivityView {
  id: string; // toolCall id
  tool: string; // tool name (key into TOOL_CATALOG)
  title: string; // Bengali title from TOOL_CATALOG
  icon: string;
  status: ActivityStatus;
  input: string; // human-readable summary of arguments
  output?: string; // human-readable summary of result
  error?: string;
  artifacts?: ArtifactMeta[];
  durationMs?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string; // ISO string
  attachments?: AttachmentView[]; // user-uploaded files
  activities?: ActivityView[]; // tool executions for this assistant turn
  artifacts?: ArtifactMeta[]; // all artifacts produced in this assistant turn
  runStats?: RunStats | null; // assistant messages only
  productionId?: string; // এই বার্তায় দেখানো production কার্ড
  /** এই assistant উত্তরে ব্যবহৃত LLM মডেল (সৎ-লেবেল; ফলব্যাক হলে প্রকৃত মডেল) */
  model?: string;
  /**
   * ক্লায়েন্ট-ক্ষণস্থায়ী রান-স্ট্যাটাস নোট (S9) — যেমন "রেট-লিমিট, ৪০ সে. অপেক্ষা"।
   * শুধু pending bubble-এ দেখানো হয়; সার্ভার কখনো পাঠায় না —
   * চূড়ান্ত message ইভেন্টে pending বার্তা পুরো বদলে যায়, তাই নোটও মুছে যায়।
   */
  statusNote?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  lastMessageAt: string;
  messageCount: number;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  messages: ChatMessage[];
}

export interface ChatRequest {
  conversationId: string; // '' → backend creates a new conversation
  content: string;
  /** নির্বাচিত চ্যাট-মডেল ('' বা বাদ = ডিফল্ট; ক্যাটালগের id হতে হবে) */
  model?: string;
  attachments?: {
    kind: 'image' | 'audio' | 'video';
    name: string;
    dataUrl: string; // data:...;base64,....
  }[];
}

export interface ChatResponse {
  runId: string;
  conversationId: string;
  userMessage: ChatMessage;
}

// ---------------- SSE events (GET /api/runs/{id}/events) ----------------

export type RunEvent =
  | { type: 'run_started'; runId: string; conversationId: string }
  | {
      type: 'tool_start';
      activityId: string;
      tool: string;
      title: string;
      icon: string;
      input: string;
    }
  | {
      type: 'tool_end';
      activityId: string;
      status: 'done' | 'failed';
      output?: string;
      error?: string;
      artifacts?: ArtifactMeta[];
      durationMs?: number;
    }
  | { type: 'message'; conversationId: string; message: ChatMessage }
  | {
      /**
       * লাইভ টোকেন-স্ট্রিম — চূড়ান্ত উত্তর তৈরি হওয়ার সময় অংশবিশেষ।
       * `reset: true` = আগের আংশিক টেক্সট বাতিল করে নতুন করে শুরু
       * (রিট্রাই-পুনঃস্ট্রিমের সময় ডুপ্লিকেট এড়াতে)।
       * টুল-কল JSON কখনো স্ট্রিম হয় না — শুধু ব্যবহারকারী-দৃশ্যমান উত্তর।
       */
      type: 'text_delta';
      runId: string;
      delta: string;
      reset?: boolean;
    }
  | {
      /** S9: রান-স্ট্যাটাস নোট — যেমন "রেট-লিমিট, অপেক্ষা চলছে (৪০ সে.)" */
      type: 'run_note';
      runId: string;
      note: string;
      level?: 'info' | 'waiting' | 'warn';
    }
  | {
      type: 'run_finished';
      runId: string;
      conversationId: string;
      status: RunStatus;
      error?: string;
    }
  | { type: 'ping' };

// ------------------------------------------------------------
// Creative Job Specification (মাস্টার প্ল্যান পার্ট E, §১৩–১৫)
// টাইপড প্যারামিটার — শুধু প্রম্পট-টেক্সট নয় (§১৫ নিয়ম)
// ------------------------------------------------------------

export type ProductionType = 'image' | 'audio' | 'motion_video' | 'music_video' | 'short_film';
export type QualityPreset = 'draft' | 'standard' | 'high';
export type AspectRatio = '1:1' | '4:5' | '3:2' | '16:9' | '9:16';
export type OutputResolution = '720p' | '1080p';
export type VideoSound = 'none' | 'ambient' | 'narration' | 'uploaded_song';
/**
 * কণ্ঠ-প্যাক: z-ai SDK-র ৭টি কণ্ঠ + Microsoft Edge-নিউরাল কণ্ঠ
 * (২০২৬-১০-১৩ থেকে বাংলা/ইংরেজির প্রধান পথ — bn-BD-নবনীতা/প্রদীপ
 * সত্যিই বাংলা-প্রশিক্ষিত; z-ai কণ্ঠগুলো বাংলা পড়তে পারে না)
 */
export type VoicePreset =
  | 'tongtong'
  | 'jam'
  | 'kazi'
  | 'chuichui'
  | 'xiaochen'
  | 'douji'
  | 'luodo'
  | 'bn-BD-NabanitaNeural'
  | 'bn-BD-PradeepNeural'
  | 'bn-IN-TanishaaNeural'
  | 'bn-IN-BashkarNeural'
  | 'en-US-AriaNeural'
  | 'en-US-GuyNeural'
  | 'en-GB-SoniaNeural'
  | 'en-GB-RyanNeural';
export type CameraMove = 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'static';
export type SpeechLanguage = 'bn' | 'en';
export type VideoEngine = 'ai_diffusion' | 'cinematic_motion';
export type FilmMode = 'short_film' | 'dialogue_scene' | 'trailer' | 'story';
export type MusicMood = 'sad' | 'romantic' | 'joyful' | 'suspense' | 'action' | 'peaceful';
export type MusicSource = 'procedural' | 'uploaded_song' | 'none';

export interface CreativeJobSpec {
  type: ProductionType;
  title: string;
  quality: QualityPreset;
  // --- image ---
  instructions?: string; // তৈরি/সম্পাদনার নির্দেশনা
  sourceArtifactId?: string; // সম্পাদনার উৎস-ছবি
  overlayText?: string; // টাইপোগ্রাফি/পোস্টারের লেখা
  aspect?: AspectRatio;
  format?: 'png' | 'jpeg' | 'webp';
  // --- audio ---
  audioOperation?: 'voiceover' | 'music_plan' | 'process' | 'instrumental';
  text?: string; // ভয়েসওভার স্ক্রিপ্ট / গানের কথা
  voice?: VoicePreset;
  sourceAudioArtifactIds?: string[]; // প্রসেসিং-এর ইনপুট
  // --- video / film ---
  idea?: string; // সৃজনশীল ব্রিফ / আইডিয়া
  story?: string; // শর্টফিল্মের গল্প
  durationSec?: number;
  fps?: 24 | 25 | 30;
  sound?: VideoSound;
  subtitles?: boolean;
  songArtifactId?: string; // মিউজিক ভিডিওর আপলোড করা গান
  sourceImageArtifactId?: string; // image-to-video উৎস
  cameraMove?: CameraMove;
  style?: string; // ভিজ্যুয়াল স্টাইল
  // --- নতুন মাস্টার প্ল্যান §২,৪,৩,১০ ---
  language?: SpeechLanguage; // সংলাপ/ভয়েসওভারের ভাষা (ডিফল্ট bn)
  videoEngine?: VideoEngine; // ai_diffusion (প্রকৃত CogVideoX-3) | cinematic_motion (স্টোরিবোর্ড+ক্যামেরা-মোশন)
  filmMode?: FilmMode; // শর্টফিলম | সংলাপ-দৃশ্য | ট্রেইলার | গল্প
  mood?: MusicMood | string; // আবেগ (স্কোর/মিউজিক নির্বাচনে)
  genre?: string; // গান/ভিডিওর ধরন
  tempoBpm?: number; // ৬০–১৭০
  musicSource?: MusicSource; // মিউজিক ভিডিওর গান: আপলোড না করলে প্রসিডিউরাল ইনস্ট্রুমেন্টাল
}

export interface SpecAdjustment {
  field: string;
  from: string;
  to: string;
  reason: string;
}

export interface ValidatedSpec {
  spec: CreativeJobSpec; // নরমালাইজড
  adjustments: SpecAdjustment[]; // স্বয়ংক্রিয় সমন্বয় (§১৫)
  notes: string[]; // সীমাবদ্ধতার ব্যাখ্যা
  plannedSteps: { key: string; title: string }[]; // পাইপলাইন ধাপের প্রিভিউ
}

// ------------------------------------------------------------
// Production (Creative Job) — status machine §৭:
// awaiting_confirmation → queued → running → validating →
// completed | failed | partial | cancelled
// ------------------------------------------------------------

export type ProductionStatus =
  | 'awaiting_confirmation'
  | 'queued'
  | 'running'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'partial'
  | 'cancelled'
  | 'cancelling';

export interface ProductionStepView {
  id: string;
  seq: number;
  key: string;
  title: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  detail?: string;
  error?: string;
  durationMs?: number;
}

export interface ProductionView {
  id: string;
  conversationId: string;
  type: ProductionType;
  title: string;
  status: ProductionStatus;
  spec: CreativeJobSpec;
  progress: number; // 0-100
  currentStepKey?: string;
  error?: string;
  resultJson?: string;
  parentProductionId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  steps: ProductionStepView[];
  artifacts: ArtifactMeta[];
}

export interface ProductionSummary {
  id: string;
  type: ProductionType;
  title: string;
  status: ProductionStatus;
  progress: number;
  createdAt: string;
  finishedAt?: string;
  artifactCount: number;
}

// ---------------- SSE events (GET /api/productions/{id}/events) ----------------

export type ProductionEvent =
  | { type: 'production_started'; productionId: string }
  | {
      type: 'step_start';
      productionId: string;
      stepId: string;
      seq: number;
      key: string;
      title: string;
    }
  | {
      type: 'step_end';
      productionId: string;
      stepId: string;
      key: string;
      status: 'done' | 'failed' | 'skipped';
      detail?: string;
      error?: string;
      durationMs?: number;
    }
  | {
      type: 'production_progress';
      productionId: string;
      progress: number;
      currentStepKey?: string;
    }
  | {
      type: 'production_finished';
      productionId: string;
      status: 'completed' | 'failed' | 'partial' | 'cancelled';
      error?: string;
    }
  | { type: 'ping' };

// ------------------------------------------------------------
// Model & License Registry (§৮) + Availability Matrix (নতুন পরিকল্পনা §২/§৫)
// ------------------------------------------------------------

export type ModelStatus = 'enabled' | 'experimental' | 'blocked' | 'planned';

/** §২ — লাইসেন্স-মাত্রা (ব্যবহারের ধরন: Z.ai স্যান্ডবক্স, ব্যক্তিগত/অ-বাণিজ্যিক) */
export type LicenseStatus =
  | 'allowed'
  | 'allowed_noncommercial'
  | 'allowed_with_conditions'
  | 'provider_api_only'
  | 'needs_review'
  | 'blocked_by_license';

/** §২/§৪ — প্রোভাইডার-মাত্রা: স্যান্ডবক্স SDK এই মডেলের API প্রকাশ করে কি না; local_engine = বাইরের প্রোভাইডার লাগে না */
export type ProviderStatus = 'exposed_by_sdk' | 'not_exposed_by_sdk' | 'local_engine' | 'unknown';

/** §২ — ইন্টিগ্রেশন-মাত্রা: অ্যাপে অ্যাডাপ্টার/পাইপলাইন কতটা তৈরি */
export type IntegrationStatus = 'integrated' | 'partial' | 'not_integrated';

/** §২ — রানটাইম-মাত্রা: এই হার্ডওয়্যারে এখন চলছে কি না */
export type RuntimeStatus =
  | 'healthy'
  | 'degraded'
  | 'temporarily_unavailable'
  | 'unavailable_hardware'
  | 'not_applicable';

/**
 * নতুন পরিকল্পনা §১ — quality_status মাত্রা (পাঁচম মাত্রা):
 * বাস্তব আউটপুটের গুণমান-পরীক্ষায় কতদূর উত্তীর্ণ।
 *  - quality_not_verified: কোনো বাস্তব মান-পরীক্ষা হয়নি
 *  - quality_machine_checked: যন্ত্র-পরীক্ষা (দৈর্ঘ্য/নীরবতা/ASR/ffprobe) পাস — মানব-শ্রবণ বাকি
 *  - quality_human_verified: মানব-শ্রবণ/দেখা পরীক্ষাতেও উত্তীর্ণ
 *  - quality_not_applicable: মান-ধারণা প্রযোজ্য নয় (অবকাঠামো/টুলিং)
 */
export type QualityStatus =
  | 'quality_not_verified'
  | 'quality_machine_checked'
  | 'quality_human_verified'
  | 'quality_not_applicable';

export interface ModelEntryView {
  id: string;
  key: string;
  name: string;
  category: 'llm' | 'image' | 'audio' | 'video' | 'utility' | 'infrastructure';
  provider: string;
  license: string;
  licenseUrl?: string;
  commercialUse: 'allowed' | 'restricted' | 'unknown' | 'not_applicable';
  status: ModelStatus;
  licenseStatus?: LicenseStatus;
  providerStatus?: ProviderStatus;
  integrationStatus?: IntegrationStatus;
  runtimeStatus?: RuntimeStatus;
  /** নতুন পরিকল্পনা §১ — quality_status (পাঁচম মাত্রা) */
  qualityStatus?: QualityStatus;
  apiEndpoint?: string;
  apiModelId?: string;
  lastTestedAt?: string;
  lastTestNote?: string;
  errorReason?: string;
  tools?: string[];
  capabilities: Record<string, unknown>;
  hardwareNotes?: string;
  notes?: string;
  verifiedAt?: string;
}

// ------------------------------------------------------------
// Model & Tool Availability Matrix (§১৫-এর প্রথম Deliverable)
// ------------------------------------------------------------

/** ম্যাট্রিক্স-সারির সামগ্রিক রায় */
export type MatrixOverall = 'available' | 'available_with_limits' | 'experimental' | 'unavailable_here' | 'future';

export interface AvailabilityMatrixRow {
  /** ক্ষমতার স্থিতিশীল কী */
  key: string;
  /** বাংলা নাম */
  capability: string;
  /** §৫-এর টাস্ক-শ্রেণি */
  taskType: string;
  /** কোন কোন টুল/পাইপলাইন এই ক্ষমতা ব্যবহার করে */
  tools: string[];
  /** রেজিস্ট্রি-মডেলের কী */
  modelKey: string;
  model: string;
  license: LicenseStatus;
  provider: ProviderStatus;
  integration: IntegrationStatus;
  runtime: RuntimeStatus;
  /** নতুন পরিকল্পনা §১ — quality_status (পাঁচম মাত্রা) */
  quality: QualityStatus;
  apiEndpoint?: string;
  apiModelId?: string;
  lastTestedAt?: string;
  lastTestNote?: string;
  /** অনুপলব্ধ হলে প্রকৃত কারণ — লাইসেন্স/প্রোভাইডার/হার্ডওয়্যার/ইন্টিগ্রেশন/গুণমান আলাদা করে */
  errorReason?: string;
  overall: MatrixOverall;
  /** সৎ নোট (যেমন: প্রসিডিউরাল ≠ নিউরাল) */
  honestNote?: string;
  /** অনুপলব্ধ ক্ষমতার বিকল্প-পথ */
  fallback?: string;
}

export interface AvailabilityMatrixResponse {
  matrix: AvailabilityMatrixRow[];
  generatedAt: string;
  usageMode: {
    /** এই অ্যাপের ঘোষিত ব্যবহার-ধরন — লাইসেন্স-যাচাই এই ভিত্তিতে */
    environment: string;
    usage: string;
    note: string;
  };
  legend: Record<string, string>;
}

// ------------------------------------------------------------
// Hardware-aware Model Manager (নতুন পরিকল্পনা §১০ — দশম ধাপ)
// ------------------------------------------------------------

/** বাস্তব হার্ডওয়্যার পরিমাপ (system-info.ts থেকে পূরণ হয়) */
export interface HardwareReport {
  cpuCores: number;
  cpuModel: string;
  totalMemGb: number;
  freeMemGb: number;
  diskTotalGb: number;
  diskFreeGb: number;
  gpu: { present: boolean; note: string };
  ffmpeg: string | null;
  ffprobe: string | null;
  nodeVersion: string;
  platform: string;
}

/** §১০-এর নির্ধারিত ৯-অবস্থার রায় — প্রতি মডেলের জন্য */
export type HardwareVerdict =
  | 'ready'
  | 'ready_with_limits'
  | 'needs_model_download'
  | 'needs_gpu'
  | 'needs_more_ram'
  | 'license_review_required'
  | 'provider_rate_limited'
  | 'integration_incomplete'
  | 'quality_not_verified';

export interface HardwareModelAssessment {
  modelKey: string;
  name: string;
  verdict: HardwareVerdict;
  /** বাংলা ব্যাখ্যা — কেন এই রায় */
  reason: string;
  requires: {
    minRamGb?: number;
    minVramGb?: number;
    gpuRequired: boolean;
    /** লোকাল ওয়েট লাগলে তার পরিচয় */
    localWeights?: string;
  };
  /** এই পরিবেশে ব্যবহারযোগ্য বিকল্প-পথ */
  fallback?: string;
}

export interface HardwareManagerResponse {
  profile: HardwareReport;
  assessments: HardwareModelAssessment[];
  probedAt: string;
}

// ------------------------------------------------------------
// বাংলা TTS মান-যাচাই বেঞ্চমার্ক (নতুন পরিকল্পনা §৪ — তৃতীয় ধাপ)
// ------------------------------------------------------------

/** বেঞ্চমার্ক বাক্যের শ্রেণি — ব্যবহারকারীর নির্দিষ্ট তালিকামতো */
export type BnBenchmarkCategory =
  | 'conversation' // সাধারণ কথোপকথন
  | 'dramatic' // নাটকীয় সংলাপ
  | 'emotion' // প্রশ্ন/বিস্ময়/রাগ/কান্না/আনন্দ
  | 'mixed_bn_en' // বাংলা-ইংরেজি মিশ্র
  | 'numbers_dates' // সংখ্যা/তারিখ/নাম/যুক্তাক্ষর
  | 'long_reading'; // দীর্ঘ বর্ণনা ও গল্পপাঠ

export interface BnBenchmarkSentence {
  id: string;
  category: BnBenchmarkCategory;
  /** মূল বাক্য */
  text: string;
  /** নর্মালাইজেশন-পরে প্রত্যাশিত রূপ (ঐচ্ছিক — numbers_dates-এ) */
  expected?: string;
}

export interface TtsBenchmarkAudioChecks {
  durationSec: number;
  expectedSec: number;
  durationOk: boolean;
  peakDb?: number;
  /** মোট সময়ের যত অংশ নীরব */
  silenceRatio: number;
  clippingSuspected: boolean;
  silenceRanges: { start: number; end: number }[];
}

export interface TtsBenchmarkSentenceResult {
  sentenceId: string;
  category: BnBenchmarkCategory;
  text: string;
  /** নর্মালাইজার-পরে TTS-এ পাঠানো রূপ */
  normalizedText: string;
  voice: string;
  status: 'pass' | 'warn' | 'fail' | 'skipped_rate_limited' | 'error';
  checks?: TtsBenchmarkAudioChecks;
  /** ASR ব্যাক-চেক — কেবল উপদেশমূলক (বাংলা ASR দুর্বল) */
  asr?: { transcript: string; bnCharRatio: number; advisoryOnly: boolean };
  notes: string[];
  /** প্রতি-বাক্য অডিও-প্লেয়ার URL */
  audioUrl?: string;
  durationMs: number;
}

export interface TtsBenchmarkReport {
  id: string;
  scope: 'quick' | 'full';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt?: string;
  progress: { done: number; total: number };
  voices: string[];
  results: TtsBenchmarkSentenceResult[];
  summary?: {
    pass: number;
    warn: number;
    fail: number;
    skipped: number;
    error: number;
    machineChecked: boolean;
    /** সবসময় true — মানব-শ্রবণ পরীক্ষা আলাদা বাধ্যতামূলক ধাপ */
    humanListeningPending: boolean;
  };
  honestNote: string;
}

// ------------------------------------------------------------
// UI view switching (শেল)
// ------------------------------------------------------------

export type AppView = 'chat' | 'studio' | 'gallery' | 'productions' | 'registry' | 'keys' | 'guide';
