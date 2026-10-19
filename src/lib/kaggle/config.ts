// ============================================================
// Kaggle GPU মিউজিক-কর্মী — Supabase env-কনফিগ (সরু, নির্ভরতামুক্ত)।
//
// এই মডিউল ক্লায়েন্ট-বান্ডলে ঢুকলেও নিরাপদ (মান কখনো ফেরত যায় না —
// শুধু present/null), তবে ব্যবহারের স্বাভাবিক জায়গা সার্ভার-সাইড।
//
// SUPABASE_KEY অবশ্যই service_role চাবি — NEXT_PUBLIC_ প্রিফিক্স
// দেওয়া নিষিদ্ধ, ব্রাউজারে পাঠানো নিষিদ্ধ।
// ============================================================

export interface KaggleSupabaseConfig {
  /** প্রজেক্ট-URL (trailing slash ছাডা) — যেমন https://<ref>.supabase.co */
  url: string;
  /** service_role চাবি — শুধু সার্ভার-সাইড */
  apiKey: string;
}

/** দুটো ভেরিয়েবলই সেট থাকলে কনফিগ, নাহলে null */
export function getSupabaseConfig(): KaggleSupabaseConfig | null {
  const url = process.env.SUPABASE_URL?.trim();
  const apiKey = process.env.SUPABASE_KEY?.trim();
  if (!url || !apiKey) return null;
  return { url: url.replace(/\/+$/, ''), apiKey };
}

/** ফিচার-কনফিগারেশন উপস্থিত কি না (কর্মী-অনলাইন মানে নয় — আলাদা ব্যাপার) */
export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

/** কোন কোন ভেরিয়েবল অনুপস্থিত — ত্রুটি-বার্তায় শুধু নাম বলার জন্য */
export function missingSupabaseVars(): string[] {
  const missing: string[] = [];
  if (!process.env.SUPABASE_URL?.trim()) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_KEY?.trim()) missing.push('SUPABASE_KEY');
  return missing;
}
