// GET /api/artifacts/[id]/file → লোকাল ফাইল stream (immutable cache)
//   বা external sourceUrl-এ 302 redirect। `?download=1` → attachment header।
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/security';
import { db } from '@/lib/db';
import { readArtifactFile } from '@/lib/agent/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // মিডিয়া-রুট (<img>/<audio>/<video> ট্যাগ) — কুকি ছাড়া ?st= টোকেনও চলে
  const auth = await requireOwner(req, { allowQueryToken: true });
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const artifact = await db.artifact.findUnique({ where: { id } });
  if (!artifact) {
    return NextResponse.json({ error: 'Artifact খুঁজে পাওয়া যায়নি' }, { status: 404 });
  }

  // এক্সটার্নাল (image-search) → redirect
  if (!artifact.storagePath && artifact.sourceUrl) {
    return NextResponse.redirect(artifact.sourceUrl, 302);
  }
  if (!artifact.storagePath) {
    return NextResponse.json({ error: 'এই artifact-এর কোনো ফাইল নেই' }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await readArtifactFile(artifact.storagePath);
  } catch {
    return NextResponse.json({ error: 'ফাইলটি ডিস্কে পাওয়া যায়নি' }, { status: 404 });
  }

  const headers = new Headers({
    'Content-Type': artifact.mimeType,
    'Content-Length': String(buffer.length),
    'Cache-Control': 'public, max-age=31536000, immutable',
  });

  const url = new URL(req.url);
  if (url.searchParams.get('download') === '1') {
    const fallback = artifact.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file';
    const encoded = encodeURIComponent(artifact.fileName);
    headers.set('Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`);
  }

  return new Response(new Uint8Array(buffer), { headers });
}
