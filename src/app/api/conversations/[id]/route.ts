// GET    /api/conversations/[id] → ConversationDetail
// DELETE /api/conversations/[id] → { ok: true } (cascade)
import { NextResponse } from 'next/server';
import { unlink } from 'fs/promises';
import { db } from '@/lib/db';
import { sweepStaleRuns } from '@/lib/agent/orchestrator';
import { buildMessageView } from '@/lib/agent/serialize';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await sweepStaleRuns();
  const conv = await db.conversation.findUnique({
    where: { id },
    include: { messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  });
  if (!conv) {
    return NextResponse.json({ error: 'কথোপকথন খুঁজে পাওয়া যায়নি' }, { status: 404 });
  }
  const messages = await Promise.all(conv.messages.map(m => buildMessageView(m)));
  const lastAt = conv.messages.length > 0 ? conv.messages[conv.messages.length - 1].createdAt : conv.createdAt;
  return NextResponse.json({
    conversation: {
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt.toISOString(),
      lastMessageAt: lastAt.toISOString(),
      messageCount: conv.messages.length,
    },
    messages,
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conv = await db.conversation.findUnique({ where: { id }, include: { artifacts: true } });
  if (!conv) {
    return NextResponse.json({ error: 'কথোপকথন খুঁজে পাওয়া যায়নি' }, { status: 404 });
  }
  // লোকাল artifact ফাইলগুলো best-effort মুছে দাও
  for (const a of conv.artifacts) {
    if (a.storagePath) {
      try {
        await unlink(a.storagePath);
      } catch {
        // ফাইল না থাকলে চুপচাপ এগিয়ে যাও
      }
    }
  }
  await db.conversation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
