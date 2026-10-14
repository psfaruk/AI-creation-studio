// GET /api/availability — Model & Tool Availability Matrix
// (নতুন মাস্টার প্ল্যান §১৫-এর প্রথম Deliverable)
// সব ক্ষমতার লাইসেন্স/প্রোভাইডার/ইন্টিগ্রেশন/রানটাইম চার-মাত্রার সৎ রায়।
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/security';
import { availabilityMatrixResponse } from '@/lib/agent/availability-matrix';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  return NextResponse.json(availabilityMatrixResponse());
}
