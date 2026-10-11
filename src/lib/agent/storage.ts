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

/** Read an artifact file from disk. Throws if the file is missing. */
export async function readArtifactFile(storagePath: string): Promise<Buffer> {
  return readFile(storagePath);
}

export function artifactsDir(): string {
  return ARTIFACTS_DIR;
}
