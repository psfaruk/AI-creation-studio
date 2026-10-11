'use client';

import { useState } from 'react';
import { AudioLines, Download, FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { ArtifactMeta } from '@/lib/types';

import { formatSizeBn, withDownloadParam } from '@/components/chat/bn-format';

function DownloadLink({ url, className }: { url: string; className?: string }) {
  return (
    <a
      href={withDownloadParam(url)}
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
            { }
            <img
              src={artifact.url}
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
              { }
              <img
                src={preview.url}
                alt={preview.fileName}
                className="mx-auto max-h-[62vh] w-auto rounded-lg border"
              />
              <div className="flex items-center justify-center gap-3">
                <Button
                  asChild
                  className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
                >
                  <a href={withDownloadParam(preview.url)} download>
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
  return (
    <div className="rounded-lg border bg-card p-2.5 shadow-sm">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        <AudioLines className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{artifact.fileName}</span>
        {formatSizeBn(artifact.size) && <span className="shrink-0">{formatSizeBn(artifact.size)}</span>}
        <DownloadLink url={artifact.url} className="inline-flex shrink-0 items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-400" />
      </div>
      { }
      <audio controls src={artifact.url} className="h-10 w-full" aria-label={artifact.fileName} />
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

/** আর্টিফ্যাক্ট তালিকা: ছবি-গ্রিড (প্রিভিউ ডায়ালগসহ) + অডিও প্লেয়ার + টেক্সট */
export function ArtifactList({ artifacts }: { artifacts: ArtifactMeta[] }) {
  const images = artifacts.filter((a) => a.kind === 'image');
  const audios = artifacts.filter((a) => a.kind === 'audio');
  const texts = artifacts.filter((a) => a.kind === 'text');

  if (artifacts.length === 0) return null;

  return (
    <div className="space-y-2">
      {images.length > 0 && <ImageGrid artifacts={images} />}
      {audios.map((a) => (
        <AudioArtifact key={a.id} artifact={a} />
      ))}
      {texts.map((a) => (
        <TextArtifact key={a.id} artifact={a} />
      ))}
    </div>
  );
}
