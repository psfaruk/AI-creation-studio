// ============================================================
// Image Studio tools — মাস্টার প্ল্যান §৩-এর ১২টি প্রয়োজনের বাস্তবায়ন (Task 2-b)।
//  - AI এডিট-মডেল টুল: edit_image, inpaint_image, remove_background,
//    remove_object, restyle_image (z-ai images.generations.edit-চালিত)
//  - নির্ধারণবাহী sharp টুল: enhance_image, color_grade_image,
//    transform_image, export_image (কোনো AI কল নেই — দ্রুত, সস্তা, নির্ভরযোগ্য)
//  - টাইপোগ্রাফি: compose_text_image (বেজ-ছবি + বাংলা SVG ওভারলে)
//  - পরিদর্শন: inspect_image (metadata + VLM গুণমান-রিপোর্ট, artifact তৈরি হয় না)
// pipelines/image.ts-ও এখানকার composeTypography ব্যবহার করে — একই ভিজ্যুয়াল ভাষা।
// ============================================================

import { z } from 'zod';
import sharp from 'sharp';
import { stat } from 'fs/promises';
import type { ArtifactMeta } from '@/lib/types';
import { readArtifactFile, saveArtifactFile } from '../storage';
import { artifactFilePath, artifactToDataUrl, createToolArtifact } from '../registry-helpers';
import type { ToolContext, ToolSpec } from '../registry-helpers';
import { IMAGE_SIZES, editImageBuffer, generateImageBuffer, visionAnalyze } from '../sdk-helpers';
import type { ImageSize } from '../sdk-helpers';
import { outputDims } from '../capabilities';

// ------------------------------------------------------------
// সাধারণ হেল্পার
// ------------------------------------------------------------

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/** SVG টেক্সটে বসানোর আগে XML এনটিটি escape */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** ভিজ্যুয়াল দৈর্ঘ্য (বাংলা যুক্তাক্ষরের হসন্ত-চিহ্ন বাদ দিয়ে গণনা) */
function visualLength(s: string): number {
  return [...s].filter(ch => ch !== '\u09CD').length;
}

interface ImageSource {
  dataUrl: string;
  fileName: string;
  width: number;
  height: number;
  format?: string;
  hasAlpha?: boolean;
  bytes: number;
}

/** artifact আইডি → এডিট/VLM-ইনপুট data URL + মাত্রা/মেটাডেটা */
async function resolveImageSource(artifactId: string): Promise<ImageSource> {
  const [{ dataUrl, fileName }, file] = await Promise.all([
    artifactToDataUrl(artifactId),
    artifactFilePath(artifactId),
  ]);
  const [meta, stats] = await Promise.all([sharp(file.path).metadata(), stat(file.path)]);
  return {
    dataUrl,
    fileName,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format,
    hasAlpha: meta.hasAlpha,
    bytes: stats.size,
  };
}

/** artifact আইডি → ছবির Buffer (sharp টুলগুলোর ইনপুট) */
async function loadImageFile(artifactId: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const { path, fileName, mimeType, kind } = await artifactFilePath(artifactId);
  if (kind !== 'image') throw new Error(`artifact টি ছবি নয় (${kind}) — ছবির artifact আইডি দাও`);
  const buffer = await readArtifactFile(path);
  if (!buffer || buffer.length === 0) throw new Error('ছবির ফাইল খালি বা পড়া যায়নি');
  return { buffer, fileName, mimeType };
}

/** উৎস-ছবির অনুপাতের সবচেয়ে কাছের সমর্থিত SDK সাইজ (বিকৃতি এড়াতে) */
function pickEditSize(width: number, height: number): ImageSize {
  if (!width || !height) return '1024x1024';
  const ratio = width / height;
  let best: ImageSize = '1024x1024';
  let bestDiff = Infinity;
  for (const size of IMAGE_SIZES) {
    const [w, h] = size.split('x').map(Number);
    const diff = Math.abs(w / h - ratio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = size;
    }
  }
  return best;
}

/** অনুরোধ-করা মাপের অনুপাতের কাছাকাছি SDK জেনারেশন সাইজ */
function pickGenSize(width?: number, height?: number): ImageSize {
  const ratio = (width ?? 1024) / (height ?? 1024);
  if (ratio > 1.2) return '1344x768';
  if (ratio < 0.83) return '768x1344';
  return '1024x1024';
}

/** ফলাফল-ছবি artifact হিসেবে সংরক্ষণ + নিবন্ধন */
async function saveImageArtifact(
  ctx: ToolContext,
  buffer: Buffer,
  opts: { ext?: string; mimeType?: string; fileName?: string; metaJson?: Record<string, unknown> } = {}
): Promise<{ meta: ArtifactMeta; width: number; height: number }> {
  if (!buffer || buffer.length === 0) throw new Error('ছবির ডেটা খালি — সংরক্ষণ করা যায়নি');
  const info = await sharp(buffer).metadata();
  const width = info.width ?? 0;
  const height = info.height ?? 0;
  const { storagePath, relName } = await saveArtifactFile(buffer, opts.ext ?? 'png');
  const meta = await createToolArtifact({
    conversationId: ctx.conversationId,
    runId: ctx.runId,
    kind: 'image',
    mimeType: opts.mimeType ?? 'image/png',
    fileName: opts.fileName ?? relName,
    size: buffer.length,
    storagePath,
    metaJson: {
      ...(width && height ? { dimensions: `${width}x${height}` } : {}),
      ...(opts.metaJson ?? {}),
    },
  });
  return { meta, width, height };
}

