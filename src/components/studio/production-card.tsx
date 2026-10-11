'use client';

// ============================================================
// ProductionCard — চ্যাটে দেখানো প্রোডাকশন কার্ড (মাস্টার প্ল্যান পার্ট E)।
// - awaiting_confirmation → সম্পাদনাযোগ্য সেটিংস + নিশ্চিত/বাতিল
// - running/queued → ধাপ-তালিকা + অগ্রগতি + বাতিল
// - completed/partial/failed/cancelled → ফলাফল + সংশোধন
// [Task 2-a, Creative Studio upgrade] পলিশ: দৈর্ঘ্য/ফরম্যাট Select,
// সততার অ্যাম্বার নোট, ধাপ-পালস + বাংলা সময়, গ্যালারি-লিংক।
// ============================================================

import { useEffect, useState } from 'react';
import {
  BadgeCheck,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clapperboard,
  Film,
  Image as ImageIcon,
  Images,
  Loader2,
  Music,
  PencilRuler,
  RefreshCcw,
  TriangleAlert,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ArtifactList } from '@/components/chat/artifact-view';
import { toBnDigits } from '@/components/chat/bn-format';
import { useProductions } from '@/hooks/use-productions';
import { toast } from '@/hooks/use-toast';
import { useUiView } from '@/hooks/use-ui-view';
import type { CreativeJobSpec, ProductionStatus, ProductionView } from '@/lib/types';
import { cn } from '@/lib/utils';

// ------------------------------------------------------------
// স্ট্যাটাস ব্যাজ
// ------------------------------------------------------------

