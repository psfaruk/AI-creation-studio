// GET /api — রুট হেলথ-চেক (মালিক-সেশনের পেছনে — P0 নিরাপত্তা)

import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  return NextResponse.json({ message: 'Hello, world!' });
}
