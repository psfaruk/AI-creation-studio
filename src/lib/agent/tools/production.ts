// ============================================================
// Production tools — propose_job (Creative Job Spec + নিশ্চিতকরণ,
// মাস্টার প্ল্যান পার্ট E) ও create_character (Character Bible §৯)।
// ============================================================

import { z } from 'zod';
import type { ArtifactMeta } from '@/lib/types';
import { db } from '@/lib/db';
import { validateSpec, summarizeSpec } from '../capabilities';
import { generateImageBuffer } from '../sdk-helpers';
import { saveArtifactFile } from '../storage';
import { toArtifactMeta } from '../serialize';
import type { ToolContext, ToolOutput, ToolSpec } from '../registry-helpers';
import { chatComplete } from '../llm';

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// ------------------------------------------------------------
// propose_job — বড়/দীর্ঘ কাজের আগে অবশ্যই নিশ্চিতকরণ (§১৩)
// ------------------------------------------------------------

const proposeJobSpec: ToolSpec<{
  spec: Record<string, unknown>;
  note?: string;
}> = {
  name: 'propose_job',
  parameters: z.object({
    spec: z.record(z.string(), z.unknown()),
    note: z.string().max(600).optional(),
  }),
  timeoutMs: 20_000,
  usage: 'propose_job — বড়/দীর্ঘ কাজের (মিউজিক ভিডিও, শর্টফিল্ম, মোশন ভিডিও, দীর্ঘ ভয়েসওভার) আগে সেটিংস-সহ নিশ্চিতকরণ কার্ড তৈরি করে — ব্যবহারকারী নিশ্চিত করলেই কাজ শুরু হয়। arguments: {"spec": {"type": "motion_video"|"music_video"|"short_film"|"audio"|"image", "title", "quality" ("draft"|"standard"|"high"), "idea"/"story"/"text", "durationSec", "aspect" ("9:16"|"16:9"|"1:1"|"4:5"|"3:2"), "fps" (24|25|30), "sound", "subtitles", "songArtifactId", "sourceArtifactId", "overlayText", "voice", "style"}, "note"?: string}',
  inputSummary: i => {
    const s = i.spec ?? {};
    return `${String(s.type ?? 'কাজ')}: ${truncate(String(s.title ?? s.idea ?? s.story ?? ''), 80)}`;
  },
  execute: async (input, ctx) => {
    const validation = validateSpec(input.spec);
    if (!validation.ok || !validation.validated) {
      const alt = validation.alternatives?.length ? ` বিকল্প: ${validation.alternatives.join('; ')}` : '';
      throw new Error(`স্পেক যাচাই ব্যর্থ: ${validation.errors.join('; ')}.${alt}`);
    }
    const caps = validation.validated;

    // --- অটো-ওয়্যার: মিউজিক ভিডিওতে গান আবার যুক্ত করা ---
    // LLM কখনো কখনো songArtifactId দিতে ভুলে যায় — কথোপকথনের
    // সর্বশেষ আপলোড করা অডিও থাকলে সেটিই spec-এ বসিয়ে দাও।
    if (caps.spec.type === 'music_video' && !caps.spec.songArtifactId) {
      const song = await db.artifact.findFirst({
        where: { conversationId: ctx.conversationId, kind: 'audio', origin: 'user_upload' },
        orderBy: { createdAt: 'desc' },
      });
      if (song) {
        caps.spec.songArtifactId = song.id;
        caps.spec.sound = 'uploaded_song';
        caps.notes = caps.notes.filter(n => !n.includes('আপলোড করা গান পাওয়া যায়নি'));
      }
    }
    // ছবি-ভিত্তিক কাজে সর্বশেষ আপলোড করা ছবি (sourceArtifactId না থাকলে)
    if (caps.spec.type === 'image' && !caps.spec.sourceArtifactId) {
      const img = await db.artifact.findFirst({
        where: { conversationId: ctx.conversationId, kind: 'image', origin: 'user_upload' },
        orderBy: { createdAt: 'desc' },
      });
      if (img) caps.spec.sourceArtifactId = img.id;
    }
    // image-to-video (animate_image) উৎস
    if (caps.spec.type === 'motion_video' && !caps.spec.sourceImageArtifactId) {
      const img = await db.artifact.findFirst({
        where: { conversationId: ctx.conversationId, kind: 'image', origin: 'user_upload' },
        orderBy: { createdAt: 'desc' },
      });
      if (img) caps.spec.sourceImageArtifactId = img.id;
    }

    const production = await db.production.create({
      data: {
        conversationId: ctx.conversationId,
        type: caps.spec.type,
        title: caps.spec.title,
        status: 'awaiting_confirmation',
        specJson: JSON.stringify(caps.spec),
      },
    });
    return {
      summary: `প্রস্তাব তৈরি: ${caps.spec.title} (${summarizeSpec(caps.spec)})`,
      resultJson: JSON.stringify({
        productionId: production.id,
        status: 'awaiting_confirmation',
        title: caps.spec.title,
        summary: summarizeSpec(caps.spec),
        adjustments: caps.adjustments,
        notes: caps.notes,
        steps: caps.plannedSteps.map(s => s.title),
        instruction:
          'এখন চ্যাটে সেটিংস-নিশ্চিতকরণ কার্ড দেখানো হয়েছে। ব্যবহারকারী "নিশ্চিত করুন" চাপলে কাজ শুরু হবে। চূড়ান্ত উত্তরে কার্ডটি দেখে নেওয়ার জন্য বলো এবং গুরুত্বপূর্ণ সেটিংস ও সীমাবদ্ধতা (notes) সংক্ষেপে জানাও।',
      }),
      artifacts: [],
    };
  },
};