const STATUS_META: Record<ProductionStatus, { label: string; className: string }> = {
  awaiting_confirmation: { label: 'নিশ্চয়তার অপেক্ষায়', className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  queued: { label: 'সারিতে', className: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  running: { label: 'চলছে', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  validating: { label: 'যাচাই হচ্ছে', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  completed: { label: 'সম্পন্ন', className: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400' },
  partial: { label: 'আংশিক সফল', className: 'border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-400' },
  failed: { label: 'ব্যর্থ', className: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400' },
  cancelled: { label: 'বাতিল', className: 'border-muted bg-muted text-muted-foreground' },
  cancelling: { label: 'বাতিল হচ্ছে', className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
};

const TYPE_META: Record<string, { label: string; icon: typeof Film }> = {
  image: { label: 'ছবি প্রোডাকশন', icon: ImageIcon },
  audio: { label: 'অডিও প্রোডাকশন', icon: Music },
  motion_video: { label: 'মোশন ভিডিও', icon: Film },
  music_video: { label: 'মিউজিক ভিডিও', icon: Music },
  short_film: { label: 'শর্টফিল্ম', icon: Clapperboard },
};

const VIDEO_TYPES = ['motion_video', 'music_video', 'short_film'] as const;

const isVideoType = (type: CreativeJobSpec['type']) =>
  (VIDEO_TYPES as readonly string[]).includes(type);

/** দৈর্ঘ্যের নির্বাচনযোগ্য অপশন (§১৫ সীমার ভেতরে কয়েকটি বোধগম্য মান) */
const DURATION_OPTIONS: Record<string, number[]> = {
  motion_video: [5, 8, 10, 12, 15, 20],
  music_video: [15, 30, 60, 90, 120, 180],
  short_film: [30, 45, 60, 90, 120],
};

const IMAGE_FORMAT_LABELS: Record<NonNullable<CreativeJobSpec['format']>, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
};

/** ভিডিও পাইপলাইনের সততার নোট (ডিফিউশন ভিডিও-মডেল নয়) */
const VIDEO_PIPELINE_NOTE =
  'ভিডিও তৈরি হয় AI স্টোরিবোর্ড + সিনেম্যাটিক ক্যামেরা-মোশন পাইপলাইনে — ডিফিউশন ভিডিও-মডেল নয়; ফটোরিয়ালিস্টিক অভিনয়ের নিশ্চয়তা নেই।';

/** গান ছাড়া মিউজিক ভিডিওর নোট */
const NO_SONG_NOTE =
  'গান আপলোড করা হয়নি — ভিডিও নীরব থাকবে। চাইলে গানের অডিও আপলোড করে আবার অনুরোধ করুন।';

/** ছোট অ্যাম্বার সতর্কতা-নোট */
function AmberNote({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      {text}
    </p>
  );
}

// ------------------------------------------------------------
// সেটিংস সারাংশ (নিশ্চিতকরণের আগে দেখানো)
// ------------------------------------------------------------

function specSummaryText(spec: CreativeJobSpec): string[] {
  const bits: string[] = [];
  bits.push(`মান: ${spec.quality === 'draft' ? 'ড্রাফট (দ্রুত)' : spec.quality === 'high' ? 'উচ্চ' : 'স্ট্যান্ডার্ড'}`);
  if (spec.aspect) bits.push(`অনুপাত: ${toBnDigits(spec.aspect)}`);
  if (spec.durationSec) bits.push(`দৈর্ঘ্য: ${toBnDigits(spec.durationSec)} সেকেন্ড`);
  if (spec.fps) bits.push(`FPS: ${toBnDigits(spec.fps)}`);
  if (spec.sound) bits.push(`শব্দ: ${{ none: 'নীরব', ambient: 'পরিবেশ-শব্দ', narration: 'ভয়েসওভার', uploaded_song: 'আপলোড করা গান' }[spec.sound]}`);
  if (spec.voice) bits.push(`কণ্ঠ: ${spec.voice}`);
  if (spec.subtitles) bits.push('সাবটাইটেল: হ্যাঁ');
  if (spec.format) bits.push(`ফরম্যাট: ${IMAGE_FORMAT_LABELS[spec.format]}`);
  return bits;
}

// ------------------------------------------------------------
// সম্পাদনাযোগ্য সেটিংস (§১৪ ক্যাটালগ)
// ------------------------------------------------------------

function SpecEditor({
  spec,
  onChange,
}: {
  spec: CreativeJobSpec;
  onChange: (next: CreativeJobSpec) => void;
}) {
  const isVideo = isVideoType(spec.type);
  const patch = (p: Partial<CreativeJobSpec>) => onChange({ ...spec, ...p });

  // দৈর্ঘ্যের অপশন — বর্তমান মান তালিকায় না থাকলেও দেখাও (রিসেট/পুরোনো স্পেকের জন্য)
  const durationBase = DURATION_OPTIONS[spec.type] ?? [];
  const durationOptions =
    spec.durationSec !== undefined && !durationBase.includes(spec.durationSec)
      ? [...durationBase, spec.durationSec].sort((a, b) => a - b)
      : durationBase;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div className="col-span-2 space-y-1.5 sm:col-span-1">
        <Label className="text-xs text-muted-foreground">মান</Label>
        <Select value={spec.quality} onValueChange={v => patch({ quality: v as CreativeJobSpec['quality'] })}>
          <SelectTrigger className="h-9 bg-background text-sm" aria-label="মান">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">ড্রাফট — দ্রুত প্রিভিউ</SelectItem>
            <SelectItem value="standard">স্ট্যান্ডার্ড</SelectItem>
            <SelectItem value="high">উচ্চ — ধীর</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(isVideo || spec.type === 'image') && (
        <div className="col-span-1 space-y-1.5">
          <Label className="text-xs text-muted-foreground">অনুপাত</Label>
          <Select value={spec.aspect ?? '16:9'} onValueChange={v => patch({ aspect: v as CreativeJobSpec['aspect'] })}>
            <SelectTrigger className="h-9 bg-background text-sm" aria-label="অনুপাত">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="9:16">৯:১৬ — ভার্টিকাল</SelectItem>
              <SelectItem value="16:9">১৬:৯ — ল্যান্ডস্কেপ</SelectItem>
              <SelectItem value="1:1">১:১ — স্কয়ার</SelectItem>
              <SelectItem value="4:5">৪:৫ — পোর্ট্রেট</SelectItem>
              <SelectItem value="3:2">৩:২</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {spec.type === 'image' && spec.format !== undefined && (
        <div className="col-span-1 space-y-1.5">
          <Label className="text-xs text-muted-foreground">ফরম্যাট</Label>
          <Select value={spec.format} onValueChange={v => patch({ format: v as CreativeJobSpec['format'] })}>
            <SelectTrigger className="h-9 bg-background text-sm" aria-label="ফরম্যাট">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="png">PNG</SelectItem>
              <SelectItem value="jpeg">JPEG</SelectItem>
              <SelectItem value="webp">WebP</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {isVideo && (
        <div className="col-span-1 space-y-1.5">
          <Label className="text-xs text-muted-foreground">ফ্রেম-রেট</Label>
          <Select value={String(spec.fps ?? 30)} onValueChange={v => patch({ fps: Number(v) as 24 | 25 | 30 })}>
            <SelectTrigger className="h-9 bg-background text-sm" aria-label="ফ্রেম-রেট">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24">২৪ — সিনেম্যাটিক</SelectItem>
              <SelectItem value="25">২৫</SelectItem>
              <SelectItem value="30">৩০ — সোশ্যাল</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {isVideo && (
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label className="text-xs text-muted-foreground">দৈর্ঘ্য</Label>
          <Select
            value={spec.durationSec !== undefined ? String(spec.durationSec) : ''}
            onValueChange={v => patch({ durationSec: Number(v) })}
          >
            <SelectTrigger className="h-9 bg-background text-sm" aria-label="দৈর্ঘ্য">
              <SelectValue placeholder="স্বয়ংক্রিয়" />
            </SelectTrigger>
            <SelectContent>
              {durationOptions.map(sec => (
                <SelectItem key={sec} value={String(sec)}>
                  {toBnDigits(sec)} সেকেন্ড
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {spec.type === 'audio' && (
        <div className="col-span-1 space-y-1.5">
          <Label className="text-xs text-muted-foreground">কণ্ঠ</Label>
          <Select value={spec.voice ?? 'tongtong'} onValueChange={v => patch({ voice: v as CreativeJobSpec['voice'] })}>
            <SelectTrigger className="h-9 bg-background text-sm" aria-label="কণ্ঠ">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tongtong">tongtong</SelectItem>
              <SelectItem value="jam">jam</SelectItem>
              <SelectItem value="kazi">kazi</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {spec.type === 'image' && spec.overlayText !== undefined && (
        <div className="col-span-2 space-y-1.5 sm:col-span-3">
          <Label className="text-xs text-muted-foreground">লেখা (টাইপোগ্রাফি)</Label>
          <Textarea
            value={spec.overlayText ?? ''}
            onChange={e => patch({ overlayText: e.target.value })}
            rows={2}
            className="bg-background text-sm"
            aria-label="লেখা"
          />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// ধাপ-তালিকা
// ------------------------------------------------------------

function StepList({ view }: { view: ProductionView }) {
  return (
    <ol className="space-y-1.5" aria-label="প্রোডাকশন ধাপ">
      {view.steps.map(step => (
        <li key={step.id} className="flex items-start gap-2.5 text-sm">
          <span className="mt-0.5 shrink-0" aria-hidden="true">
            {step.status === 'done' ? (
              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
            ) : step.status === 'running' ? (
              <span className="flex animate-pulse items-center justify-center">
                <Loader2 className="size-4 animate-spin text-emerald-600 dark:text-emerald-400" />
              </span>
            ) : step.status === 'failed' ? (
              <XCircle className="size-4 text-red-500" />
            ) : step.status === 'skipped' ? (
              <Ban className="size-4 text-muted-foreground" />
            ) : (
              <CircleDashed className="size-4 text-muted-foreground/60" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn('block leading-tight', step.status === 'pending' && 'text-muted-foreground/70')}>
              {step.title}
            </span>
            {step.detail && <span className="block text-xs text-muted-foreground">{step.detail}</span>}
            {step.error && <span className="block text-xs text-red-500">{step.error}</span>}
          </span>
          {step.status === 'done' && step.durationMs != null && step.durationMs > 0 && (
            <span className="mt-0.5 shrink-0 text-[11px] tabular-nums text-muted-foreground/80">
              {toBnDigits((step.durationMs / 1000).toFixed(1))} সেকেন্ড
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------
// মূল কার্ড
// ------------------------------------------------------------

export function ProductionCard({ productionId }: { productionId: string }) {
  const view = useProductions(s => s.productions[productionId]);
  const ensureFetched = useProductions(s => s.ensureFetched);
  const subscribe = useProductions(s => s.subscribe);
  const confirmProduction = useProductions(s => s.confirmProduction);
  const cancelProduction = useProductions(s => s.cancelProduction);
  const reviseProduction = useProductions(s => s.reviseProduction);

  const [editedSpec, setEditedSpec] = useState<CreativeJobSpec | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRevising, setIsRevising] = useState(false);
  const [revisionId, setRevisionId] = useState<string | null>(null);

  useEffect(() => {
    void ensureFetched(productionId);
  }, [productionId, ensureFetched]);

  useEffect(() => {
    if (view) subscribe(productionId);
  }, [view, productionId, subscribe]);

  if (!view) {
    return (
      <div className="rounded-xl border bg-card p-3 text-sm text-muted-foreground shadow-sm">
        <Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden="true" />
        প্রোডাকশন লোড হচ্ছে…
      </div>
    );
  }

  const typeMeta = TYPE_META[view.type] ?? TYPE_META.image;
  const TypeIcon = typeMeta.icon;
  const statusMeta = STATUS_META[view.status];
  const isAwaiting = view.status === 'awaiting_confirmation';
  const isActive = ['queued', 'running', 'validating', 'cancelling'].includes(view.status);
  const isDone = ['completed', 'partial'].includes(view.status);

  // resultJson-এর সারাংশ (quality report)
  let resultSummary: { quality?: string; partialNotes?: string[] } | null = null;
  if (view.resultJson) {
    try {
      resultSummary = JSON.parse(view.resultJson);
    } catch {
      resultSummary = null;
    }
  }

  const spec = editedSpec ?? view.spec;

  const handleConfirm = async () => {
    setIsConfirming(true);
    const ok = await confirmProduction(productionId, editedSpec ? (editedSpec as unknown as Record<string, unknown>) : undefined);
    setIsConfirming(false);
    if (ok) toast({ title: 'প্রোডাকশন শুরু হয়েছে', description: view.title });
  };

  const handleRevise = async () => {
    setIsRevising(true);
    const revision = await reviseProduction(productionId, (editedSpec ?? view.spec) as unknown as Record<string, unknown>);
    setIsRevising(false);
    if (revision) {
      setRevisionId(revision.id);
      toast({ title: 'সংশোধন-প্রস্তাব তৈরি হয়েছে', description: 'নিচের নতুন কার্ডে নিশ্চিত করুন' });
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* হেডার */}
      <div className="flex items-start gap-3 border-b bg-muted/40 px-4 py-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
          <TypeIcon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-sm font-semibold">{view.title}</p>
            <Badge variant="outline" className={cn('shrink-0 text-[11px]', statusMeta.className)}>
              {statusMeta.label}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{typeMeta.label}</p>
        </div>
      </div>

      <div className="space-y-4 px-4 py-3.5">
        {/* নিশ্চিতকরণ অবস্থা */}
        {isAwaiting && (
          <div className="space-y-3.5">
            <div className="flex flex-wrap gap-1.5">
              {specSummaryText(spec).map(bit => (
                <Badge key={bit} variant="secondary" className="text-[11px] font-normal">
                  {bit}
                </Badge>
              ))}
            </div>
            <SpecEditor spec={spec} onChange={next => setEditedSpec(next)} />
            {isVideoType(spec.type) && <AmberNote text={VIDEO_PIPELINE_NOTE} />}
            {spec.type === 'music_video' &&
              spec.songArtifactId === undefined &&
              spec.sound !== 'uploaded_song' && <AmberNote text={NO_SONG_NOTE} />}
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <PencilRuler className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              সেটিংস বদলে নিশ্চিত করতে পারেন — নিশ্চিত করার পরেই প্রকৃত জেনারেশন শুরু হবে।
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => void handleConfirm()}
                disabled={isConfirming}
                className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
              >
                {isConfirming ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <BadgeCheck className="size-4" aria-hidden="true" />}
                নিশ্চিত করুন
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void cancelProduction(productionId)}
              >
                <Ban className="size-4" aria-hidden="true" />
                বাতিল
              </Button>
            </div>
          </div>
        )}

        {/* চলমান অবস্থা */}
        {isActive && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{STATUS_META[view.status].label}…</span>
                <span>{view.progress}%</span>
              </div>
              <Progress value={view.progress} className="h-1.5" aria-label="অগ্রগতি" />
            </div>
            <StepList view={view} />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void cancelProduction(productionId)}
              disabled={view.status === 'cancelling'}
            >
              <Ban className="size-4" aria-hidden="true" />
              {view.status === 'cancelling' ? 'বাতিল হচ্ছে…' : 'বাতিল করুন'}
            </Button>
          </div>
        )}

        {/* ফলাফল */}
        {(isDone || view.status === 'failed' || view.status === 'cancelled') && (
          <div className="space-y-3">
            {view.status === 'failed' && view.error && (
              <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {view.error}
              </p>
            )}
            {resultSummary?.partialNotes && resultSummary.partialNotes.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <p className="mb-1 font-medium">আংশিক সফলতার নোট:</p>
                <ul className="list-inside list-disc space-y-0.5">
                  {resultSummary.partialNotes.slice(0, 4).map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
            {resultSummary?.quality && (
              <p className="text-xs text-muted-foreground">{resultSummary.quality}</p>
            )}
            {view.artifacts.length > 0 && <ArtifactList artifacts={view.artifacts} />}
            {isDone && (
              <div className="flex flex-wrap gap-2">
                {view.status === 'completed' && view.artifacts.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => useUiView.getState().setActiveView('gallery')}
                  >
                    <Images className="size-4" aria-hidden="true" />
                    গ্যালারিতে দেখুন
                  </Button>
                )}
                {isDone && (
                  <Button size="sm" variant="outline" onClick={() => void handleRevise()} disabled={isRevising}>
                    {isRevising ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCcw className="size-4" aria-hidden="true" />}
                    সংশোধন করুন
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* সংশোধন-প্রস্তাব — নতুন কার্ড এখানেই দেখাও (nested) */}
      {revisionId && (
        <div className="border-t bg-muted/30 px-4 py-3">
          <ProductionCard productionId={revisionId} />
        </div>
      )}
    </div>
  );
}
