'use client';

// ============================================================
// availability-badges — Availability Matrix-এর মাত্রিক
// স্ট্যাটাস-চিপ, সামগ্রিক-ব্যাজ ও রঙ-ম্যাপ। রেজিস্ট্রি-ভিউয়ের
// ম্যাট্রিক্স-প্যানেল, ModelEntryCard ও স্টুডিও-মোড-কার্ডে শেয়ার্ড।
//
// রঙ-চুক্তি (blue/indigo নিষিদ্ধ):
//  emerald  = চালু / স্বাস্থ্যবান / SDK-এ আছে / সংযুক্ত / যাচাইকৃত
//  amber    = সীমাসহ / শর্তসাপেক্ষ / আংশিক / যাচাই বাকি
//  stone    = এই পরিবেশে অনুপলব্ধ / SDK-তে নেই / সংযুক্ত নয় / প্রযোজ্য নয়
//  dashed stone = ভবিষ্যৎ পরিবেশে সম্ভব
// ============================================================

import { Badge } from '@/components/ui/badge';
import type {
  IntegrationStatus,
  LicenseStatus,
  MatrixOverall,
  ProviderStatus,
  QualityStatus,
  RuntimeStatus,
} from '@/lib/types';
import { cn } from '@/lib/utils';

export interface AvailMeta {
  /** ছোট লেবেল (চিপে) */
  label: string;
  /** সম্পূর্ণ ব্যাখ্যা (tooltip) */
  title: string;
  className: string;
}

const EMERALD = 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400';
const AMBER = 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400';
const STONE = 'border-stone-400/50 bg-stone-400/10 text-stone-600 dark:text-stone-300';
const STONE_DASHED = 'border-dashed border-stone-400/70 bg-transparent text-stone-600 dark:text-stone-300';
const RED = 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400';

// ---------------- সামগ্রিক রায় (§১৫ ম্যাট্রিক্স) ----------------

export const OVERALL_META: Record<MatrixOverall, AvailMeta> = {
  available: { label: 'চালু', title: 'সামগ্রিক: চালু', className: EMERALD },
  available_with_limits: {
    label: 'সীমাসহ',
    title: 'সামগ্রিক: চালু — নির্দিষ্ট সীমা/সতর্কতাসহ',
    className: AMBER,
  },
  experimental: {
    label: 'পরীক্ষামূলক',
    title: 'সামগ্রিক: পরীক্ষামূলক (সৎ লেবেলসহ)',
    className: AMBER,
  },
  unavailable_here: {
    label: 'এই পরিবেশে অনুপলব্ধ',
    title: 'সামগ্রিক: এই পরিবেশে অনুপলব্ধ (কারণ: হার্ডওয়্যার/API/ইন্টিগ্রেশন — লাইসেন্স নয়)',
    className: STONE,
  },
  future: {
    label: 'ভবিষ্যৎ',
    title: 'সামগ্রিক: ভবিষ্যৎ পরিবেশে সম্ভব',
    className: STONE_DASHED,
  },
};

// ---------------- চার মাত্রা (নতুন পরিকল্পনা §২) ----------------

export const LICENSE_META: Record<LicenseStatus, AvailMeta> = {
  allowed: { label: 'অনুমোদিত', title: 'লাইসেন্স: অনুমোদিত', className: EMERALD },
  allowed_noncommercial: {
    label: 'অ-বাণিজ্যিকে অনুমোদিত',
    title: 'লাইসেন্স: অ-বাণিজ্যিক ব্যবহারে অনুমোদিত',
    className: EMERALD,
  },
  allowed_with_conditions: {
    label: 'শর্তসাপেক্ষ অনুমোদিত',
    title: 'লাইসেন্স: শর্তসাপেক্ষে অনুমোদিত (attribution/পুনর্বণ্টন-শর্ত)',
    className: AMBER,
  },
  provider_api_only: {
    label: 'API-পথে অনুমোদিত',
    title: 'লাইসেন্স: অনুমোদিত প্রোভাইডার-API পথ ধরে ব্যবহার',
    className: EMERALD,
  },
  needs_review: { label: 'যাচাই বাকি', title: 'লাইসেন্স/শর্ত: যাচাই বাকি', className: AMBER },
  blocked_by_license: {
    label: 'লাইসেন্সে নিষিদ্ধ',
    title: 'লাইসেন্স: বর্তমান ব্যবহারে নিষিদ্ধ',
    className: RED,
  },
};

export const PROVIDER_META: Record<ProviderStatus, AvailMeta> = {
  exposed_by_sdk: {
    label: 'SDK-এ আছে',
    title: 'প্রোভাইডার: স্যান্ডবক্স SDK-তে API আছে',
    className: EMERALD,
  },
  not_exposed_by_sdk: {
    label: 'SDK-তে নেই',
    title: 'প্রোভাইডার: SDK-তে API প্রকাশিত নয়',
    className: STONE,
  },
  local_engine: {
    label: 'স্থানীয় ইঞ্জিন',
    title: 'প্রোভাইডার লাগে না — স্থানীয় ইঞ্জিন',
    className: EMERALD,
  },
  unknown: { label: 'অজানা', title: 'প্রোভাইডার: অজানা', className: STONE },
};