// ------------------------------------------------------------
// create_character — Character Bible entry + reference portrait
// ------------------------------------------------------------

const createCharacterSpec: ToolSpec<{
  name: string;
  description: string;
  role?: string;
  voice?: string;
  language?: 'bn' | 'en';
  appearance?: string;
  style?: string;
}> = {
  name: 'create_character',
  parameters: z.object({
    name: z.string().min(1).max(80),
    description: z.string().min(5).max(1200),
    role: z.string().max(80).optional(),
    voice: z.string().max(20).optional(),
    language: z.enum(['bn', 'en']).optional(),
    appearance: z.string().max(600).optional(),
    style: z.string().max(300).optional(),
  }),
  timeoutMs: 200_000,
  usage:
    'create_character — চরিত্রের নাম ও বর্ণনা থেকে Character Bible এন্ট্রি + রেফারেন্স পোর্ট্রেট তৈরি করে (§৭.২: স্থায়ী character ID — পরবর্তী প্রোডাকশনে একই চরিত্র পুনর্ব্যবহারযোগ্য)। একই নামের চরিত্র আবার তৈরি করলে বিদ্যমান এন্ট্রি আপডেট হয়। arguments: {"name": string, "description": string (ব্যক্তিত্ব/পরিচয়), "role"?: string (যেমন "প্রধান চরিত্র"), "voice"?: string (বাংলা: jam/douji, ইংরেজি: jam/tongtong/kazi), "language"?: "bn"|"en", "appearance"?: string (বয়স/চুল/পোশাক), "style"?: string}',
  inputSummary: i => `${i.name}${i.role ? ` (${i.role})` : ''}`,
  execute: async (input, ctx) => {
    // পোর্ট্রেট-প্রম্পট প্রস্তুত (LLM দিয়ে ইংরেজি প্রম্পট)
    let prompt: string;
    try {
      prompt = (
        await chatComplete([
          {
            role: 'assistant',
            content:
              'তুমি একজন character designer। নিচের চরিত্রের বর্ণনা থেকে AI ইমেজ-জেনারেশনের জন্য একটি বিস্তারিত ইংরেজি portrait prompt লেখো (শুধু প্রম্পট, অন্য কিছু নয়)। চরিত্রের মুখ, চুল, পোশাক, বয়স, ধরন স্পষ্ট থাকবে; শৈলী: cinematic portrait, waist-up, neutral studio-like background, consistent character reference sheet style.',
          },
          {
            role: 'user',
            content: `নাম: ${input.name}\nবর্ণনা: ${input.description}${input.appearance ? `\nচেহারা: ${input.appearance}` : ''}${input.style ? `\nশৈলী: ${input.style}` : ''}`,
          },
        ])
      ).trim();
    } catch {
      prompt = `Cinematic portrait of a character named ${input.name}: ${input.description}. Waist-up, neutral background, character reference sheet style, consistent lighting.`;
    }
    prompt = prompt.slice(0, 1200);

    // §৭.২: বিদ্যমান চরিত্র হলে তার পুরনো পোর্ট্রেট রেফারেন্স হিসেবে ধরে পরিচয় ধরে রাখি
    const existing = await db.character.findUnique({
      where: { conversationId_name: { conversationId: ctx.conversationId, name: input.name } },
    });

    const { buffer } = await generateImageBuffer(prompt, '864x1152');
    const { storagePath } = await saveArtifactFile(buffer, 'png');
    const artifact = await db.artifact.create({
      data: {
        conversationId: ctx.conversationId,
        runId: ctx.runId,
        origin: 'tool',
        kind: 'image',
        mimeType: 'image/png',
        fileName: `character-${input.name.slice(0, 24)}.png`,
        size: buffer.length,
        storagePath,
        metaJson: JSON.stringify({ characterName: input.name, prompt, voice: input.voice ?? null }),
      },
    });
    const meta: ArtifactMeta = toArtifactMeta(artifact);

    // §৭.২: স্থায়ী Character Bible রেকর্ড (upsert — একই নামে আপডেট)
    const language = input.language ?? 'bn';
    const character = await db.character.upsert({
      where: { conversationId_name: { conversationId: ctx.conversationId, name: input.name } },
      create: {
        conversationId: ctx.conversationId,
        name: input.name,
        role: input.role ?? 'প্রধান চরিত্র',
        description: input.description,
        appearanceJson: JSON.stringify({ appearance: input.appearance ?? null, style: input.style ?? null }),
        language,
        voice: input.voice ?? (language === 'bn' ? 'jam' : 'jam'),
        portraitArtifactId: meta.id,
      },
      update: {
        role: input.role ?? undefined,
        description: input.description,
        appearanceJson: JSON.stringify({ appearance: input.appearance ?? null, style: input.style ?? null }),
        language,
        voice: input.voice ?? undefined,
        portraitArtifactId: meta.id,
      },
    });

    return {
      summary: `চরিত্র তৈরি: ${input.name}${existing ? ' (পুরনো এন্ট্রি আপডেট)' : ''} — Character Bible ID: ${character.id.slice(0, 12)}`,
      resultJson: JSON.stringify({
        characterId: character.id,
        characterName: input.name,
        description: input.description,
        voice: character.voice,
        language: character.language,
        portraitArtifactId: meta.id,
        prompt,
      }),
      artifacts: [meta],
    };
  },
};

export const PRODUCTION_TOOLS: ToolSpec[] = [proposeJobSpec, createCharacterSpec];
