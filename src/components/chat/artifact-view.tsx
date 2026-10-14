'use client';

import { useState } from 'react';
import {
  AudioLines,
  BadgeCheck,
  Download,
  FileText,
  Film,
  Gauge,
  List,
  Music,
  Quote,
  TriangleAlert,
  XCircle,
} from 'lucide-react';

import { toBnDigits } from '@/components/chat/bn-format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { ArtifactMeta } from '@/lib/types';

import { formatSizeBn, withDownloadParam } from '@/components/chat/bn-format';
import { withStudioToken } from '@/components/auth/security-gate';
import { cn } from '@/lib/utils';

// ------------------------------------------------------------
// meta-হেল্পার (§২.৩ যাচাই + ইঞ্জিন-মেটাডেটা) — নিরাপদ রিডার
// ------------------------------------------------------------

interface SpeechVerification {
  verdict: 'pass' | 'warn' | 'fail';
  transcript: string;
  detectedLanguage?: string;
  similarity?: number;
  durationSec?: number;
  notes?: string[];
}

function readVerification(meta: Record<string, unknown> | undefined): SpeechVerification | null {
  const v = meta?.verification;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const obj = v as Record<string, unknown>;
  const verdict = obj.verdict;
  if (verdict !== 'pass' && verdict !== 'warn' && verdict !== 'fail') return null;
  return {
    verdict,
    transcript: typeof obj.transcript === 'string' ? obj.transcript : '',
    detectedLanguage: typeof obj.detectedLanguage === 'string' ? obj.detectedLanguage : undefined,
    similarity: typeof obj.similarity === 'number' ? obj.similarity : undefined,
    durationSec: typeof obj.durationSec === 'number' ? obj.durationSec : undefined,
    notes: Array.isArray(obj.notes) ? obj.notes.map(String) : undefined,
  };
}