// ------------------------------------------------------------
// বাংলা টাইপোগ্রাফি — SVG ওভারলে (compose_text_image + পাইপলাইন শেয়ার করে)
// ------------------------------------------------------------

export type TypographyTheme = 'dark' | 'light' | 'emerald' | 'warm';

export interface TypographyOptions {
  heading: string;
  subheading?: string;
  theme?: TypographyTheme;
}

interface ThemeSpec {
  textColor: string;
  scrimColor: string;
  scrimOpacity: number;
}

const TYPO_THEMES: Record<TypographyTheme, ThemeSpec> = {
  dark: { textColor: '#ffffff', scrimColor: '#000000', scrimOpacity: 0.82 },
  light: { textColor: '#111111', scrimColor: '#ffffff', scrimOpacity: 0.92 },
  emerald: { textColor: '#ffffff', scrimColor: '#064e3b', scrimOpacity: 0.88 }, // emerald-900
  warm: { textColor: '#ffffff', scrimColor: '#78350f', scrimOpacity: 0.88 }, // amber-900
};

const BRAND_TEXT = 'ক্রিয়েটিভ স্টুডিও';

/** প্রস্থ-সীমা ছাড়ালে ফন্ট-সাইজ ছোট করা (min পর্যন্ত) */
function fitFontSize(text: string, size: number, maxPxWidth: number, minSize: number, charWidthEm: number): number {
  let s = size;
  while (s > minSize && text.length * s * charWidthEm > maxPxWidth) s -= 2;
  return s;
}

/** বেজ-ছবির ওপরে বসানোর টাইপোগ্রাফি-SVG তৈরি করে (নিচের ৪৫%-এ গ্রেডিয়েন্ট স্ক্রিম) */
export function buildTypographySvg(width: number, height: number, opts: TypographyOptions): string {
  const theme = TYPO_THEMES[opts.theme ?? 'dark'];
  const u = Math.min(2.5, Math.max(0.5, height / 1024));
  const heading = opts.heading.trim();
  const subheading = opts.subheading?.trim() ?? '';

  const headBase = visualLength(heading) > 18 ? 56 : 76;
  const headSize = fitFontSize(heading, Math.round(headBase * u), width * 0.92, Math.max(20, Math.round(20 * u)), 0.6);
  const subSize = subheading
    ? fitFontSize(subheading, Math.round(34 * u), width * 0.86, Math.max(15, Math.round(15 * u)), 0.55)
    : 0;
  const brandSize = Math.round(22 * u);

  const bottomPad = Math.round(height * 0.06);
  const subY = height - bottomPad;
  const headY = subheading ? subY - Math.round(subSize * 1.7) : height - bottomPad - Math.round(headSize * 0.28);
  const scrimTop = Math.round(height * 0.55);
  const scrimHeight = height - scrimTop;
  const brandX = Math.round(48 * u);
  const brandY = Math.round(64 * u);

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  parts.push('<defs><linearGradient id="bnScrim" x1="0" y1="0" x2="0" y2="1">');
  parts.push(`<stop offset="0" stop-color="${theme.scrimColor}" stop-opacity="0"/>`);
  parts.push(`<stop offset="0.55" stop-color="${theme.scrimColor}" stop-opacity="${(theme.scrimOpacity * 0.5).toFixed(3)}"/>`);
  parts.push(`<stop offset="1" stop-color="${theme.scrimColor}" stop-opacity="${theme.scrimOpacity.toFixed(3)}"/>`);
  parts.push('</linearGradient></defs>');
  parts.push(`<rect x="0" y="${scrimTop}" width="${width}" height="${scrimHeight}" fill="url(#bnScrim)"/>`);
  parts.push(
    `<text x="${brandX}" y="${brandY}" font-family="Noto Sans Bengali" font-size="${brandSize}" font-weight="500" ` +
      `fill="${theme.textColor}" fill-opacity="0.78" stroke="${theme.scrimColor}" stroke-width="${Math.max(1, brandSize * 0.07).toFixed(1)}" ` +
      `paint-order="stroke" stroke-linejoin="round">${xmlEscape(BRAND_TEXT)}</text>`
  );
  parts.push(
    `<text x="${Math.round(width / 2)}" y="${headY}" font-family="Noto Sans Bengali" font-size="${headSize}" ` +
      `font-weight="700" fill="${theme.textColor}" text-anchor="middle">${xmlEscape(heading)}</text>`
  );
  if (subheading) {
    parts.push(
      `<text x="${Math.round(width / 2)}" y="${subY}" font-family="Noto Sans Bengali" font-size="${subSize}" ` +
        `font-weight="400" fill="${theme.textColor}" fill-opacity="0.82" text-anchor="middle">${xmlEscape(subheading)}</text>`
    );
  }
  parts.push('</svg>');
  return parts.join('');
}

/** বেজ-ছবি + টাইপোগ্রাফি ওভারলে → যুক্ত PNG */
export async function composeTypography(base: Buffer, opts: TypographyOptions): Promise<Buffer> {
  const meta = await sharp(base).metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;
  const svg = buildTypographySvg(width, height, opts);
  return sharp(base)
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer();
}

// ------------------------------------------------------------
// ১. edit_image — স্বাভাবিক ভাষার নির্দেশে সম্পাদনা
// ------------------------------------------------------------

