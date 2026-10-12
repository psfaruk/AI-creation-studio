// ============================================================
// Production creation — শেয়ার্ড একমাত্র সত্যের পথ (S9)।
//
// তিনটি কলার একই যুক্তি ব্যবহার করে:
//  ১. propose_job টুল (চ্যাট-এজেন্ট)
//  ২. POST /api/productions (স্টুডিও UI থেকে সরাসরি তৈরি —
//     LLM রেট-লিমিটেড হলেও কাজ চালু করা যায়)
//  ৩. orchestrator-এর নিয়ম-ভিত্তিক ইন্টেন্ট-ফলব্যাক
//
// দায়িত্ব: validateSpec → অটো-ওয়্যার (আপলোড থেকে গান/ছবি) →
// Production row (awaiting_confirmation) → ফেরত।
// ============================================================

import type { CreativeJobSpec, ValidatedSpec } from '@/lib/types';
import { db } from '@/lib/db';
import { validateSpec } from '../capabilities';

export type CreateProductionResult =
  | {
      ok: true;
      productionId: string;
      spec: CreativeJobSpec;
      caps: ValidatedSpec;
    }
  | {
      ok: false;
      errors: string[];
      alternatives?: string[];
    };

/**
 * যাচাই-সহ প্রোডাকশন তৈরি (awaiting_confirmation অবস্থায়)।
 * conversationId প্রয়োজন — artifact/কার্ড ওই কথোপকথনের সাথে লাগবে।
 */
export async function createProduction(
  rawSpec: unknown,
  conversationId: string
): Promise<CreateProductionResult> {
  const validation = validateSpec(rawSpec);
  if (!validation.ok || !validation.validated) {
    return {
      ok: false,
      errors: validation.errors,
      ...(validation.alternatives?.length ? { alternatives: validation.alternatives } : {}),
    };
  }
  const caps = validation.validated;

  // --- অটো-ওয়্যার: মিউজিক ভিডিওতে গান আবার যুক্ত করা ---
  // LLM কখনো কখনো songArtifactId দিতে ভুলে যায় — কথোপকথনের
  // সর্বশেষ আপলোড করা অডিও থাকলে সেটিই spec-এ বসিয়ে দাও।
  if (caps.spec.type === 'music_video' && !caps.spec.songArtifactId) {
    const song = await db.artifact.findFirst({
      where: { conversationId, kind: 'audio', origin: 'user_upload' },
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
      where: { conversationId, kind: 'image', origin: 'user_upload' },
      orderBy: { createdAt: 'desc' },
    });
    if (img) caps.spec.sourceArtifactId = img.id;
  }
  // image-to-video (animate_image) উৎস
  if (caps.spec.type === 'motion_video' && !caps.spec.sourceImageArtifactId) {
    const img = await db.artifact.findFirst({
      where: { conversationId, kind: 'image', origin: 'user_upload' },
      orderBy: { createdAt: 'desc' },
    });
    if (img) caps.spec.sourceImageArtifactId = img.id;
  }

  const production = await db.production.create({
    data: {
      conversationId,
      type: caps.spec.type,
      title: caps.spec.title,
      status: 'awaiting_confirmation',
      specJson: JSON.stringify(caps.spec),
    },
  });
  return { ok: true, productionId: production.id, spec: caps.spec, caps };
}
