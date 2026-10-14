// GET /api/conversations → ConversationSummary[] (updatedAt desc)
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/security';
import { db } from '@/lib/db';
import { sweepStaleRuns } from '@/lib/agent/orchestrator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  await sweepStaleRuns();
  const convs = await db.conversation.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { messages: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
    },
  });
  return NextResponse.json(
    convs.map(c => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt.toISOString(),
      lastMessageAt: (c.messages[0]?.createdAt ?? c.createdAt).toISOString(),
      messageCount: c._count.messages,
    }))
  );
}