const editImageSpec: ToolSpec<{
  image: string;
  prompt: string;
  size?: '1024x1024' | '1344x768' | '768x1344';
}> = {
  name: 'edit_image',
  parameters: z.object({
    image: z.string().min(1).max(100),
    prompt: z.string().min(1).max(1000),
    size: z.enum(['1024x1024', '1344x768', '768x1344']).optional(),
  }),
  timeoutMs: 180_000,
  usage:
    'edit_image — আপলোড করা/তৈরি ছবিতে স্বাভাবিক ভাষার নির্দেশে পরিবর্তন আনে (AI এডিট-মডেল)। arguments: {"image": string (artifact আইডি), "prompt": string (১–১০০০ অক্ষর, ইংরেজিতে দিলে সেরা ফল), "size"?: "1024x1024"|"1344x768"|"768x1344" (না দিলে উৎস-ছবির অনুপাত অনুযায়ী নির্বাচিত)}',
  inputSummary: i => `নির্দেশ: ${truncate(i.prompt, 90)}`,
  execute: async (input, ctx) => {
    const src = await resolveImageSource(input.image);
    const size = input.size ?? pickEditSize(src.width, src.height);
    const prompt = `${input.prompt.trim()}, keep unmentioned parts unchanged, maintain overall composition`;
    const { buffer } = await editImageBuffer(src.dataUrl, prompt, size);
    const { meta, width, height } = await saveImageArtifact(ctx, buffer, {
      metaJson: { operation: 'edit', size, sourceArtifactId: input.image },
    });
    return {
      summary: `ছবি সম্পাদনা সম্পন্ন (${width}x${height})`,
      resultJson: JSON.stringify({ artifactId: meta.id, sourceArtifactId: input.image }),
      artifacts: [meta],
    };
  },
};

// ------------------------------------------------------------
// ২. inpaint_image — নির্দিষ্ট অংশ পূরণ (generative fill)
// ------------------------------------------------------------

const inpaintImageSpec: ToolSpec<{ image: string; region: string; fill: string }> = {
  name: 'inpaint_image',
  parameters: z.object({
    image: z.string().min(1).max(100),
    region: z.string().min(1).max(400),
    fill: z.string().min(1).max(600),
  }),
  timeoutMs: 180_000,
  usage:
    'inpaint_image — ছবির নির্দিষ্ট অংশ/বস্তু বর্ণনা অনুযায়ী নতুন করে আঁকে (generative fill); বাকি অংশ অপরিবর্তিত থাকে। arguments: {"image": string (artifact আইডি), "region": string (কোন অংশ — বর্ণনা, যেমন "পেছনের আকাশ"), "fill": string (কী বসাতে হবে — বর্ণনা)}',
  inputSummary: i => `অংশ: ${truncate(i.region, 60)} → ${truncate(i.fill, 50)}`,
  execute: async (input, ctx) => {
    const src = await resolveImageSource(input.image);
    const size = pickEditSize(src.width, src.height);
    const prompt =
      `In the described image, modify only the area/element: ${input.region.trim()}. ` +
      `Replace it with: ${input.fill.trim()}. ` +
      'Keep every other part of the image exactly unchanged, same lighting, same style.';
    const { buffer } = await editImageBuffer(src.dataUrl, prompt, size);
    const { meta, width, height } = await saveImageArtifact(ctx, buffer, {
      metaJson: { operation: 'inpaint', region: input.region, fill: input.fill, sourceArtifactId: input.image },
    });
    return {
      summary: `নির্দিষ্ট অংশ পূরণ সম্পন্ন (${width}x${height})`,
      resultJson: JSON.stringify({
        artifactId: meta.id,
        sourceArtifactId: input.image,
        dimensions: `${width}x${height}`,
      }),
      artifacts: [meta],
    };
  },
};

// ------------------------------------------------------------
// ৩. remove_background — পটভূমি প্রতিস্থাপন
// ------------------------------------------------------------

const removeBackgroundSpec: ToolSpec<{ image: string; replacement: string }> = {
  name: 'remove_background',
  parameters: z.object({
    image: z.string().min(1).max(100),
    replacement: z.string().min(1).max(300),
  }),
  timeoutMs: 180_000,
  usage:
    'remove_background — পটভূমি সরিয়ে মূল বিষয়বস্তুকে আলাদা করে এবং নতুন পটভূমি বসায়। সতর্কতা: এডিট-মডেল আসল আলফা-চ্যানেল (স্বচ্ছ PNG) তৈরি করতে পারে না — "transparent-look" মানে সাদা ব্যাকগ্রাউন্ডে কাট-আউট লুক। arguments: {"image": string (artifact আইডি), "replacement": string ("white" | "transparent-look" | নিজের পটভূমির বর্ণনা)}',
  inputSummary: i => `নতুন পটভূমি: ${truncate(i.replacement, 70)}`,
  execute: async (input, ctx) => {
    const src = await resolveImageSource(input.image);
    const size = pickEditSize(src.width, src.height);
    const repl = input.replacement.trim();
    let prompt: string;
    if (repl === 'white') {
      prompt =
        'Isolate the main subject cleanly and replace the entire background with a pure plain white background. ' +
        'Keep the subject itself completely unchanged, with crisp natural edges and consistent lighting.';
    } else if (repl === 'transparent-look') {
      prompt =
        'Isolate the main subject and place it on a plain solid white background, subject isolated, ' +
        'so it looks like a transparent-background cutout rendered on white. ' +
        'Keep the subject completely unchanged with crisp natural edges.';
    } else {
      prompt =
        `Isolate the main subject and replace the entire background with: ${repl}. ` +
        'Match perspective and lighting naturally. Keep the subject itself completely unchanged with crisp natural edges.';
    }
    const { buffer } = await editImageBuffer(src.dataUrl, prompt, size);
    const { meta, width, height } = await saveImageArtifact(ctx, buffer, {
      metaJson: { operation: 'remove_background', replacement: repl, sourceArtifactId: input.image },
    });
    return {
      summary: `পটভূমি প্রতিস্থাপন সম্পন্ন (${width}x${height})`,
      resultJson: JSON.stringify({
        artifactId: meta.id,
        sourceArtifactId: input.image,
        replacement: repl,
      }),
      artifacts: [meta],
    };
  },
};

