// GET /api/auth/status — নিরাপত্তা-অবস্থা (কখনোই গেটেড নয়)
//   { initialized: boolean, authenticated: boolean }
//
// SecurityGate এটি দিয়ে ঠিক করে: setup ফর্ম / unlock ফর্ম / খোলা অ্যাপ।
// authenticated = অনুরোধে বৈধ মালিক-সেশন পাওয়া গেছে (cookie বা হেডার)।

import { NextResponse } from 'next/server';
import { isSessionValidForReq, securityInitialized } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const initialized = await securityInitialized();
  const authenticated = initialized ? await isSessionValidForReq(req) : false;
  return NextResponse.json(
    { initialized, authenticated },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
