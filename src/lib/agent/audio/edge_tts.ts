// ============================================================
// Edge TTS — Microsoft Edge-র নিউরাল কণ্ঠ পরিষেবা (2026-10-13
// প্রোব-যাচাইকৃত প্রোটোকল)।
//
// কেন: z-ai SDK-র ৭টি কণ্ঠের কোনোটিই বাংলা-প্রশিক্ষিত নয় — বাংলা
// লেখা পড়লে "কোনো দেশি কথার" মতো শোনায় (ব্যবহারকারীর প্রত্যক্ষ
// অভিজ্ঞতা)। Microsoft-এর bn-BD নিউরাল কণ্ঠ (নবনীতা/প্রদীপ) সত্যিই
// বাংলা-প্রশিক্ষিত — উচ্চারণ দেশীয়।
//
// প্রোটোকল-আবিষ্কার (এই সেশনের প্রোব-ফলাফল):
//  - WSS URL-এ Sec-MS-GEC + Version *কুয়েরিতেই* লাগে (শুধু হেডারে
//    দিলে ৪০৩) — python edge-tts 7.2.8-এর আচরণ অনুসরণে ধরা পড়েছে
//  - হেডারে Cookie: muid=<32hex> দরকার
//  - GEC = SHA256((unixEpoch + 11644473600, ৫-মিনিটে ফ্লোর) × 1e7
//    + TRUSTED_CLIENT_TOKEN) — বড়-হাতের হেক্স
//  - বাইনারি বার্তা: হেডার-অংশ "\r\nPath:audio\r\n" (১৪ বাইট)-এর
//    পরেই MP3 ডেটা
//  - আউটপুট: audio-24khz-48kbitrate-mono-mp3 (CBR — সরাসরি কনক্যাট-নিরাপদ)
//  - গতি: প্রতি বাক্য ~১ সেকেন্ড (z-ai TTS-এর চেয়ে অনেক দ্রুত)
//  - Bun + ws প্যাকেজে সফল (node-ও সফল); Bun-এর native WebSocket
//    কাস্টম-হেডার পাঠায় না — তাই 'ws' ব্যবহার বাধ্যতামূলক
//
// সততা: এটি প্রকৃত Microsoft নিউরাল কণ্ঠ — লেবেলে তা-ই বলা হয়।
// ============================================================

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

export const EDGE_TTS_LABEL = 'Microsoft Edge নিউরাল TTS (bn-BD সহ)';
export const EDGE_TTS_PROVIDER = 'microsoft-edge-neural';

// ------------------------------------------------------------
// কণ্ঠ-রেজিস্ট্রি — প্রকৃত বাংলা + ইংরেজি নিউরাল কণ্ঠ
// ------------------------------------------------------------

export interface EdgeVoiceInfo {
  id: string;
  labelBn: string;
  language: 'bn' | 'en';
  gender: 'female' | 'male';
  locale: string;
  noteBn: string;
}

export const EDGE_VOICES: EdgeVoiceInfo[] = [
  {
    id: 'bn-BD-NabanitaNeural',
    labelBn: 'নবনীতা (বাংলা, বাংলাদেশ)',
    language: 'bn',
    gender: 'female',
    locale: 'bn-BD',
    noteBn: 'বাংলা-প্রশিক্ষিত নিউরাল কণ্ঠ — দেশীয় উচ্চারণ (নারী)',
  },
  {
    id: 'bn-BD-PradeepNeural',
    labelBn: 'প্রদীপ (বাংলা, বাংলাদেশ)',
    language: 'bn',
    gender: 'male',
    locale: 'bn-BD',
    noteBn: 'বাংলা-প্রশিক্ষিত নিউরাল কণ্ঠ — দেশীয় উচ্চারণ (পুরুষ)',
  },
  {
    id: 'bn-IN-TanishaaNeural',
    labelBn: 'তানিশা (বাংলা, ভারত)',
    language: 'bn',
    gender: 'female',
    locale: 'bn-IN',
    noteBn: 'পশ্চিমবঙ্গ-প্রভাবিত বাংলা নিউরাল কণ্ঠ (নারী)',
  },
  {
    id: 'bn-IN-BashkarNeural',
    labelBn: 'ভাস্কর (বাংলা, ভারত)',
    language: 'bn',
    gender: 'male',
    locale: 'bn-IN',
    noteBn: 'পশ্চিমবঙ্গ-প্রভাবিত বাংলা নিউরাল কণ্ঠ (পুরুষ)',
  },
  {
    id: 'en-US-AriaNeural',
    labelBn: 'আরিয়া (ইংরেজি, মার্কিন)',
    language: 'en',
    gender: 'female',
    locale: 'en-US',
    noteBn: 'ইংরেজি নিউরাল কণ্ঠ (নারী)',
  },
  {
    id: 'en-US-GuyNeural',
    labelBn: 'গাই (ইংরেজি, মার্কিন)',
    language: 'en',
    gender: 'male',
    locale: 'en-US',
    noteBn: 'ইংরেজি নিউরাল কণ্ঠ (পুরুষ)',
  },
  {
    id: 'en-GB-SoniaNeural',
    labelBn: 'সোনিয়া (ইংরেজি, ব্রিটিশ)',
    language: 'en',
    gender: 'female',
    locale: 'en-GB',
    noteBn: 'ব্রিটিশ ইংরেজি নিউরাল কণ্ঠ (নারী)',
  },
  {
    id: 'en-GB-RyanNeural',
    labelBn: 'রায়ান (ইংরেজি, ব্রিটিশ)',
    language: 'en',
    gender: 'male',
    locale: 'en-GB',
    noteBn: 'ব্রিটিশ ইংরেজি নিউরাল কণ্ঠ (পুরুষ)',
  },
];

