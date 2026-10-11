// ============================================================
// Image pipeline — মাস্টার প্ল্যান §৩ (Image Studio production)
// ধাপ: prepare (উৎস/নির্দেশনা) → generate (AI জেনারেশন/এডিট বা
// উৎস সরাসরি) → overlay (ঐচ্ছিক বাংলা টাইপোগ্রাফি) → validate
// (মাত্রা-ফরম্যাট যাচাই + রপ্তানি)। compose_text_image-র সমান
// টাইপোগ্রাফি-সিস্টেম ব্যবহার করে (tools/image.ts থেকে শেয়ারড)।
// ============================================================

import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import type { CreativeJobSpec } from '@/lib/types';
import { ASPECT_TO_GEN_SIZE } from '../../capabilities';
import { artifactFilePath } from '../../registry-helpers';
import { editImageBuffer, generateImageBuffer, visionAnalyze } from '../../sdk-helpers';
import { chatComplete } from '../../llm';
import { composeTypography } from '../../tools/image';
import type { PipelineFn } from '../runner';

const BENGALI_RE = /[\u0980-\u09FF]/;

function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/g, '');
  return s || 'creative';
}

/** নির্দেশনা (বাংলা হলে ইংরেজিতে অনুবাদ-সহ) → সুনির্দিষ্ট ইমেজ-প্রম্পট (best-effort) */
async function planPrompt(raw: string): Promise<string> {
  try {
    const out = await chatComplete([
      {
        role: 'assistant',
        content:
          'তুমি একজন AI image-prompt engineer। নিচের নির্দেশনাকে (বাংলা হলে ইংরেজিতে অনুবাদ করে) একটি বিস্তারিত, সুনির্দিষ্ট ইংরেজি image prompt-এ রূপ পরিণত করো — শুধু প্রম্পট-টেক্সট দাও, কোনো ব্যাখ্যা/উদ্ধৃতি চিহ্ন নয়, ৮০০ অক্ষরের মধ্যে।',
      },
      { role: 'user', content: raw.slice(0, 900) },
    ]);
    const cleaned = out.trim().replace(/^["'\s]+|["'\s]+$/g, '');
    if (cleaned.length > 10) return cleaned.slice(0, 900);
  } catch {
    // অনুবাদ/পরিকল্পনা ব্যর্থ → মূল টেক্সটই ব্যবহার
  }
  return raw.slice(0, 900) || 'creative image, high quality, detailed';
}

export const imagePipeline: PipelineFn = async ctx => {
  const spec: CreativeJobSpec = ctx.spec;
  const aspect = spec.aspect ?? '1:1';
  const genSize = ASPECT_TO_GEN_SIZE[aspect];
  const slug = slugify(spec.title || 'image');

  // ---------- ১. prepare: উৎস-ছবি ও নির্দেশনা-পরিকল্পনা ----------
  const prepared = await ctx.runStep('prepare', 'উৎস প্রস্তুত ও নির্দেশনা বিশ্লেষণ', async step => {
    const hasSource = Boolean(spec.sourceArtifactId);
    const instructions = spec.instructions?.trim() ?? '';
    const style = spec.style?.trim() ?? '';
    if (!hasSource && !instructions) {
      throw new Error(
        'ছবি প্রোডাকশনের জন্য নির্দেশনা (instructions) অথবা উৎস-ছবি (sourceArtifactId) — অন্তত একটি প্রয়োজন।'
      );
    }

    let sourceBuffer: Buffer | null = null;
    let sourceDataUrl = '';
    let vlmContext = '';

    if (hasSource) {
      const file = await artifactFilePath(spec.sourceArtifactId!);
      if (file.kind !== 'image') throw new Error('উৎস-artifact টি ছবি নয় — ছবির artifact আইডি দাও।');
      sourceBuffer = await readFile(file.path);
      const meta = await sharp(sourceBuffer).metadata();
      if (!meta.width || !meta.height) {
        throw new Error('উৎস-ছবির মাত্রা পড়া যায়নি — ফাইলটি সম্ভবত করাপ্ট।');
      }
      sourceDataUrl = `data:${file.mimeType};base64,${sourceBuffer.toString('base64')}`;
      await step.setDetail(`উৎস-ছবি: ${file.fileName} (${meta.width}x${meta.height})`);
      // 'high' মানে এডিটকে বিষয়বস্তু-প্রসঙ্গ দিই (VLM, best-effort — ব্যর্থ হলে চলতে থাকে)
      if (spec.quality === 'high' && (instructions || style)) {
        try {
          vlmContext = await visionAnalyze(
            sourceDataUrl,
            'Describe the main subject, setting and current style of this image in one short English sentence.'
          );
        } catch {
          vlmContext = '';
        }
      }
    }

    // মোড নির্ধারণ + প্রম্পট পরিকল্পনা
    let mode: 'edit' | 'generate' | 'passthrough';
    let prompt = '';
    if (instructions || style) {
      const raw = [instructions, style ? `Overall visual style: ${style}` : ''].filter(Boolean).join('. ');
      // বাংলা নির্দেশনা → ইংরেজি প্রম্পট-পরিকল্পনা; ইংরেজি হলে যথাযথ ব্যবহার
      prompt = BENGALI_RE.test(raw) ? await planPrompt(raw) : raw;
    }
    if (hasSource) {
      mode = instructions || style ? 'edit' : 'passthrough';
      if (mode === 'edit' && vlmContext) prompt = `The image currently shows: ${vlmContext}. Modify it as follows: ${prompt}`;
    } else {
      mode = 'generate';
      if (!prompt) prompt = await planPrompt(instructions || 'creative image');
    }
    if (mode === 'generate') await step.setDetail('জেনারেশন-প্রম্পট প্রস্তুত');
    return { sourceBuffer, sourceDataUrl, prompt, mode };
  });

  // ---------- ২. generate: AI জেনারেশন/এডিট বা উৎস সরাসরি ----------
  const generated = await ctx.runStep('generate', 'ছবি তৈরি/সম্পাদনা', async step => {
    let buffer: Buffer;
    let source: 'generated' | 'edited';
    if (prepared.mode === 'edit') {
      await step.setDetail('AI এডিট-মডেল দিয়ে সম্পাদনা হচ্ছে…');
      const editPrompt = `${prepared.prompt}, keep unmentioned parts unchanged, maintain overall composition`;
      const res = await editImageBuffer(prepared.sourceDataUrl, editPrompt, genSize);
      buffer = res.buffer;
      source = 'edited';
    } else if (prepared.mode === 'generate') {
      await step.setDetail(`AI দিয়ে নতুন ছবি আঁকা হচ্ছে (${genSize})…`);
      const res = await generateImageBuffer(prepared.prompt, genSize);
      buffer = res.buffer;
      source = 'generated';
    } else {
      await step.setDetail('উৎস-ছবি সরাসরি ব্যবহার করা হচ্ছে (AI-সম্পাদনা নেই)…');
      buffer = prepared.sourceBuffer!;
      source = 'edited';
      // অনুরোধ-করা অনুপাতে না মিললে cover-crop করে মানানসই করা
      const [gw, gh] = genSize.split('x').map(Number);
      const m = await sharp(buffer).metadata();
      if (m.width && m.height && Math.abs(m.width / m.height - gw / gh) > 0.02) {
        buffer = await sharp(buffer).resize({ width: gw, height: gh, fit: 'cover' }).png().toBuffer();
      }
    }
    // ইন্টারমিডিয়েট (PNG-নরমালাইজড) ওয়ার্কিং-ডিরেক্টরিতে সংরক্ষণ
    const basePng = await sharp(buffer).png().toBuffer();
    await writeFile(path.join(ctx.workingDir, 'base.png'), basePng);
    return { basePng, source };
  });

  // ---------- ৩. overlay: ঐচ্ছিক বাংলা টাইপোগ্রাফি ----------
  let finalPng = generated.basePng;
  let overlaid = false;
  const overlayHeading = spec.overlayText?.trim().slice(0, 80) ?? '';
  if (overlayHeading) {
    await ctx.runStep('overlay', 'টাইপোগ্রাফি ও ফিনিশিং', async step => {
      await step.setDetail('বাংলা টাইপোগ্রাফি বসানো হচ্ছে…');
      finalPng = await composeTypography(generated.basePng, { heading: overlayHeading, theme: 'dark' });
      overlaid = true;
    });
  }

  // ---------- ৪. validate: মাত্রা-ফরম্যাট যাচাই + রপ্তানি ----------
  const final = await ctx.runStep('validate', 'গুণমান যাচাই ও রপ্তানি', async step => {
    await step.setDetail('মাত্রা ও ফরম্যাট যাচাই হচ্ছে…');
    if (!finalPng || finalPng.length === 0) throw new Error('চূড়ান্ত ছবির ডেটা খালি — রপ্তানি ব্যর্থ।');
    const meta = await sharp(finalPng).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w <= 0 || h <= 0) throw new Error('চূড়ান্ত ছবির মাত্রা অবৈধ — রপ্তানি ব্যর্থ।');
    if (!meta.format) throw new Error('চূড়ান্ত ছবির ফরম্যাট শনাক্ত হয়নি — রপ্তানি ব্যর্থ।');

    const dims = `${w}x${h}`;
    const source = generated.source;
    let artifactCount = 0;

    // ওভারলে হয়ে থাকলে ওভারলে-পূর্ববর্তী ভার্সনটিও দাও (চূড়ান্ত রপ্তানির আগেই নিবন্ধন)
    if (overlaid) {
      const baseMeta = await sharp(generated.basePng).metadata();
      await ctx.registerArtifact({
        buffer: generated.basePng,
        kind: 'image',
        mimeType: 'image/png',
        fileName: `image-${slug}-base.png`,
        metaJson: {
          dimensions: `${baseMeta.width ?? 0}x${baseMeta.height ?? 0}`,
          source,
          note: 'টাইপোগ্রাফি-পূর্ববর্তী ভার্সন',
        },
      });
      artifactCount++;
    }

    // চূড়ান্ত রপ্তানি (jpeg/webp-এ কোয়ালিটি ৯২)
    const format = spec.format ?? 'png';
    let outBuf: Buffer;
    let mimeType: string;
    let ext: string;
    if (format === 'jpeg') {
      outBuf = await sharp(finalPng).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
      mimeType = 'image/jpeg';
      ext = 'jpg';
    } else if (format === 'webp') {
      outBuf = await sharp(finalPng).webp({ quality: 92 }).toBuffer();
      mimeType = 'image/webp';
      ext = 'webp';
    } else {
      outBuf = finalPng;
      mimeType = 'image/png';
      ext = 'png';
    }
    await step.setDetail(`রপ্তানি হচ্ছে: ${format.toUpperCase()}…`);
    await ctx.registerArtifact({
      buffer: outBuf,
      kind: 'image',
      mimeType,
      fileName: `image-${slug}.${ext}`,
      metaJson: { dimensions: dims, source },
    });
    artifactCount++;

    const formatLabel = format === 'jpeg' ? 'JPEG' : format === 'webp' ? 'WebP' : 'PNG';
    return { dims, formatLabel, artifactCount };
  });

  return {
    result: {
      quality: `মাত্রা: ${final.dims} · ফরম্যাট: ${final.formatLabel}`,
      artifactCount: final.artifactCount,
    },
  };
};
