// POST /api/chat → ChatResponse { runId, conversationId, userMessage }
// রান ব্যাকগ্রাউন্ডে চলে (startAgentRun fire-and-forget)।
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/security';
import { db } from '@/lib/db';
import { startAgentRun, STALE_RUN_MS } from '@/lib/agent/orchestrator';
import { isValidChatModelId } from '@/lib/agent/chat-models';
import { buildMessageView, toAttachmentView } from '@/lib/agent/serialize';
import { saveArtifactFile } from '@/lib/agent/storage';
import { checkRateLimit, RATE_LIMITS } from '@/lib/limits';
import type { ChatMode } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** ক্লায়েন্ট শনাক্তকারী (গেটওয়ে-প্রক্সির পেছনে x-forwarded-for) */
function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : 'local').slice(0, 60);
}

const MAX_CONTENT = 8000;
const MAX_ATTACHMENTS = 4;
/** ~৭MB বাইনারি ≈ ৯.৫M base64 অক্ষর */
const MAX_BASE64_LEN = 9_500_000;
/** ভিডিও: ~২৫MB বাইনারি ≈ ৩৪M base64 অক্ষর */
const MAX_VIDEO_BASE64_LEN = 34_000_000;

interface IncomingAttachment {
  kind: 'image' | 'audio' | 'video';
  name: string;
  dataUrl: string;
}

function extFromMime(mime: string, name: string): string {
  const byMime: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-matroska': 'mkv',
  };
  if (byMime[mime]) return byMime[mime];
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  if (m) return m[1].toLowerCase();
  return 'bin';
}