export type EdgeVoiceId = (typeof EDGE_VOICES)[number]['id'];

const EDGE_VOICE_IDS = new Set<string>(EDGE_VOICES.map(v => v.id));

/** কণ্ঠ-আইডি Edge-নিউরাল কণ্ঠ কি না */
export function isEdgeVoice(voice: string): voice is EdgeVoiceId {
  return EDGE_VOICE_IDS.has(voice);
}

/** ভাষা অনুযায়ী Edge-কণ্ঠের তালিকা */
export function edgeVoicesFor(language: 'bn' | 'en'): EdgeVoiceInfo[] {
  return EDGE_VOICES.filter(v => v.language === language);
}

// ------------------------------------------------------------
// DRM টোকেন (Sec-MS-GEC)
// ------------------------------------------------------------

let clockSkewSec = 0; // সার্ভার-Date থেকে শেখা সময়-পার্থক্য (সেকেন্ডে)

function generateSecMsGec(): string {
  let ticks = Math.floor(Date.now() / 1000) + clockSkewSec;
  ticks += 11644473600; // উইন্ডোজ-যুগ (1601-01-01)
  ticks -= ticks % 300; // ৫-মিনিটে ফ্লোর
  ticks *= 10_000_000; // ১০০-ন্যানোসেকেন্ড এককে
  return createHash('sha256').update(`${ticks}${TRUSTED_CLIENT_TOKEN}`).digest('hex').toUpperCase();
}

/** 403-এর সাথে সার্ভারের Date পেলে ঘড়ি-পার্থক্য শিখে নাও (পাইথন-প্যাকেজের প্যাটার্ন) */
function learnClockSkewFromError(err: unknown): void {
  const headers = (err as any)?.headers;
  const dateHeader =
    headers && typeof headers.get === 'function' ? headers.get('date') : (err as any)?.response?.headers?.date;
  if (typeof dateHeader === 'string' && dateHeader) {
    const serverMs = Date.parse(dateHeader.endsWith('GMT') ? dateHeader : `${dateHeader} GMT`);
    if (Number.isFinite(serverMs)) {
      const newSkew = Math.round((serverMs - Date.now()) / 1000);
      // যুক্তিসঙ্গত সীমার মধ্যে থাকলেই (±৬ ঘণ্টা) মেনে নাও
      if (Math.abs(newSkew) < 6 * 3600) clockSkewSec = newSkew;
    }
  }
}