// ------------------------------------------------------------
// ৪. remove_object — অবাঞ্ছিত বস্তু অপসারণ
// ------------------------------------------------------------

const removeObjectSpec: ToolSpec<{ image: string; object: string }> = {
  name: 'remove_object',
  parameters: z.object({
    image: z.string().min(1).max(100),
    object: z.string().min(1).max(300),
  }),
  timeoutMs: 180_000,
  usage:
    'remove_object — ছবি থেকে অবাঞ্ছিত বস্তু/মানুষ মুছে ফেলে এবং পেছনের অংশ স্বাভাবিকভাবে পুনর্গঠন করে। arguments: {"image": string (artifact আইডি), "object": string (কী মুছতে হবে — বর্ণনা)}',
  inputSummary: i => `অপসারণ: ${truncate(i.object, 80)}`,
  execute: async (input, ctx) => {
    const src = await resolveImageSource(input.image);
    const size = pickEditSize(src.width, src.height);
    const prompt = `Remove the ${input.object.trim()} completely, reconstruct the background naturally behind it, keep everything else identical.`;
    const { buffer } = await editImageBuffer(src.dataUrl, prompt, size);
    const { meta, width, height } = await saveImageArtifact(ctx, buffer, {
      metaJson: { operation: 'remove_object', object: input.object, sourceArtifactId: input.image },
    });
    return {
      summary: `বস্তু অপসারণ সম্পন্ন (${width}x${height})`,
      resultJson: JSON.stringify({
        artifactId: meta.id,
        sourceArtifactId: input.image,
        dimensions: `${width}x${height}`,
      }),
      artifacts: [meta],
    };
  },
};

// ------------------------------------------------------------
// ৫. restyle_image — শৈলী রূপান্তর (image-to-image)
// ------------------------------------------------------------

const restyleImageSpec: ToolSpec<{ image: string; style: string; strength: 'light' | 'medium' | 'strong' }> = {
  name: 'restyle_image',
  parameters: z.object({
    image: z.string().min(1).max(100),
    style: z.string().min(1).max(300),
    strength: z.enum(['light', 'medium', 'strong']).optional().default('medium'),
  }),
  timeoutMs: 180_000,
  usage:
    'restyle_image — ছবিকে নতুন শৈলীতে রূপান্তর করে (image-to-image); কম্পোজিশন ও বিষয়ের পরিচয় অটুট থাকে। arguments: {"image": string (artifact আইডি), "style": string (শৈলীর বর্ণনা, যেমন "watercolor painting", "cyberpunk neon"), "strength"?: "light"|"medium"|"strong" (ডিফল্ট "medium")}',
  inputSummary: i => `শৈলী: ${truncate(i.style, 60)} (${i.strength})`,
  execute: async (input, ctx) => {
    const src = await resolveImageSource(input.image);
    const size = pickEditSize(src.width, src.height);
    const strengthWording: Record<'light' | 'medium' | 'strong', string> = {
      light: 'Apply a light, subtle restyle',
      medium: 'Restyle the image',
      strong: 'Boldly transform the image',
    };
    const prompt =
      `${strengthWording[input.strength]} into this art style: ${input.style.trim()}. ` +
      "Preserve the original composition, framing, subject identity and pose. Keep the same layout and content, change only the visual style.";
    const { buffer } = await editImageBuffer(src.dataUrl, prompt, size);
    const { meta, width, height } = await saveImageArtifact(ctx, buffer, {
      metaJson: { operation: 'restyle', style: input.style, strength: input.strength, sourceArtifactId: input.image },
    });
    return {
      summary: `শৈলী রূপান্তর সম্পন্ন (${width}x${height})`,
      resultJson: JSON.stringify({
        artifactId: meta.id,
        sourceArtifactId: input.image,
        style: input.style,
        strength: input.strength,
      }),
      artifacts: [meta],
    };
  },
};

// ------------------------------------------------------------
// ৬. enhance_image — নির্ধারণবাহী আপস্কেল/শার্পেন/ডিনয়েজ (AI নয়)
// ------------------------------------------------------------

