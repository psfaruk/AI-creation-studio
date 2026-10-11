// GET /api/tools → ToolInfo[] (TOOL_CATALOG)
import { NextResponse } from 'next/server';
import { TOOL_CATALOG } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(TOOL_CATALOG);
}