// ------------------------------------------------------------
// SSML নির্মাণ
// ------------------------------------------------------------

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** speed (z-ai-স্কেল ০.৫–২) → Edge-এর rate শতাংশ (+X% / −X%) */
function speedToRate(speed: number): string {
  const clamped = Math.max(0.5, Math.min(2, Number.isFinite(speed) ? speed : 1));
  const pct = Math.round((clamped - 1) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

function buildSsml(text: string, voice: EdgeVoiceId, speed: number, pitchHz = 0): string {
  const locale = voice.split('-').slice(0, 2).join('-');
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${locale}'>` +
    `<voice name='${voice}'>` +
    `<prosody rate='${speedToRate(speed)}' pitch='${pitchHz >= 0 ? '+' : ''}${pitchHz}Hz'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`
  );
}

function randomHex(len: number): string {
  return randomBytes(32).toString('hex').slice(0, len);
}

function dateToString(): string {
  // python edge-tts-এর বিন্যাস: "Tue, 13 Oct 2026 ... GMT+0000 (Coordinated Universal Time)"
  return new Date().toUTCString().replace('GMT', 'GMT+0000 (Coordinated Universal Time)');
}

// ------------------------------------------------------------
// মূল সংশ্লেষণ — একটি অংশ (≤ সীমা) → MP3 বাফার
// ------------------------------------------------------------

const SEGMENT_CHAR_LIMIT = 1200;
/** প্রতি-অংশ WSS সময়সীমা (৩০ সে.) — টেস্টে setEdgeWsTimeoutForTests দিয়ে ছোট করা যায় */
let wsTimeoutMs = 30_000;

/** [শুধু টেস্ট] WSS টাইমআউট ছোট করা — hermetic adapter-ইউনিটে ৩০ সে. অপেক্ষা এড়াতে (B-F11) */
export function setEdgeWsTimeoutForTests(ms: number): void {
  wsTimeoutMs = Math.max(20, Math.floor(ms));
}

/** দীর্ঘ লেখা বাক্য-সীমায় ভাগ (Edge-এক কলে খুব দীর্ঘ টেক্সট অস্থিতিশীল) */
export function splitForEdge(text: string, limit = SEGMENT_CHAR_LIMIT): string[] {
  const t = (text ?? '').trim();
  if (t.length <= limit) return t ? [t] : [];
  const parts: string[] = [];
  let buf = '';
  // বাক্য-সীমা: দাঁড়ি, ?, !, দাঁড়ি-বিন্দু, নতুন-লাইন
  for (const piece of t.split(/(?<=[।!?\.])\s+/)) {
    if ((buf + ' ' + piece).trim().length > limit && buf) {
      parts.push(buf.trim());
      buf = piece;
    } else {
      buf = `${buf} ${piece}`.trim();
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function synthesizeSegment(segment: string, voice: EdgeVoiceId, speed: number, pitchHz: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const gec = generateSecMsGec();
    const url =
      `${WSS_BASE}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
      `&ConnectionId=${randomHex(32)}` +
      `&Sec-MS-GEC=${gec}` +
      `&Sec-MS-GEC-Version=${encodeURIComponent(SEC_MS_GEC_VERSION)}`;

    const headers: Record<string, string> = {
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        `(KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0 Safari/537.36 ` +
        `Edg/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0`,
      'Sec-MS-GEC': gec,
      'Sec-MS-GEC-Version': SEC_MS_GEC_VERSION,
      Cookie: `muid=${randomBytes(16).toString('hex').toUpperCase()};`,
    };

    let settled = false;
    const finish = (err: Error | null, buf?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ইতিমধ্যে বন্ধ */
      }
      if (err) reject(err);
      else resolve(buf!);
    };

    const ws = new WebSocket(url, { headers, perMessageDeflate: true });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => finish(new Error(`Edge TTS সময়সীমা (${Math.round(wsTimeoutMs / 1000)} সে.)`)), wsTimeoutMs);

    ws.on('open', () => {
      const dateStr = dateToString();
      ws.send(
        `X-Timestamp:${dateStr}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
                  outputFormat: OUTPUT_FORMAT,
                },
              },
            },
          })
      );
      ws.send(
        `X-RequestId:${randomHex(32)}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${dateStr}Z\r\nPath:ssml\r\n\r\n` +
          buildSsml(segment, voice, speed, pitchHz)
      );
    });

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (!isBinary) {
        const s = data.toString();
        if (s.includes('Path:turn.end')) {
          const audio = Buffer.concat(chunks);
          if (audio.length < 200) {
            finish(new Error(`Edge TTS অডিও ফেরত দেয়নি (${audio.length} বাইট)`));
          } else {
            finish(null, audio);
          }
        }
        return;
      }
      const arr = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
      // বাইনারি বার্তা = [২-বাইট হেডার-দৈর্ঘ্য][হেডার স্ট্রিং][MP3 ডেটা]
      // হেডারের শেষ চিহ্ন: "\r\nPath:audio\r\n" (১৪ বাইট)
      const sep = arr.indexOf(AUDIO_PATH_MARKER);
      if (sep >= 0) chunks.push(arr.subarray(sep + AUDIO_PATH_MARKER.length));
    });

    ws.on('error', (err: Error & { headers?: unknown }) => {
      const msg = String(err?.message ?? err);
      if (/403|401/.test(msg)) learnClockSkewFromError(err);
      finish(new Error(`Edge TTS সংযোগ-ত্রুটি: ${msg.slice(0, 140)}`));
    });

    ws.on('close', (code: number) => {
      if (!settled && code !== 1000) {
        finish(new Error(`Edge TTS সংযোগ বন্ধ (কোড ${code})`));
      } else if (!settled) {
        finish(new Error('Edge TTS সংযোগ সার্ভারে বন্ধ হয়ে গেছে (উত্তর আসেনি)'));
      }
    });
  });
}