const enhanceImageSpec: ToolSpec<{ image: string; scale: 2 | 3; sharpen: boolean; denoise: boolean }> = {
  name: 'enhance_image',
  parameters: z.object({
    image: z.string().min(1).max(100),
    scale: z.union([z.literal(2), z.literal(3)]).optional().default(2),
    sharpen: z.boolean().optional().default(true),
    denoise: z.boolean().optional().default(false),
  }),
  timeoutMs: 60_000,
  usage:
    'enhance_image — নির্ধারণবাহী (AI-বিহীন) উন্নতকরণ: lanczos আপস্কেল + শার্পেন + ডিনয়েজ। সতর্কতা: এটি lanczos আপস্কেল — নতুন AI-ডিটেইল যোগ হয় না, তবে দ্রুত ও নির্ভরযোগ্য। arguments: {"image": string (artifact আইডি), "scale"?: 2|3 (ডিফল্ট 2), "sharpen"?: boolean (ডিফল্ট true), "denoise"?: boolean (ডিফল্ট false)}',
  inputSummary: i =>
    `আপস্কেল ${i.scale}x${i.sharpen ? ' · শার্পেন' : ''}${i.denoise ? ' · ডিনয়েজ' : ''}`,
  execute: async (input, ctx) => {
    const { buffer } = await loadImageFile(input.image);
    const meta = await sharp(buffer).metadata();
    const srcW = meta.width ?? 0;
    const srcH = meta.height ?? 0;
    if (!srcW || !srcH) throw new Error('ছবির মাত্রা পড়া যায়নি — ফাইলটি সম্ভবত করাপ্ট');
    let pipe = sharp(buffer);
    if (input.denoise) pipe = pipe.median(3);
    pipe = pipe.resize({ width: srcW * input.scale, kernel: 'lanczos3' });
    if (input.sharpen) pipe = pipe.sharpen({ sigma: 1.2 });
    const out = await pipe.png().toBuffer();
    const { meta: artifact, width, height } = await saveImageArtifact(ctx, out, {
      metaJson: {
        operation: 'enhance',
        scale: input.scale,
        sharpen: input.sharpen,
        denoise: input.denoise,
        from: `${srcW}x${srcH}`,
        sourceArtifactId: input.image,
      },
    });
    return {
      summary: `উন্নতকরণ সম্পন্ন: ${srcW}x${srcH} → ${width}x${height}`,
      resultJson: JSON.stringify({
        artifactId: artifact.id,
        sourceArtifactId: input.image,
        from: `${srcW}x${srcH}`,
        to: `${width}x${height}`,
        scale: input.scale,
        sharpen: input.sharpen,
        denoise: input.denoise,
      }),
      artifacts: [artifact],
    };
  },
};

// ------------------------------------------------------------
// ৭. color_grade_image — রং সংশোধন (নির্ধারণবাহী)
// ------------------------------------------------------------

const colorGradeImageSpec: ToolSpec<{
  image: string;
  brightness?: number;
  saturation?: number;
  hue?: number;
  gamma?: number;
  contrast?: number;
}> = {
  name: 'color_grade_image',
  parameters: z
    .object({
      image: z.string().min(1).max(100),
      brightness: z.number().min(0.5).max(1.5).optional(),
      saturation: z.number().min(0).max(2).optional(),
      hue: z.number().int().min(-90).max(90).optional(),
      gamma: z.number().min(0.5).max(2.2).optional(),
      contrast: z.number().min(0.5).max(2).optional(),
    })
    .refine(o => o.brightness != null || o.saturation != null || o.hue != null || o.gamma != null || o.contrast != null, {
      message: 'অন্তত একটি রং-সংশোধন মান দাও (brightness/saturation/hue/gamma/contrast)',
    }),
  timeoutMs: 60_000,
  usage:
    'color_grade_image — রং সংশোধন: উজ্জ্বলতা, স্যাচুরেশন, হিউ, গামা, কনট্রাস্ট (নির্ধারণবাহী, তাৎক্ষণিক)। শুধু দেওয়া প্যারামিটারগুলোই প্রযোজ্য হয়; অন্তত একটি দিতে হবে। arguments: {"image": string (artifact আইডি), "brightness"?: number (০.৫–১.৫), "saturation"?: number (০–২), "hue"?: number (-৯০ থেকে ৯০ ডিগ্রি), "gamma"?: number (০.৫–২.২; কার্যকর সীমা ১.০–২.২ — নিচের মান ১.০-এ ক্ল্যাম্প), "contrast"?: number (০.৫–২)}',
  inputSummary: i => {
    const parts: string[] = [];
    if (i.brightness != null) parts.push(`উজ্জ্বলতা ${i.brightness}`);
    if (i.saturation != null) parts.push(`স্যাচুরেশন ${i.saturation}`);
    if (i.hue != null) parts.push(`হিউ ${i.hue}°`);
    if (i.gamma != null) parts.push(`গামা ${i.gamma}`);
    if (i.contrast != null) parts.push(`কনট্রাস্ট ${i.contrast}`);
    return parts.length ? `রং: ${parts.join(', ')}` : 'রং সংশোধন';
  },
  execute: async (input, ctx) => {
    const { buffer } = await loadImageFile(input.image);
    let pipe = sharp(buffer);
    const mod: { brightness?: number; saturation?: number; hue?: number } = {};
    if (input.brightness != null) mod.brightness = input.brightness;
    if (input.saturation != null) mod.saturation = input.saturation;
    if (input.hue != null) mod.hue = input.hue;
    if (mod.brightness != null || mod.saturation != null || mod.hue != null) pipe = pipe.modulate(mod);
    if (input.contrast != null) {
      const c = input.contrast;
      pipe = pipe.linear(c, Math.round(128 * (1 - c) * 100) / 100);
    }
    let appliedGamma: number | null = null;
    if (input.gamma != null) {
      appliedGamma = Math.min(2.2, Math.max(1, input.gamma)); // sharp গামা ১.০–৩.০ সীমা মানে
      pipe = pipe.gamma(appliedGamma);
    }
    const out = await pipe.png().toBuffer();
    const { meta, width, height } = await saveImageArtifact(ctx, out, {
      metaJson: {
        operation: 'color_grade',
        applied: {
          brightness: input.brightness ?? null,
          saturation: input.saturation ?? null,
          hue: input.hue ?? null,
          gamma: appliedGamma,
          contrast: input.contrast ?? null,
        },
        gammaClamped: input.gamma != null && appliedGamma !== input.gamma,
        sourceArtifactId: input.image,
      },
    });
    return {
      summary: `রং সংশোধন সম্পন্ন (${width}x${height})`,
      resultJson: JSON.stringify({
        artifactId: meta.id,
        sourceArtifactId: input.image,
        applied: {
          brightness: input.brightness ?? null,
          saturation: input.saturation ?? null,
          hue: input.hue ?? null,
          gamma: appliedGamma,
          contrast: input.contrast ?? null,
        },
      }),
      artifacts: [meta],
    };
  },
};

