// ============================================================
// মিডিয়া ম্যাজিক-বাইট শনাক্তকারী (H-3) — entry-time sniffing।
//
// সমস্যা: চ্যাট-আপলোডে MIME কেবল ক্লায়েন্ট-ঘোষণার dataUrl-প্রিফিক্স
// থেকেই বিশ্বাস করা হতো — ভুল-লেবেল করা বাইনারি ভুল ধরনের আর্টিফ্যাক্ট
// হয়ে যেত। এই মডিউল ফাইলের প্রথম বাইটগুলো দেখে প্রকৃত ফরম্যাট
// শনাক্ত করে, আর attachmentMismatchError() ঘোষিত ধরনের সাথে মেলায়।
//
// সমর্থিত পরিবার (ঘোষিত ধরন ↔ শনাক্ত পরিবারের মিল বাধ্য):
//   audio → wav / mp3 / ogg ;  video → mp4 ;  image → png/jpeg/gif/webp
// zip ও অচেনা বাইট-স্বভাব মিডিয়া হিসেবে গ্রহণযোগ্য নয় (kind-safety)।
// ============================================================

/** শনাক্তকৃত ফরম্যাট-কুঞ্জী। */
export type SniffedMediaKind =
  | 'wav'
  | 'mp3'
  | 'ogg'
  | 'mp4'
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'zip'
  | 'unknown';

/** চ্যাট-অ্যাটাচমেন্টের ঘোষিত ধরণ-এনাম (kind)। */
export type AttachmentKind = 'image' | 'audio' | 'video';

/** bytes-এর offset-থেকে ascii স্ট্রিং আছে কি না (প্রথম-বাইট তুলনা)। */
function hasAscii(bytes: Uint8Array, offset: number, ascii: string): boolean {
  if (bytes.length < offset + ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * ম্যাজিক-বাইট শনাক্তকরণ:
 *  - `RIFF....WAVE` → wav ; `RIFF....WEBP` → webp
 *  - `ID3` বা 0xFF 0xFB / 0xFF 0xF3 / 0xFF 0xF2 → mp3
 *  - `OggS` → ogg ; offset-4-এ `ftyp` → mp4
 *  - `\x89PNG` → png ; `\xFF\xD8\xFF` → jpeg
 *  - `GIF87a` / `GIF89a` → gif ; `PK\x03\x04` → zip
 *  - অন্য কিছু হলে → unknown (সৎ-অজানা, কখনো 'probably-png' জাতীয়
 *    অনুমান নয়)
 */
export function sniffMediaKind(bytes: Uint8Array): SniffedMediaKind {
  // RIFF-কন্টেইনার: ফরম্যাট-ট্যাগ offset 8-এ
  if (hasAscii(bytes, 0, 'RIFF')) {
    if (hasAscii(bytes, 8, 'WAVE')) return 'wav';
    if (hasAscii(bytes, 8, 'WEBP')) return 'webp';
  }
  // MP3: ID3-হেডার বা MPEG-audio ফ্রেম-সিঙ্ক
  if (hasAscii(bytes, 0, 'ID3')) return 'mp3';
  if (
    bytes.length >= 2 &&
    bytes[0] === 0xff &&
    (bytes[1] === 0xfb || bytes[1] === 0xf3 || bytes[1] === 0xf2)
  ) {
    return 'mp3';
  }
  if (hasAscii(bytes, 0, 'OggS')) return 'ogg';
  // ISO বেস-মিডিয়া (MP4): offset 4-এ 'ftyp' ব্র্যান্ড-বক্স
  if (hasAscii(bytes, 4, 'ftyp')) return 'mp4';
  if (bytes.length >= 4 && bytes[0] === 0x89 && hasAscii(bytes, 1, 'PNG')) return 'png';
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'jpeg';
  }
  if (hasAscii(bytes, 0, 'GIF87a') || hasAscii(bytes, 0, 'GIF89a')) return 'gif';
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return 'zip';
  }
  return 'unknown';
}

/**
 * শনাক্ত কুঞ্জী → প্রত্যাশিত ঘোষিত ধরন-পরিবার।
 * null মানে এই বাইট-স্বভাব কোনো মিডিয়া অ্যাটাচমেন্ট হতে পারে না।
 */
export const SNIFFED_KIND_FAMILY: Record<SniffedMediaKind, AttachmentKind | null> = {
  wav: 'audio',
  mp3: 'audio',
  ogg: 'audio',
  mp4: 'video',
  png: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  zip: null,
  unknown: null,
};

/** ঘোষিত-ধরন-বনাম-বাইট-স্বভাব অমিলের ত্রুটি-বার্তা (রাউটের বাংলা স্টাইল)। */
export const ATTACHMENT_MISMATCH_ERROR = 'ফাইলের ঘোষিত ধরন ও প্রকৃত বাইট-স্বভাব মেলেনি';
export const ATTACHMENT_ZIP_ERROR =
  'ফাইলটি ZIP আর্কাইভ — মিডিয়া অ্যাটাচমেন্ট হিসেবে গ্রহণযোগ্য নয়';
export const ATTACHMENT_UNKNOWN_ERROR =
  'ফাইলের প্রকৃত বাইট-স্বভাব চেনা যায়নি — সমর্থিত: ছবি (PNG/JPEG/GIF/WebP), অডিও (WAV/MP3/OGG), ভিডিও (MP4)';

/**
 * এন্ট্রি-টাইম যাচাই (H-3): ডিকোড করা বাইটের ম্যাজিক-স্বভাব ঘোষিত
 * kind-এনাম ও ঘোষিত MIME-পরিবারের সাথে মেলে কি না।
 *
 * @returns null = সঙ্গত; না হলে বাংলা ত্রুটি-বার্তা (400-পাঠানোর মতো)।
 *
 * নিয়ম: zip/unknown কখনো মিডিয়া হিসেবে চলবে না; শনাক্ত পরিবার kind-এর
 * সাথে না মিললে প্রত্যাখ্যান; dataUrl-এ ঘোষিত media-পরিবার
 * (image/*, audio/*, video/*) শনাক্ত পরিবারের সাথে না মিললেও প্রত্যাখ্যান।
 */
export function attachmentMismatchError(
  kind: AttachmentKind,
  declaredMime: string,
  bytes: Uint8Array
): string | null {
  const sniffed = sniffMediaKind(bytes);
  const family = SNIFFED_KIND_FAMILY[sniffed];
  if (family === null) {
    if (sniffed === 'zip') return ATTACHMENT_ZIP_ERROR;
    return ATTACHMENT_UNKNOWN_ERROR;
  }
  if (family !== kind) return ATTACHMENT_MISMATCH_ERROR;
  const declaredFamily = declaredMime.split('/')[0];
  if (
    declaredFamily === 'image' ||
    declaredFamily === 'audio' ||
    declaredFamily === 'video'
  ) {
    if (declaredFamily !== family) return ATTACHMENT_MISMATCH_ERROR;
  }
  return null;
}