const AUDIO_PATH_MARKER = Buffer.from('\r\nPath:audio\r\n');

export interface EdgeSpeechResult {
  /** MP3 (CBR 48kbps, 24kHz mono) — খণ্ডগুলো সরাসরি জোড়া */
  buffer: Buffer;
  mimeType: string;
  ext: 'mp3';
  voice: EdgeVoiceId;
  segments: number;
  generationMs: number;
  provider: typeof EDGE_TTS_PROVIDER;
}

/**
 * পাঠ্য → বাংলা/ইংরেজি নিউরাল কণ্ঠ। দীর্ঘ লেখা বাক্য-সীমায় ভেঙে
 * ধারাবাহিক সংশ্লেষণ (প্রতি অংশে ২ পুনঃচেষ্টা — 403 হলে ঘড়ি-পার্থক্য
 * শিখে নতুন GEC দিয়ে আবার)।
 */
export async function synthesizeEdgeSpeech(
  text: string,
  voice: EdgeVoiceId,
  opts?: { speed?: number; pitchHz?: number }
): Promise<EdgeSpeechResult> {
  const speed = opts?.speed ?? 1;
  const pitchHz = opts?.pitchHz ?? 0;
  const segments = splitForEdge(text);
  if (segments.length === 0) throw new Error('Edge TTS: লেখা খালি');
  if (!isEdgeVoice(voice)) throw new Error(`Edge TTS: অজানা কণ্ঠ "${voice}"`);

  const t0 = Date.now();
  const buffers: Buffer[] = [];
  for (const [i, seg] of segments.entries()) {
    let lastErr: unknown = null;
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        buffers.push(await synthesizeSegment(seg, voice, speed, pitchHz));
        ok = true;
      } catch (err) {
        lastErr = err;
        if (attempt < 2) {
          // 403/ঘড়ি-সীমায় সংক্ষিপ্ত অপেক্ষা দিয়ে নতুন টোকেন (৫-মিনিট জানালা পাল্টে গেলে)
          await new Promise(r => setTimeout(r, attempt === 0 ? 800 : 2500));
        }
      }
    }
    if (!ok) {
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      throw new Error(
        segments.length > 1
          ? `Edge TTS: অংশ ${i + 1}/${segments.length} ব্যর্থ — ${msg}`
          : `Edge TTS ব্যর্থ — ${msg}`
      );
    }
  }
  return {
    buffer: Buffer.concat(buffers),
    mimeType: 'audio/mpeg',
    ext: 'mp3',
    voice,
    segments: segments.length,
    generationMs: Date.now() - t0,
    provider: EDGE_TTS_PROVIDER,
  };
}

// ------------------------------------------------------------
// স্বাস্থ্য-পরীক্ষা (সিস্টেম-তথ্যের জন্য)
// ------------------------------------------------------------

let healthCache: { at: number; ok: boolean; note: string } | null = null;

/**
 * সিঙ্ক্রোনাস স্বাস্থ্য-স্ন্যাপশট (B-F07): সর্বশেষ প্রোবের ক্যাশে থেকে পড়া —
 * প্রোব কখনো ছুঁড়ে না। কখনো প্রোব হয়নি হলে status='unknown' (এই অবস্থায়
 * ক্ষমতা-ঘোষণা শর্তাধীন শব্দে লেখা হয় — "Edge সক্রিয় কালে…")।
 */
export function edgeHealthSnapshot(): {
  status: 'unknown' | 'up' | 'down';
  at: string | null;
  note: string;
} {
  if (!healthCache) return { status: 'unknown', at: null, note: '' };
  return {
    status: healthCache.ok ? 'up' : 'down',
    at: new Date(healthCache.at).toISOString(),
    note: healthCache.note,
  };
}

// ------------------------------------------------------------
// প্রতি-কণ্ঠ যাচাই-রেকর্ড (B-F07) — storage/voice-verification.json
// (মাইগ্রেশনমুক্ত: কোনো Prisma-স্কিমা পরিবর্তন নেই; প্রতি কণ্ঠ সর্বশেষ
//  রেকর্ড রাখা হয় — কণ্ঠ-সংখ্যার সাথে বাউন্ডেড, তাই ফাইল কখনো অসীম বাড়ে না)
// ------------------------------------------------------------