// ------------------------------------------------------------
// ৮. transform_image — ক্রপ/রিসাইজ/ঘূর্ণন/ফ্লিপ/অনুপাত
// ------------------------------------------------------------

const OP_LABELS: Record<'crop' | 'resize' | 'rotate' | 'flip' | 'flop' | 'aspect', string> = {
  crop: 'ক্রপ',
  resize: 'রিসাইজ',
  rotate: 'ঘূর্ণন',
  flip: 'উল্লম্ব ফ্লিপ',
  flop: 'আনুভূমিক ফ্লিপ',
  aspect: 'অনুপাত',
};

const transformImageSpec: ToolSpec<{
  image: string;
  op: 'crop' | 'resize' | 'rotate' | 'flip' | 'flop' | 'aspect';
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  degrees?: 90 | 180 | 270;
  aspect?: '1:1' | '4:5' | '3:2' | '16:9' | '9:16';
}> = {
  name: 'transform_image',
  parameters: z.object({
    image: z.string().min(1).max(100),
    op: z.enum(['crop', 'resize', 'rotate', 'flip', 'flop', 'aspect']),
    width: z.number().int().min(16).max(4000).optional(),
    height: z.number().int().min(16).max(4000).optional(),
    left: z.number().int().min(0).max(20000).optional(),
    top: z.number().int().min(0).max(20000).optional(),
    degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]).optional(),
    aspect: z.enum(['1:1', '4:5', '3:2', '16:9', '9:16']).optional(),
  }),
  timeoutMs: 60_000,
  usage:
    'transform_image — জ্যামিতিক রূপান্তর (নির্ধারণবাহী): ক্রপ, রিসাইজ, ঘূর্ণন, ফ্লিপ/মিরর, অনুপাত-বদল। arguments: {"image": string (artifact আইডি), "op": "crop"|"resize"|"rotate"|"flip"|"flop"|"aspect", "width"?: number (১৬–৪০০০; crop/resize-এ), "height"?: number (১৬–৪০০০), "left"?: number, "top"?: number (crop-এ আবশ্যক), "degrees"?: 90|180|270 (rotate-এ আবশ্যক), "aspect"?: "1:1"|"4:5"|"3:2"|"16:9"|"9:16" (aspect-এ আবশ্যক)} — op অনুযায়ী প্রয়োজনীয় প্যারামিটার দাও; crop-এ width/height/left/top চারটিই লাগে।',
  inputSummary: i => {
    let detail = '';
    if (i.op === 'crop') detail = ` (${i.left ?? '?'},${i.top ?? '?'} ${i.width ?? '?'}x${i.height ?? '?'})`;
    else if (i.op === 'resize') detail = ` (${i.width ?? 'auto'}x${i.height ?? 'auto'})`;
    else if (i.op === 'rotate') detail = ` (${i.degrees ?? '?'}°)`;
    else if (i.op === 'aspect') detail = ` (${i.aspect ?? '?'})`;
    return `${OP_LABELS[i.op]}${detail}`;
  },
  execute: async (input, ctx) => {
    const { buffer } = await loadImageFile(input.image);
    const meta = await sharp(buffer).metadata();
    const srcW = meta.width ?? 0;
    const srcH = meta.height ?? 0;
    if (!srcW || !srcH) throw new Error('ছবির মাত্রা পড়া যায়নি — ফাইলটি সম্ভবত করাপ্ট');

    let pipe = sharp(buffer);
    switch (input.op) {
      case 'crop': {
        const { width, height, left, top } = input;
        if (width == null || height == null || left == null || top == null) {
          throw new Error('crop-এর জন্য width, height, left, top — চারটি প্যারামিটারই দরকার');
        }
        if (left + width > srcW || top + height > srcH) {
          throw new Error(
            `crop-এর সীমা ছবির বাইরে চলে গেছে (ছবি ${srcW}x${srcH}, অনুরোধ: left=${left}+width=${width}, top=${top}+height=${height})`
          );
        }
        pipe = pipe.extract({ left, top, width, height });
        break;
      }
      case 'resize': {
        if (input.width == null && input.height == null) {
          throw new Error('resize-এর জন্য width অথবা height — অন্তত একটি দাও');
        }
        pipe = pipe.resize({
          width: input.width,
          height: input.height,
          fit: input.width != null && input.height != null ? 'cover' : 'inside',
        });
        break;
      }
      case 'rotate': {
        if (input.degrees == null) throw new Error('rotate-এর জন্য degrees (90|180|270) দরকার');
        pipe = pipe.rotate(input.degrees);
        break;
      }
      case 'flip':
        pipe = pipe.flip();
        break;
      case 'flop':
        pipe = pipe.flop();
        break;
      case 'aspect': {
        if (input.aspect == null) {
          throw new Error('aspect অপারেশনের জন্য aspect ("1:1"|"4:5"|"3:2"|"16:9"|"9:16") দরকার');
        }
        const { w, h } = outputDims(input.aspect, '1080p');
        pipe = pipe.resize({ width: w, height: h, fit: 'cover' });
        break;
      }
    }
    const out = await pipe.png().toBuffer();
    const { meta: artifact, width, height } = await saveImageArtifact(ctx, out, {
      metaJson: {
        operation: 'transform',
        op: input.op,
        params: {
          width: input.width ?? null,
          height: input.height ?? null,
          left: input.left ?? null,
          top: input.top ?? null,
          degrees: input.degrees ?? null,
          aspect: input.aspect ?? null,
        },
        from: `${srcW}x${srcH}`,
        sourceArtifactId: input.image,
      },
    });
    return {
      summary: `${OP_LABELS[input.op]} সম্পন্ন: ${srcW}x${srcH} → ${width}x${height}`,
      resultJson: JSON.stringify({
        artifactId: artifact.id,
        sourceArtifactId: input.image,
        op: input.op,
        from: `${srcW}x${srcH}`,
        to: `${width}x${height}`,
      }),
      artifacts: [artifact],
    };
  },
};