export async function POST(req: Request) {
  // --- মালিক-সেশন (P0 নিরাপত্তা) ---
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  // --- রেট-লিমিট (§১১ নিরাপত্তা) ---
  const rl = checkRateLimit(`chat:${clientKey(req)}`, RATE_LIMITS.chat.limit, RATE_LIMITS.chat.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `অনেক দ্রুত বার্তা পাঠানো হচ্ছে — ${rl.retryAfterSec} সেকেন্ড পরে আবার চেষ্টা করুন` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec ?? 30) } }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'অনুরোধের বডি পড়া যায়নি (JSON হতে হবে)' }, { status: 400 });
  }

  const content = typeof body?.content === 'string' ? body.content : '';
  const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : '';
  const rawAttachments: any[] = Array.isArray(body?.attachments) ? body.attachments : [];
  const trimmed = content.trim();

  // চ্যাট-মডেল নির্বাচন ('' = SDK ডিফল্ট / ক্যাটালগের অনুমোদিত GLM-id;
  // অজানা/সরানো মান (deepseek-* / groq-* / or-* / custom:*) → স্পষ্ট 400)
  if (body?.model != null && !isValidChatModelId(body.model)) {
    return NextResponse.json(
      { error: 'অজানা চ্যাট-মডেল — মডেল-তালিকা সদ্যি বদলেছে (এখন শুধু GLM); মডেল-সিলেক্টর থেকে আবার বেছে নিন' },
      { status: 400 }
    );
  }
  const chatModel = typeof body?.model === 'string' ? body.model : '';

  // রান-মোড যাচাই (অডিট §১-A): normal | chat_only | diagnostic —
  // অজানা/অনুপস্থিত মান 'normal'; ডাক্তার না থাকলে 400।
  const CHAT_MODES: ChatMode[] = ['normal', 'chat_only', 'diagnostic'];
  const rawMode = body?.mode;
  if (rawMode != null && typeof rawMode !== 'string') {
    return NextResponse.json({ error: 'মোড মান সঠিক নয়' }, { status: 400 });
  }
  if (typeof rawMode === 'string' && rawMode !== '' && !CHAT_MODES.includes(rawMode as ChatMode)) {
    return NextResponse.json(
      { error: 'অজানা মোড — normal / chat_only / diagnostic এর একটি হতে হবে' },
      { status: 400 }
    );
  }
  const chatMode: ChatMode =
    rawMode === 'chat_only' || rawMode === 'diagnostic' ? rawMode : 'normal';

  if (trimmed.length > MAX_CONTENT) {
    return NextResponse.json({ error: 'বার্তা সর্বোচ্চ ৮০০০ অক্ষরের হতে পারে' }, { status: 400 });
  }
  if (!trimmed && rawAttachments.length === 0) {
    return NextResponse.json({ error: 'বার্তা খালি রাখা যাবে না' }, { status: 400 });
  }
  if (rawAttachments.length > MAX_ATTACHMENTS) {
    return NextResponse.json({ error: `একবারে সর্বোচ্চ ${MAX_ATTACHMENTS} টি অ্যাটাচমেন্ট` }, { status: 400 });
  }

  const attachments: IncomingAttachment[] = [];
  for (const a of rawAttachments) {
    if (
      (a?.kind !== 'image' && a?.kind !== 'audio' && a?.kind !== 'video') ||
      typeof a?.name !== 'string' ||
      typeof a?.dataUrl !== 'string'
    ) {
      return NextResponse.json({ error: 'অ্যাটাচমেন্টের তথ্য সঠিক নয়' }, { status: 400 });
    }
    const match = /^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(a.dataUrl);
    if (!match) {
      return NextResponse.json({ error: 'অ্যাটাচমেন্টের dataUrl ফরম্যাট সঠিক নয়' }, { status: 400 });
    }
    const limit = a.kind === 'video' ? MAX_VIDEO_BASE64_LEN : MAX_BASE64_LEN;
    const limitLabel = a.kind === 'video' ? '~২৫MB' : a.kind === 'image' ? '~৭MB' : '~৭MB';
    if (match[2].length > limit) {
      return NextResponse.json({ error: `অ্যাটাচমেন্ট খুব বড় (সর্বোচ্চ ${limitLabel})` }, { status: 400 });
    }
    attachments.push({ kind: a.kind, name: a.name.slice(0, 200), dataUrl: a.dataUrl });
  }

  // conversation রিজলভ / তৈরি
  let conversation = null as { id: string } | null;
  if (conversationId) {
    conversation = await db.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) {
      return NextResponse.json({ error: 'কথোপকথন খুঁজে পাওয়া যায়নি' }, { status: 404 });
    }
  } else {
    conversation = await db.conversation.create({ data: {} });
  }

  // P0-BUG-03/REG-3 সমাধান (Phase 2): এই কথোপকথনে এখনো একটি রান `running`
  // থাকলে নতুন জমা প্রত্যাখ্যান (409) — ডুপ্লিকেট সমান্তরাল রান নয়।
  // বডিতে activeRunId দেওয়া হয় যেন ক্লায়েন্ট নতুন রান না খুলে চলমান
  // রানেই পুনঃসংযোগ করতে পারে (use-agent-run-এর রি-অ্যাটাচ পথ)।
  // গার্ড ইউজার-বার্তা তৈরির আগেই — প্রত্যাখ্যাত জমা কথোপকথন দূষিত করে না।
  const activeRun = await db.agentRun.findFirst({
    where: { conversationId: conversation.id, status: 'running' },
    orderBy: { startedAt: 'desc' },
  });
  if (activeRun) {
    // (A1-F01, P2) জম্বি-রান গার্ড: সার্ভার-মৃত্যুতে (crash/OOM/kill) রো
    // 'running'-ই আটকে থাকে — sweepStaleRuns কেবল GET /api/conversations-এ
    // ডাকা হত, তাই একটিই খোলা ট্যাবে ব্যবহারকারী ~১০ মিনিট পর্যন্ত 409-এ
    // বন্ধ থাকত। এখন সেন্ড-পথেই একই স্টেলনেস-সীমা (orchestrator-এর
    // STALE_RUN_MS) প্রয়োগ করে স্পষ্টতই মৃত রান সৎভাবে 'interrupted'
    // করা হয় (sweepStaleRuns-এর আপডেট-আকারেই) এবং নতুন রানের পথ খোলে।
    if (Date.now() - activeRun.startedAt.getTime() > STALE_RUN_MS) {
      await db.agentRun
        .update({
          where: { id: activeRun.id },
          data: {
            status: 'interrupted',
            error: 'রানটি অসম্পূর্ণ অবস্থায় আটকে গিয়েছিল (stale sweep)',
            endReason: 'timeout',
            errorCategory: 'timeout',
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
    } else {
      return NextResponse.json(
        {
          error: 'এই কথোপকথনে একটি উত্তর এখনো তৈরি হচ্ছে — সেটি সম্পূর্ণ হওয়া পর্যন্ত অপেক্ষা করুন',
          activeRunId: activeRun.id,
          conversationId: conversation.id,
        },
        { status: 409 }
      );
    }
  }

  // ইউজার বার্তা তৈরি
  const userMessage = await db.message.create({
    data: { conversationId: conversation.id, role: 'user', content },
  });

  // প্রথম ইউজার বার্তা হলে শিরোনাম সেট (৪২ অক্ষর)
  const userCount = await db.message.count({
    where: { conversationId: conversation.id, role: 'user' },
  });
  if (userCount <= 1) {
    const flat = trimmed.replace(/\s+/g, ' ');
    const title = flat.slice(0, 42) + (flat.length > 42 ? '…' : '');
    await db.conversation.update({ where: { id: conversation.id }, data: { title } });
  } else {
    await db.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
  }

  // অ্যাটাচমেন্ট ফাইল → artifact rows (origin 'user_upload', message-এর সাথে লিংকড)
  const attachmentViews: { kind: 'image' | 'audio' | 'video'; name: string; url: string }[] = [];
  for (const att of attachments) {
    const b64 = att.dataUrl.slice(att.dataUrl.indexOf(',') + 1).replace(/\s+/g, '');
    const buf = Buffer.from(b64, 'base64');
    const mime = /^data:([^;]+);/.exec(att.dataUrl)?.[1] ?? (att.kind === 'image' ? 'image/png' : att.kind === 'video' ? 'video/mp4' : 'audio/mpeg');
    const ext = extFromMime(mime, att.name);
    const { storagePath } = await saveArtifactFile(buf, ext);
    const artifact = await db.artifact.create({
      data: {
        conversationId: conversation.id,
        runId: null,
        messageId: userMessage.id,
        origin: 'user_upload',
        kind: att.kind,
        mimeType: mime,
        fileName: att.name || `upload.${ext}`,
        size: buf.length,
        storagePath,
      },
    });
    attachmentViews.push(toAttachmentView(artifact));
  }
  if (attachmentViews.length > 0) {
    await db.message.update({
      where: { id: userMessage.id },
      data: { attachmentsJson: JSON.stringify(attachmentViews) },
    });
  }

  // এজেন্ট রান তৈরি ও ব্যাকগ্রাউন্ডে চালু (নির্বাচিত মডেল + অনুরোধকৃত মোডসহ)
  const run = await db.agentRun.create({
    data: {
      conversationId: conversation.id,
      status: 'running',
      ...(chatModel ? { model: chatModel } : {}),
      ...(chatMode !== 'normal' ? { requestedMode: chatMode } : {}),
    },
  });

  const view = await buildMessageView(userMessage);
  startAgentRun(run.id);

  return NextResponse.json({
    runId: run.id,
    conversationId: conversation.id,
    userMessage: view,
  });
}