export interface VoiceVerificationRecord {
  voice: string;
  engine: 'edge' | 'zai';
  language: string;
  verdict: 'pass' | 'warn' | 'fail';
  transcript: string;
  similarity: number;
  detectedLanguage: string;
  durationSec: number;
  expectedSec: number;
  note?: string;
  verifiedAt: string;
}

interface VoiceVerificationFile {
  version: number;
  records: Record<string, VoiceVerificationRecord>;
}

/** রেকর্ড-ফাইলের পথ — টেস্ট isolation-এর জন্য VOICE_VERIFICATION_FILE এনভায়রনমেন্ট ওভাররাইড */
function verificationFilePath(): string {
  return process.env.VOICE_VERIFICATION_FILE ?? path.join(process.cwd(), 'storage', 'voice-verification.json');
}

/** জমা রেকর্ডগুলো পড়া (নেই/ভাঙা হলে খালি) */
export async function readVoiceVerificationRecords(): Promise<VoiceVerificationFile> {
  try {
    const raw = await readFile(verificationFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as VoiceVerificationFile;
    if (parsed && typeof parsed === 'object' && parsed.records && typeof parsed.records === 'object') {
      return { version: 1, records: parsed.records };
    }
    return { version: 1, records: {} };
  } catch {
    return { version: 1, records: {} };
  }
}

/**
 * প্রতি-কণ্ঠ যাচাই-রেকর্ড জমা (B-F07): verifySpeechBuffer/edgeTtsHealth লেখে।
 * best-effort — রেকর্ড-লেখার ব্যর্থতা কখনো মূল যাচাই-ফলাফলকে ভাঙবে না;
 * পরমাণু-লেখা (.tmp → rename) — পাঠক কখনো অর্ধ-লেখা JSON দেখবে না।
 */
export async function recordVoiceVerification(
  rec: Omit<VoiceVerificationRecord, 'verifiedAt'> & { verifiedAt?: string }
): Promise<void> {
  try {
    const file = verificationFilePath();
    const current = await readVoiceVerificationRecords();
    const records: Record<string, VoiceVerificationRecord> = {
      ...current.records,
      [rec.voice]: { ...rec, verifiedAt: rec.verifiedAt ?? new Date().toISOString() } as VoiceVerificationRecord,
    };
    const tmp = `${file}.tmp`;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(tmp, JSON.stringify({ version: 1, records }, null, 2), 'utf8');
    await rename(tmp, file);
  } catch {
    // ইচ্ছাকৃত নীরবতা — রেকর্ড-লেখা যাচাই-পথকে কখনো ব্যর্থ করবে না
  }
}

/** দ্রুত সংযোগ-পরীক্ষা (ফলাফল ৫ মিনিট ক্যাশে) */
export async function edgeTtsHealth(force = false): Promise<{ ok: boolean; note: string }> {
  if (!force && healthCache && Date.now() - healthCache.at < 5 * 60_000) {
    return { ok: healthCache.ok, note: healthCache.note };
  }
  try {
    const res = await synthesizeSegment('স্বাস্থ্য পরীক্ষা।', 'bn-BD-NabanitaNeural', 1, 0);
    const ok = res.length > 500;
    const note = ok
      ? `সক্রিয় — bn-BD নিউরাল কণ্ঠ প্রতিক্রিয়া দিচ্ছে (${res.length} বাইট)`
      : 'প্রতিক্রিয়া অস্বাভাবিক ছোট';
    healthCache = { at: Date.now(), ok, note };
    // B-F07: স্বাস্থ্য-প্রোবের ফলাফলও প্রতি-কণ্ঠ রেকর্ডে জমা হয় (ক্যাশ-পাঠে নয়)
    await recordVoiceVerification({
      voice: 'bn-BD-NabanitaNeural',
      engine: 'edge',
      language: 'bn',
      verdict: ok ? 'pass' : 'fail',
      transcript: '',
      similarity: 0,
      detectedLanguage: 'unknown',
      durationSec: 0,
      expectedSec: 0,
      note: note.slice(0, 160),
    });
    return { ok, note };
  } catch (err) {
    const note = `অনুপলব্ধ — ${err instanceof Error ? err.message.slice(0, 100) : 'অজানা'}`;
    healthCache = { at: Date.now(), ok: false, note };
    await recordVoiceVerification({
      voice: 'bn-BD-NabanitaNeural',
      engine: 'edge',
      language: 'bn',
      verdict: 'fail',
      transcript: '',
      similarity: 0,
      detectedLanguage: 'unknown',
      durationSec: 0,
      expectedSec: 0,
      note: note.slice(0, 160),
    }).catch(() => {});
    return { ok: false, note };
  }
}