// ------------------------------------------------------------
// ৯. compose_text_image — বাংলা টাইপোগ্রাফি/পোস্টার
// ------------------------------------------------------------

const composeTextImageSpec: ToolSpec<{
  image?: string;
  basePrompt?: string;
  heading: string;
  subheading?: string;
  theme: TypographyTheme;
  width?: 1024 | 1344 | 768;
  height?: number;
}> = {
  name: 'compose_text_image',
  parameters: z
    .object({
      image: z.string().min(1).max(100).optional(),
      basePrompt: z.string().min(1).max(1500).optional(),
      heading: z.string().min(1).max(60),
      subheading: z.string().max(120).optional(),
      theme: z.enum(['dark', 'light', 'emerald', 'warm']).optional().default('dark'),
      width: z.union([z.literal(1024), z.literal(1344), z.literal(768)]).optional(),
      height: z.number().int().min(256).max(2000).optional(),
    })
    .refine(o => o.image != null || o.basePrompt != null, {
      message: 'বিদ্যমান ছবির artifact আইডি ("image") অথবা বেজ-প্রম্পট ("basePrompt") — অন্তত একটি দাও',
    }),
  timeoutMs: 180_000,
  usage:
    'compose_text_image — ছবির ওপর বাংলা/ইংরেজি টাইপোগ্রাফি বসিয়ে পোস্টার, থাম্বনেইল বা ব্যানার বানায়। বেজ হিসেবে বিদ্যমান artifact অথবা basePrompt থেকে নতুন ছবি — একটি লাগবেই। নিচের অংশে গ্রেডিয়েন্ট স্ক্রিমের ওপর শিরোনাম + উপশিরোনাম বসে। arguments: {"image"?: string (বিদ্যমান artifact আইডি), "basePrompt"?: string (নতুন বেজ-ছবির ইংরেজি প্রম্পট), "heading": string (মূল লেখা, ১–৬০ অক্ষর), "subheading"?: string (উপশিরোনাম, ১–১২০), "theme"?: "dark"|"light"|"emerald"|"warm" (ডিফল্ট "dark"), "width"?: 1024|1344|768, "height"?: number (বেজ জেনারেশনের অনুপাত ঠিক করতে)}',
  inputSummary: i => `শিরোনাম: ${truncate(i.heading, 50)}`,
  execute: async (input, ctx) => {
    let baseBuf: Buffer;
    let baseSource: 'existing' | 'generated';
    let baseArtifactId: string | null = null;
    if (input.image) {
      baseBuf = (await loadImageFile(input.image)).buffer;
      baseSource = 'existing';
      baseArtifactId = input.image;
    } else {
      const size = pickGenSize(input.width, input.height);
      const { buffer } = await generateImageBuffer(input.basePrompt!.trim(), size);
      baseBuf = buffer;
      baseSource = 'generated';
    }
    const out = await composeTypography(baseBuf, {
      heading: input.heading,
      subheading: input.subheading,
      theme: input.theme,
    });
    const { meta, width, height } = await saveImageArtifact(ctx, out, {
      metaJson: {
        operation: 'compose_text',
        heading: input.heading,
        theme: input.theme,
        baseSource,
        ...(baseArtifactId ? { sourceArtifactId: baseArtifactId } : {}),
        ...(input.basePrompt ? { basePrompt: input.basePrompt.slice(0, 500) } : {}),
      },
    });
    return {
      summary: `টাইপোগ্রাফি সম্পন্ন: ${truncate(input.heading, 50)} (${width}x${height})`,
      resultJson: JSON.stringify({
        artifactId: meta.id,
        baseArtifactId,
        baseSource,
        heading: input.heading,
        theme: input.theme,
        dimensions: `${width}x${height}`,
      }),
      artifacts: [meta],
    };
  },
};

// ------------------------------------------------------------
// ১০. export_image — ফরম্যাট রপ্তানি
// ------------------------------------------------------------

const MIME_BY_FORMAT: Record<'png' | 'jpeg' | 'webp', string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
const EXT_BY_FORMAT: Record<'png' | 'jpeg' | 'webp', string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
};

