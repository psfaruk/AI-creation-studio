// ============================================================
// DELETE /api/keys/[id] — কী বাতিল (revoke)
// ============================================================

import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/security';
import { revokeApiKey } from '@/lib/platform/api-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const ok = await revokeApiKey(id);
  if (!ok) {
    return NextResponse.json({ error: 'কী পাওয়া যায়নি বা ইতিমধ্যেই বাতিল' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
