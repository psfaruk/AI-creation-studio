// GET /api/tools → ToolInfo[] (TOOL_CATALOG)
// GET /api/tools?parity=1 → ToolParityReport (অডিট §৪-A: TOOLS↔CATALOG ড্রিফ্ট-চেক)
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/security';
import { TOOL_CATALOG } from '@/lib/types';
import { toolParityReport } from '@/lib/agent/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  if (url.searchParams.get('parity') === '1') {
    return NextResponse.json(toolParityReport(TOOL_CATALOG));
  }
  return NextResponse.json(TOOL_CATALOG);
}
