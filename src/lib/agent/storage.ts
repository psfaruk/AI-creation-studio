// ============================================================
// Artifact file storage — <projectRoot>/storage/artifacts/<name>.<ext>
// লোকাল ফাইল সিস্টেমে টুল-জেনারেটেড / ইউজার-আপলোড ফাইল সংরক্ষণ।
// ============================================================

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

const PROJECT_ROOT = process.cwd();
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'storage', 'artifacts');

export interface SavedArtifactFile {
  /** absolute on-disk path */
  storagePath: string;
  /** file name relative to the artifacts dir (used as fileName in DB) */
  relName: string;
}

/** Save a binary buffer as a new artifact file. Creates the dir if missing. */
export async function saveArtifactFile(buffer: Buffer, ext: string): Promise<SavedArtifactFile> {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  const relName = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.${safeExt}`;
  const storagePath = path.join(ARTIFACTS_DIR, relName);
  await writeFile(storagePath, buffer);
  return { storagePath, relName };
}

/** Read an artifact file from disk. Throws if the file is missing.
 * H-8 (পাথ-কন্টেইনমেন্ট): storagePath-অবশ্যই artifacts-ডিরেক্টরির
 * ভেতরে থাকতে হবে — DB-তে থাকা পথ যদি কখনো '../' বা absolute-পালায়নের
 * মাধ্যমে ডিরেক্টরির বাইরে নির্দেশ করে, সৎ ত্রুটির সাথে প্রত্যাখ্যাত
 * হয় (ENOENT-জাতীয় ফাইল-ত্রুটির চেয়ে আলাদা বার্তা)।
 *
 * `dir` প্যারামিটার (ঐচ্ছিক) শুধু টেস্টের জন্য — tmp-ডিরেক্টরিতে
 * কন্টেইনমেন্ট-চুক্তি প্রমাণ করতে; প্রোডাকশন-কলাররা ডিফল্ট
 * ARTIFACTS_DIR-ই ব্যবহার করে।
 */
export async function readArtifactFile(storagePath: string, dir: string = ARTIFACTS_DIR): Promise<Buffer> {
  const base = path.resolve(dir);
  const resolved = path.resolve(storagePath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error('আর্টিফ্যাক্ট-পথ সংরক্ষণ-ডিরেক্টরির বাইরে — প্রত্যাখ্যাত');
  }
  return readFile(resolved);
}

export function artifactsDir(): string {
  return ARTIFACTS_DIR;
}