function readString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = meta?.[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function readNumber(meta: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = meta?.[key];
  return typeof v === 'number' ? v : undefined;
}

function readStringArray(
  meta: Record<string, unknown> | undefined,
  key: string,
): string[] | undefined {
  const v = meta?.[key];
  if (!Array.isArray(v)) return undefined;
  const arr = v.map(String).filter((s) => s.length > 0);
  return arr.length > 0 ? arr : undefined;
}

function readNumberArray(
  meta: Record<string, unknown> | undefined,
  key: string,
): number[] | undefined {
  const v = meta?.[key];
  if (!Array.isArray(v)) return undefined;
  const arr = v.filter((x): x is number => typeof x === 'number');
  return arr.length > 0 ? arr : undefined;
}

/** ইনস্ট্রুমেন্টাল-অডিও শনাক্তকরণ: honestLabel + tempoBpm/keyLabel/sections */
function isInstrumentalMeta(meta: Record<string, unknown> | undefined): boolean {
  if (!meta) return false;
  const honest = readString(meta, 'honestLabel');
  const looksMusic =
    readNumber(meta, 'tempoBpm') !== undefined ||
    readString(meta, 'keyLabel') !== undefined ||
    Array.isArray(meta?.beatsSec) ||
    Array.isArray(meta?.sections);
  return Boolean(honest) && looksMusic;
}

// ------------------------------------------------------------
// যাচাই-কার্ড (§২.৩ + §১১-B) — অডিওর নিচে
// ------------------------------------------------------------

const VERDICT_META: Record<
  SpeechVerification['verdict'],
  { label: string; badge: string; Icon: typeof BadgeCheck }
> = {
  pass: {
    label: 'যাচাইকৃত',
    badge: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
    Icon: BadgeCheck,
  },
  warn: {
    label: 'সতর্কতা — শুনে নিশ্চিত করুন',
    badge: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    Icon: TriangleAlert,
  },
  fail: {
    label: 'ব্যর্থ',
    badge: 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400',
    Icon: XCircle,
  },
};

/** ASR-ট্রান্সক্রিপ্ট — উদ্ধৃতি-স্টাইল, ৩ লাইনে ভাঁজ + প্রসারণ */
function TranscriptBlock({ transcript }: { transcript: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <figure className="rounded-lg border bg-muted/40 px-3 py-2">
      <blockquote
        className={cn(
          'text-xs leading-relaxed text-foreground/90',
          !expanded && 'line-clamp-3',
        )}
      >
        <Quote className="mr-1 inline size-3 shrink-0 -translate-y-0.5 text-muted-foreground/70" aria-hidden="true" />
        {transcript}
      </blockquote>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 text-[11px] text-emerald-700 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40 dark:text-emerald-400"
        aria-expanded={expanded}
      >
        {expanded ? 'সংক্ষিপ্ত করুন' : 'পুরো ট্রান্সক্রিপ্ট দেখুন'}
      </button>
    </figure>
  );
}

function VerificationCard({ verification, meta }: { verification: SpeechVerification; meta: Record<string, unknown> }) {
  const verdict = VERDICT_META[verification.verdict];
  const VerdictIcon = verdict.Icon;

  const languageLabel = readString(meta, 'languageLabel');
  const voice = readString(meta, 'voice');

  return (
    <div className="mt-2 rounded-lg border bg-card px-3 py-2.5 shadow-sm" aria-label="কণ্ঠ-যাচাই প্রতিবেদন">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
            verdict.badge,
          )}
        >
          <VerdictIcon className="size-3" aria-hidden="true" />
          {verdict.label}
        </span>
        {languageLabel && (
          <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
            ভাষা: {languageLabel}
          </span>
        )}
        {voice && (
          <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
            কণ্ঠ: {voice}
          </span>
        )}
        {typeof verification.similarity === 'number' && (
          <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
            সাদৃশ্য: {toBnDigits(Math.round(verification.similarity * 100))}%
          </span>
        )}
        {typeof verification.durationSec === 'number' && verification.durationSec > 0 && (
          <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
            দৈর্ঘ্য: {toBnDigits(verification.durationSec.toFixed(1))} সে.
          </span>
        )}
      </div>

      {verification.transcript && (
        <div className="mt-2">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">ASR-ট্রান্সক্রিপ্ট (ফিরে-পড়া):</p>
          <TranscriptBlock transcript={verification.transcript} />
        </div>
      )}

      {verification.notes && verification.notes.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label="যাচাই-নোট">
          {verification.notes.map((note, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <List className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// ইনস্ট্রুমেন্টাল-মেটা-কার্ড — মুড/টেম্পো/কি/বিট + সৎ-লেবেল
// ------------------------------------------------------------

const MOOD_LABELS: Record<string, string> = {
  sad: 'বিষণ্ণ',
  romantic: 'রোমান্টিক',
  joyful: 'আনন্দময়',
  suspense: 'রহস্যময়',
  action: 'অ্যাকশন',
  peaceful: 'শান্ত',
};

function InstrumentalMetaCard({ meta }: { meta: Record<string, unknown> }) {
  const mood = readString(meta, 'mood');
  const tempoBpm = readNumber(meta, 'tempoBpm');
  const keyLabel = readString(meta, 'keyLabel');
  const beats = readNumberArray(meta, 'beatsSec');
  const sections = readStringArray(meta, 'sections');
  const honestLabel = readString(meta, 'honestLabel');

  return (
    <div className="mt-2 rounded-lg border bg-card px-3 py-2.5 shadow-sm" aria-label="সংগীত-মেটাডেটা">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-600/40 bg-emerald-600/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
          <Music className="size-3" aria-hidden="true" />
          ইনস্ট্রুমেন্টাল
        </span>
        {mood && (
          <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
            মুড: {MOOD_LABELS[mood] ?? mood}
          </span>
        )}
        {typeof tempoBpm === 'number' && (
          <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
            <Gauge className="size-3" aria-hidden="true" />
            টেম্পো: {toBnDigits(tempoBpm)} BPM
          </span>
        )}
        {keyLabel && (
          <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
            স্কেল: {keyLabel}
          </span>
        )}
        {beats && (
          <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
            বিট-মার্কার: {toBnDigits(beats.length)}টি
          </span>
        )}
        {sections && (
          <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
            সেকশন: {toBnDigits(sections.length)}টি
          </span>
        )}
      </div>
      {honestLabel && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          {honestLabel}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// ভিডিও-ইঞ্জিন-মেটা-কার্ড — শট-লেবেল + সৎ-লেবেল
// ------------------------------------------------------------

function VideoEngineMetaCard({ meta }: { meta: Record<string, unknown> }) {
  const shotEngineLabels = readStringArray(meta, 'shotEngineLabels');
  const honestLabel = readString(meta, 'honestLabel');
  const beats = readNumberArray(meta, 'beatsSec');

  return (
    <div className="mt-2 rounded-lg border bg-card px-3 py-2.5 shadow-sm" aria-label="ভিডিও-ইঞ্জিন মেটাডেটা">
      {shotEngineLabels && shotEngineLabels.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="শটভিত্তিক ইঞ্জিন-লেবেল">
          {shotEngineLabels.map((label, i) => (
            <span
              key={i}
              className="rounded-full border border-emerald-600/30 bg-emerald-600/5 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-400"
            >
              {label}
            </span>
          ))}
        </div>
      )}
      {beats && beats.length > 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          বিট-মার্কার: {toBnDigits(beats.length)}টি (গান-সমলয় কাটে ব্যবহৃত)
        </p>
      )}
      {honestLabel && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          {honestLabel}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// আর্টিফ্যাক্ট-ভিউ
// ------------------------------------------------------------

function DownloadLink({ url, className }: { url: string; className?: string }) {
  return (
    <a
      href={withDownloadParam(withStudioToken(url))}
      download
      className={
        className ??
        'inline-flex items-center gap-1 text-emerald-700 transition-colors hover:text-emerald-600 hover:underline dark:text-emerald-400 dark:hover:text-emerald-300'
      }
    >
      <Download className="size-3.5" aria-hidden="true" />
      ডাউনলোড
    </a>
  );
}

function ImageGrid({ artifacts }: { artifacts: ArtifactMeta[] }) {
  const [preview, setPreview] = useState<ArtifactMeta | null>(null);

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {artifacts.map((artifact) => (
          <button
            key={artifact.id}
            type="button"
            onClick={() => setPreview(artifact)}
            className="group relative overflow-hidden rounded-lg border bg-muted shadow-sm transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:outline-none"
            aria-label={`${artifact.fileName} প্রিভিউ করুন`}
          >
            <img
              src={withStudioToken(artifact.url)}
              alt={artifact.fileName}
              loading="lazy"
              className="h-24 w-full object-cover transition-transform duration-300 group-hover:scale-105 sm:h-28"
            />
          </button>
        ))}
      </div>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogTitle className="truncate pr-8 text-sm font-medium">
            {preview?.fileName}
          </DialogTitle>
          <DialogDescription className="sr-only">তৈরি হওয়া ছবির প্রিভিউ</DialogDescription>
          {preview && (
            <div className="space-y-4">
              <img
                src={withStudioToken(preview.url)}
                alt={preview.fileName}
                className="mx-auto max-h-[62vh] w-auto rounded-lg border"
              />
              <div className="flex items-center justify-center gap-3">
                <Button
                  asChild
                  className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
                >
                  <a href={withDownloadParam(withStudioToken(preview.url))} download>
                    <Download className="size-4" aria-hidden="true" />
                    ডাউনলোড
                  </a>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AudioArtifact({ artifact }: { artifact: ArtifactMeta }) {
  const meta = artifact.meta;
  const verification = readVerification(meta);
  const instrumental = isInstrumentalMeta(meta) && !verification;

  return (
    <div className="rounded-lg border bg-card p-2.5 shadow-sm">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        <AudioLines className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{artifact.fileName}</span>
        {formatSizeBn(artifact.size) && <span className="shrink-0">{formatSizeBn(artifact.size)}</span>}
        <DownloadLink url={artifact.url} className="inline-flex shrink-0 items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-400" />
      </div>
      <audio controls src={withStudioToken(artifact.url)} className="h-10 w-full" aria-label={artifact.fileName} />
      {/* §২.৩: যাচাই-প্রিভিউ — কোনো meta না থাকলে আগের মতোই */}
      {verification && <VerificationCard verification={verification} meta={meta ?? {}} />}
      {instrumental && <InstrumentalMetaCard meta={meta ?? {}} />}
    </div>
  );
}

function VideoArtifact({ artifact }: { artifact: ArtifactMeta }) {
  const meta = artifact.meta;
  const hasEngineMeta = Boolean(
    meta && (readStringArray(meta, 'shotEngineLabels') || readString(meta, 'honestLabel')),
  );

  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex items-center gap-2 px-2.5 pt-2 text-xs text-muted-foreground">
        <Film className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{artifact.fileName}</span>
        {formatSizeBn(artifact.size) && <span className="shrink-0">{formatSizeBn(artifact.size)}</span>}
        <DownloadLink url={artifact.url} className="inline-flex shrink-0 items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-400" />
      </div>
      <div className="p-2.5 pt-2">
        <video controls preload="metadata" src={withStudioToken(artifact.url)} className="max-h-[60vh] w-full rounded-md bg-black" aria-label={artifact.fileName} />
      </div>
      {/* শট-ইঞ্জিন লেবেল + সৎ-লেবেল (§১১-B) — meta না থাকলে আগের মতোই */}
      {hasEngineMeta && <div className="px-2.5 pb-2.5"><VideoEngineMetaCard meta={meta ?? {}} /></div>}
    </div>
  );
}

function TextArtifact({ artifact }: { artifact: ArtifactMeta }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs shadow-sm">
      <FileText className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{artifact.fileName}</span>
      <DownloadLink url={artifact.url} />
    </div>
  );
}

/** আর্টিফ্যাক্ট তালিকা: ছবি-গ্রিড (প্রিভিউ ডায়ালগসহ) + অডিও প্লেয়ার + ভিডিও + টেক্সট */
export function ArtifactList({ artifacts }: { artifacts: ArtifactMeta[] }) {
  const images = artifacts.filter((a) => a.kind === 'image');
  const audios = artifacts.filter((a) => a.kind === 'audio');
  const videos = artifacts.filter((a) => a.kind === 'video');
  const texts = artifacts.filter((a) => a.kind === 'text');

  if (artifacts.length === 0) return null;

  return (
    <div className="space-y-2">
      {images.length > 0 && <ImageGrid artifacts={images} />}
      {videos.map((a) => (
        <VideoArtifact key={a.id} artifact={a} />
      ))}
      {audios.map((a) => (
        <AudioArtifact key={a.id} artifact={a} />
      ))}
      {texts.map((a) => (
        <TextArtifact key={a.id} artifact={a} />
      ))}
    </div>
  );
}