const exportImageSpec: ToolSpec<{
  image: string;
  format: 'png' | 'jpeg' | 'webp';
  quality: number;
  fileName?: string;
}> = {
  name: 'export_image',
  parameters: z.object({
    image: z.string().min(1).max(100),
    format: z.enum(['png', 'jpeg', 'webp']),
    quality: z.number().int().min(40).max(100).optional().default(90),
    fileName: z.string().min(1).max(120).optional(),
  }),
  timeoutMs: 60_000,
  usage:
    'export_image — PNG/JPEG/WebP ফরম্যাটে মানসম্মত রপ্তানি (নির্ধারণবাহী)। arguments: {"image": string (artifact আইডি), "format": "png"|"jpeg"|"webp", "quality"?: number (৪০–১০০, ডিফল্ট ৯০ — jpeg/webp-এ কার্যকর), "fileName"?: string (ঐচ্ছিক ফাইলনাম, এক্সটেনশন ছাড়া দিলে যোগ হয়)}',
  inputSummary: i => `→ ${i.format.toUpperCase()}${i.quality ? ` (কোয়ালিটি ${i.quality})` : ''}`,
  execute: async (input, ctx) => {
    const { buffer, fileName } = await loadImageFile(input.image);
    let pipe = sharp(buffer);
    if (input.format === 'jpeg') {
      pipe = pipe.flatten({ background: '#ffffff' }).jpeg({ quality: input.quality });
    } else if (input.format === 'webp') {
      pipe = pipe.webp({ quality: input.quality });
    } else {
      pipe = pipe.png();
    }
    const out = await pipe.toBuffer();
    if (!out || out.length === 0) throw new Error('রপ্তানি-রূপান্তর ব্যর্থ — খালি ফলাফল এসেছে');
    const ext = EXT_BY_FORMAT[input.format];
    let outName: string | undefined;
    if (input.fileName) {
      const clean = input.fileName
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[.-]+|[.-]+$/g, '')
        .slice(0, 80);
      if (clean) outName = /\.(png|jpe?g|webp)$/i.test(clean) ? clean : `${clean}.${ext}`;
    }
    const { meta, width, height } = await saveImageArtifact(ctx, out, {
      ext,
      mimeType: MIME_BY_FORMAT[input.format],
      fileName: outName,
      metaJson: {
        operation: 'export',
        format: input.format,
        quality: input.format === 'png' ? null : input.quality,
        sourceArtifactId: input.image,
        sourceFileName: fileName,
      },
    });
    return {
      summary: `${input.format.toUpperCase()} রপ্তানি সম্পন্ন (${width}x${height}, ${out.length} বাইট)`,
      resultJson: JSON.stringify({
        artifactId: meta.id,
        sourceArtifactId: input.image,
        format: input.format,
        quality: input.format === 'png' ? null : input.quality,
        bytes: out.length,
      }),
      artifacts: [meta],
    };
  },
};

// ------------------------------------------------------------
// ১১. inspect_image — গুণমান পরীক্ষা (artifact তৈরি হয় না)
// ------------------------------------------------------------

const inspectImageSpec: ToolSpec<{ image: string; question?: string }> = {
  name: 'inspect_image',
  parameters: z.object({
    image: z.string().min(1).max(100),
    question: z.string().max(600).optional(),
  }),
  timeoutMs: 120_000,
  usage:
    'inspect_image — ছবির গুণমান পরীক্ষা: মাত্রা/ফরম্যাট/সাইজ + VLM দিয়ে ঝাপসা-ভাব, নয়েজ, আলো ও কম্পোজিশন-রিপোর্ট। কোনো artifact তৈরি হয় না। arguments: {"image": string (artifact আইডি), "question"?: string (ঐচ্ছিক অতিরিক্ত প্রশ্ন)}',
  inputSummary: i => (i.question ? truncate(i.question, 80) : 'গুণমান পরীক্ষা'),
  execute: async input => {
    const src = await resolveImageSource(input.image);
    if (!src.width || !src.height) throw new Error('ছবির মাত্রা পড়া যায়নি — ফাইলটি সম্ভবত করাপ্ট');
    const question = input.question?.trim() ?? '';
    const vlmPrompt =
      `Analyze this image's technical quality in Bengali: sharpness, noise, lighting, composition issues. 2-3 short sentences.` +
      (question ? ` Then answer this briefly in Bengali: ${question}` : '');
    let assessment = '';
    try {
      assessment = await visionAnalyze(src.dataUrl, vlmPrompt);
    } catch {
      assessment = '';
    }
    if (!assessment) assessment = 'ভিশন-মূল্যায়ন এখন পাওয়া যায়নি — মেটাডেটা-অংশটি সঠিক।';
    const dims = `${src.width}x${src.height}`;
    return {
      summary: `মাত্রা: ${dims} · ${(src.format ?? '?').toUpperCase()} — ${truncate(assessment, 90)}`,
      resultJson: JSON.stringify({
        dimensions: dims,
        format: src.format ?? null,
        bytes: src.bytes,
        hasAlpha: src.hasAlpha ?? null,
        assessment,
        ...(question ? { question } : {}),
      }),
    };
  },
};

// ------------------------------------------------------------
// কেন্দ্রীয় তালিকা — registry.ts IMAGE_TOOLS হিসেবে ব্যবহার করে
// ------------------------------------------------------------

export const IMAGE_TOOLS: ToolSpec[] = [
  editImageSpec,
  inpaintImageSpec,
  removeBackgroundSpec,
  removeObjectSpec,
  restyleImageSpec,
  enhanceImageSpec,
  colorGradeImageSpec,
  transformImageSpec,
  composeTextImageSpec,
  exportImageSpec,
  inspectImageSpec,
];
