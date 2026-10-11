'use client';

import {
  AudioLines,
  FileText,
  Globe,
  History,
  ImagePlus,
  Images,
  Mic,
  ScanEye,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/** TOOL_CATALOG-এর lucide আইকন-নাম → কম্পোনেন্ট ম্যাপ */
const ICONS: Record<string, LucideIcon> = {
  Globe,
  FileText,
  ImagePlus,
  Images,
  ScanEye,
  AudioLines,
  Mic,
  History,
};

export function ToolIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Wrench;
  return <Icon className={className} aria-hidden="true" />;
}
