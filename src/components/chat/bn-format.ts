// ============================================================
// বাংলা সংখ্যা ও তারিখ ফরম্যাটিং হেল্পার
// ============================================================

import type { RunStats } from '@/lib/types';

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

const BN_MONTHS = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
];

/** ল্যাটিন অঙ্ককে বাংলা অঙ্কে রূপান্তর (e.g. "12.4" → "১২.৪") */
export function toBnDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

/** তারিখ: "১১ অক্টোবর ২০২৬" (শুধু-তারিখ ISO হলে টাইমজোন-নিরাপে) */
export function formatDateBn(iso: string): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return `${toBnDigits(Number(day))} ${BN_MONTHS[Number(month) - 1]} ${toBnDigits(year)}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${toBnDigits(d.getDate())} ${BN_MONTHS[d.getMonth()]} ${toBnDigits(d.getFullYear())}`;
}

/** "৫ মিনিট আগে" ধাঁচের সাপেক্ষিক সময় */
export function relativeTimeBn(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 45_000) return 'এইমাত্র';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${toBnDigits(minutes)} মিনিট আগে`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${toBnDigits(hours)} ঘণ্টা আগে`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${toBnDigits(days)} দিন আগে`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${toBnDigits(weeks)} সপ্তাহ আগে`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${toBnDigits(months)} মাস আগে`;
  const years = Math.floor(days / 365);
  return `${toBnDigits(years)} বছর আগে`;
}

/** বার্তার সময়: "১০:৩২ AM" */
export function formatTimeBn(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h24 = d.getHours();
  const minutes = d.getMinutes();
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  const mm = String(minutes).padStart(2, '0');
  return `${toBnDigits(h12)}:${toBnDigits(mm)} ${ampm}`;
}

/** রান-স্ট্যাট: "৩টি ধাপ · ২টি টুল · ১২.৪ সেকেন্ড" */
export function formatRunStatsBn(stats: RunStats): string {
  const seconds = (stats.durationMs / 1000).toFixed(1);
  return `${toBnDigits(stats.steps)}টি ধাপ · ${toBnDigits(stats.toolCalls)}টি টুল · ${toBnDigits(seconds)} সেকেন্ড`;
}

/** বাইট সাইজ: "২৪ KB" / "১.২ MB" (০ হলে খালি স্ট্রিং) */
export function formatSizeBn(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const kb = bytes / 1024;
  if (kb < 1024) return `${toBnDigits(kb.toFixed(0))} KB`;
  return `${toBnDigits((kb / 1024).toFixed(1))} MB`;
}

/** ডাউনলোড URL: "?download=1" যোগ (query থাকলে "&") */
export function withDownloadParam(url: string): string {
  return url.includes('?') ? `${url}&download=1` : `${url}?download=1`;
}
