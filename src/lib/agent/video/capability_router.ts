// ============================================================
// Video Capability Router — নতুন মাস্টার প্ল্যান §৪.৩
// ব্যবহারকারীর অনুরোধের ধরন অনুযায়ী সঠিক টুল বেছে নেওয়া
// বাধ্যতামূলক। FFmpeg-কে কখনো Text-to-Video মডেল হিসেবে দেখানো
// হয় না — নিচের টেবিলটিই একমাত্র সত্যের উৎস (প্রম্পট + UI উভয়ে)।
// ============================================================

export type VideoRequestKind =
  | 'image_to_video' // ছবি থেকে ভিডিও
  | 'new_scene' // নতুন দৃশ্য তৈরি
  | 'character_motion' // চরিত্রের শরীর নড়ানো
  | 'lip_sync' // কথা বলার ঠোঁট মেলানো
  | 'edit_cut' // দৃশ্য জোড়া ও কাট
  | 'enhance_subtitle' // রং, স্থিতিশীলতা, সাবটাইটেল
  | 'multi_scene_film'; // একাধিক দৃশ্যের চলচ্চিত্র

export interface CapabilityRoute {
  kind: VideoRequestKind;
  /** যে টুল/পাইপলাইন চালাতে হবে */
  tool: string;
  /** ইঞ্জিনের প্রকৃতি — সৎ লেবেল */
  engine: string;
  /** প্রকৃত AI জেনারেশন নাকি সম্পাদনা/অ্যানিমেশন */
  realAiGeneration: boolean;
  status: 'ready' | 'experimental' | 'unavailable';
  note: string;
}

export const CAPABILITY_ROUTES: Record<VideoRequestKind, CapabilityRoute> = {
  image_to_video: {
    kind: 'image_to_video',
    tool: 'image_to_video',
    engine: 'CogVideoX-3 image-to-video (ক্লাউড ডিফিউশন)',
    realAiGeneration: true,
    status: 'ready',
    note: 'রেফারেন্স ছবিকে ভিত্তি ধরে নতুন মোশন তৈরি হয় — পরিচয় যতটা সম্ভব ধরে রাখা হয়।',
  },
  new_scene: {
    kind: 'new_scene',
    tool: 'generate_video',
    engine: 'CogVideoX-3 text-to-video (ক্লাউড ডিফিউশন)',
    realAiGeneration: true,
    status: 'ready',
    note: 'লেখা থেকে সম্পূর্ণ নতুন চলমান দৃশ্য — স্টোরিবোর্ড-জুম নয়।',
  },
  character_motion: {
    kind: 'character_motion',
    tool: 'generate_video (অভিনয়-নির্দেশিত প্রম্পট)',
    engine: 'CogVideoX-3 (ক্যারেক্টার-মোশন প্রম্পট সহ)',
    realAiGeneration: true,
    status: 'experimental',
    note: 'চলা/বসা/অঙ্গ-ভঙ্গি প্রম্পটে বলা যায়; জটিল অ্যাকশনে ফলাফল পরিবর্তনশীল — প্রিভিউ দেখে যাচাই দরকার।',
  },
  lip_sync: {
    kind: 'lip_sync',
    tool: 'lip_sync',
    engine: 'লিপ-সিঙ্ক মডেল নেই (MuseTalk প্রার্থী, এই পরিবেশে স্থাপিত নয়)',
    realAiGeneration: false,
    status: 'unavailable',
    note: 'লিপ-সিঙ্ক ছাড়া কখনো "গায়কের মুখ নড়ছে" দাবি করা হয় না।',
  },
  edit_cut: {
    kind: 'edit_cut',
    tool: 'process_video',
    engine: 'FFmpeg (সম্পাদনা — জেনারেশন নয়)',
    realAiGeneration: false,
    status: 'ready',
    note: 'কাট, জোড়া, ট্রানজিশন — সম্পাদনার কাজ, AI-জেনারেশন বলে দেখানো হয় না।',
  },
  enhance_subtitle: {
    kind: 'enhance_subtitle',
    tool: 'enhance_video / generate_subtitles',
    engine: 'FFmpeg ফিল্টার + LLM সাবটাইটেল',
    realAiGeneration: false,
    status: 'ready',
    note: 'রং-সংশোধন, ডিনয়েজ, সাবটাইটেল — প্রসেসিং টুল।',
  },
  multi_scene_film: {
    kind: 'multi_scene_film',
    tool: 'propose_job (short_film পাইপলাইন)',
    engine: '৮-স্টেজ ফিল্ম প্রোডাকশন পাইপলাইন',
    realAiGeneration: true,
    status: 'ready',
    note: 'চিত্রনাট্য → দৃশ্য-বিভাজন → চরিত্র বাইবেল → অভিনয়-পরিকল্পনা → AI শট → সাউন্ড ডিজাইন → ধারাবাহিকতা → ফাইনাল মিক্স।',
  },
};

/** অনুরোধের ধরন → রুট (প্রম্পট-নির্মাণ ও UI-তে ব্যবহৃত) */
export function routeVideoRequest(kind: VideoRequestKind): CapabilityRoute {
  return CAPABILITY_ROUTES[kind];
}

/** সব রুটের বাংলা টেবিল-বর্ণনা (গাইড/UI-তে) */
export function capabilityRouterTableBn(): { request: string; tool: string; engine: string; status: string }[] {
  const labels: Record<VideoRequestKind, string> = {
    image_to_video: 'ছবি থেকে ভিডিও',
    new_scene: 'নতুন দৃশ্য তৈরি',
    character_motion: 'চরিত্রের শরীর নড়ানো',
    lip_sync: 'কথা বলার ঠোঁট মেলানো',
    edit_cut: 'দৃশ্য জোড়া ও কাট',
    enhance_subtitle: 'রং, স্থিতিশীলতা, সাবটাইটেল',
    multi_scene_film: 'একাধিক দৃশ্যের চলচ্চিত্র',
  };
  const statusLabels: Record<CapabilityRoute['status'], string> = {
    ready: 'চালু',
    experimental: 'পরীক্ষামূলক',
    unavailable: 'অবরুদ্ধ',
  };
  return (Object.keys(CAPABILITY_ROUTES) as VideoRequestKind[]).map(kind => {
    const r = CAPABILITY_ROUTES[kind];
    return {
      request: labels[kind],
      tool: r.tool,
      engine: r.engine,
      status: statusLabels[r.status],
    };
  });
}