export const INTEGRATION_META: Record<IntegrationStatus, AvailMeta> = {
  integrated: {
    label: 'সংযুক্ত',
    title: 'ইন্টিগ্রেশন: অ্যাডাপ্টার/পাইপলাইন সম্পূর্ণ',
    className: EMERALD,
  },
  partial: { label: 'আংশিক', title: 'ইন্টিগ্রেশন: আংশিক', className: AMBER },
  not_integrated: { label: 'সংযুক্ত নয়', title: 'ইন্টিগ্রেশন: সংযুক্ত নয়', className: STONE },
};

export const RUNTIME_META: Record<RuntimeStatus, AvailMeta> = {
  healthy: {
    label: 'চালু',
    title: 'রানটাইম: এই পরিবেশে চালু ও স্বাস্থ্যবান',
    className: EMERALD,
  },
  degraded: {
    label: 'অবনত',
    title: 'রানটাইম: চলে, কিন্তু সীমাবদ্ধতা আছে',
    className: AMBER,
  },
  temporarily_unavailable: {
    label: 'সাময়িক-অনুপলব্ধ',
    title: 'রানটাইম: সাময়িকভাবে অনুপলব্ধ (রেট-লিমিট/আউটেজ)',
    className: AMBER,
  },
  unavailable_hardware: {
    label: 'হার্ডওয়্যার-বাধা',
    title: 'রানটাইম: এই হার্ডওয়্যারে অসম্ভব (GPU/RAM)',
    className: STONE,
  },
  not_applicable: { label: 'প্রযোজ্য নয়', title: 'রানটাইম: প্রযোজ্য নয়', className: STONE },
};

// ---------------- পাঁচম মাত্রা — গুণমান (নতুন পরিকল্পনা §১) ----------------

export const QUALITY_META: Record<QualityStatus, AvailMeta> = {
  quality_human_verified: {
    label: 'মানব-যাচাইকৃত',
    title: 'গুণমান: মানব-শ্রবণ/দেখা পরীক্ষাতেও উত্তীর্ণ',
    className: EMERALD,
  },
  quality_machine_checked: {
    label: 'যন্ত্র-যাচাইকৃত',
    title: 'গুণমান: যন্ত্র-পরীক্ষায় পাস — মানব-শ্রবণ এখনো বাকি',
    className: EMERALD,
  },
  quality_not_verified: {
    label: 'মান-যাচাই বাকি',
    title: 'গুণমান: কোনো বাস্তব মান-পরীক্ষা এখনো হয়নি',
    className: AMBER,
  },
  quality_not_applicable: {
    label: 'প্রযোজ্য নয়',
    title: 'গুণমান: মান-ধারণা প্রযোজ্য নয় (অবকাঠামো/টুলিং)',
    className: STONE,
  },
};

// ---------------- উপাদান ----------------

/** সামগ্রিক-রায়ের ব্যাজ */
export function OverallBadge({ overall, className }: { overall: MatrixOverall; className?: string }) {
  const meta = OVERALL_META[overall];
  return (
    <Badge
      variant="outline"
      className={cn('h-auto shrink-0 px-2 py-0.5 text-[11px] leading-snug whitespace-nowrap', meta.className, className)}
    >
      {meta.label}
    </Badge>
  );
}

/** একটি মাত্রার ছোট চিপ — withPrefix হলে "লাইসেন্স: অনুমোদিত" ধাঁচে */
export function DimensionChip({
  dimension,
  meta,
  withPrefix = true,
}: {
  dimension?: string;
  meta: AvailMeta;
  withPrefix?: boolean;
}) {
  return (
    <span
      title={meta.title}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] leading-relaxed',
        meta.className,
      )}
    >
      {withPrefix && dimension && <span className="shrink-0 opacity-70">{dimension}:</span>}
      <span className="min-w-0 truncate">{meta.label}</span>
    </span>
  );
}

/**
 * গুণমান-মাত্রার ছোট চিপ (পাঁচম মাত্রা — নতুন পরিকল্পনা §১)।
 * OverallBadge-এর একই ভিজ্যুয়াল চুক্তি মেনে চলে।
 */
export function QualityBadge({ status, className }: { status: QualityStatus; className?: string }) {
  // রানটাইম-সুরক্ষা: চুক্তির বাইরের মান এলেও ভিউ না ভেঙে সৎ লেবেল
  const meta = (QUALITY_META as Record<string, AvailMeta | undefined>)[status] ?? {
    label: 'অজানা',
    title: 'গুণমান: অজানা',
    className: 'border-muted bg-muted text-muted-foreground',
  };
  return (
    <Badge
      variant="outline"
      title={meta.title}
      className={cn('h-auto shrink-0 px-2 py-0.5 text-[11px] leading-snug whitespace-nowrap', meta.className, className)}
    >
      {meta.label}
    </Badge>
  );
}
