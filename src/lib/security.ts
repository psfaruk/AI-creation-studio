// ============================================================
// src/lib/security.ts — একক-মালিকের স্টুডিও-নিরাপত্তা (owner-security)
//
// P0-নিরাপত্তা সমাধান: অ্যাপের সব সংবেদনশীল API (কী, আর্টিফ্যাক্ট,
// প্রোডাকশন, চ্যাট …) এখন মালিক-সেশনের পেছনে। এটি একটি single-owner
// ব্যক্তিগত স্টুডিও — multi-user নয়।
//
// মডেল:
//  - প্রথমবার ব্যবহারে মালিক একটি passcode সেট করেন (setup)।
//  - passcode নিজে কখনোই ফাইলে থাকে না — কেবল scrypt হ্যাশ
//    (salt সহ, 64-বাইট) storage/security.json-এ যায় (0600, best-effort)।
//  - সফল setup/unlock → ৩০ দিনের সেশন-টোকেন:
//      `${expMs}.${HMAC-SHA256(secret, 'studio-session:' + expMs)}`
//    cookie (HttpOnly) + localStorage-হেডার দুই পথেই চলে।
//
// ENV PRE-SEED (নথিভুক্ত আচরণ):
//  - process.env.STUDIO_OWNER_PASSCODE অ-শূন্য ও ≥৮ অক্ষর হলে:
//      * security.json না থাকলে বা passcodeFromEnv:true হলে
//        env-পাসকোডই মালিক-পাসকোড — প্রতি বুটে হ্যাশ মেমরিতে
//        পুনঃগণনা হয় (ফাইলের hash-কলাম তথ্যমাত্র); ফাইল কেবল
//        স্থায়ী `secret`-এর জন্য।
//      * env সেট থাকলে setup-এন্ডপয়েন্ট 403 দেয় (ইতিমধ্যেই আরম্ভ)।
//      * মালিক নিজে setup দিয়ে পাসকোড বসিয়ে থাকলে
//        (passcodeFromEnv:false) সেটিই প্রযোজ্য — env উপেক্ষিত।
//  - এই স্যান্ডবক্সে STUDIO_OWNER_PASSCODE সেট নেই, তাই ব্যবহারকারী
//    প্রথম-চালু অভিজ্ঞতায় (initialized:false) নিজের পাসকোড বসান।
// ============================================================

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { chmod, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

// ------------------------------------------------------------
// ধ্রুবক
// ------------------------------------------------------------

const SECURITY_FILE = path.join(process.cwd(), 'storage', 'security.json');

export const SESSION_COOKIE = 'studio_session';
export const SESSION_HEADER = 'x-studio-token';
export const SESSION_QUERY_PARAM = 'st';

/** সেশনের আয়ু — ৩০ দিন (মিলিসেকেন্ড ও কুকি-সেকেন্ড একই সূত্রে) */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 2_592_000 সেকেন্ড

const SESSION_CONTEXT = 'studio-session:';

export const PASSCODE_MIN = 8;
export const PASSCODE_MAX = 200;

/** unlock রেট-লিমিট: ১৫ মিনিটে সর্বোচ্চ ৫টি ব্যর্থ চেষ্টা/আইপি */
const UNLOCK_MAX_FAILURES = 5;
const UNLOCK_WINDOW_MS = 15 * 60 * 1000;

// ------------------------------------------------------------
// ফাইলের গড়ন
// ------------------------------------------------------------

export interface SecurityFileShape {
  version: 1;
  /** hex — scrypt-এর salt */
  salt: string;
  /** hex — scryptSync(passcode, salt, 64) */
  hash: string;
  /** 64 hex chars = 32 বাইট — সেশন-HMAC-এর গোপন চাবি */
  secret: string;
  createdAt: string;
  initializedAt: string;
  passcodeFromEnv: boolean;
}

const HEX64_RE = /^[0-9a-f]{64}$/;

function isValidSecurityFile(v: unknown): v is SecurityFileShape {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  return (
    f.version === 1 &&
    typeof f.salt === 'string' &&
    f.salt.length > 0 &&
    /^[0-9a-f]+$/.test(f.salt) &&
    typeof f.hash === 'string' &&
    /^[0-9a-f]+$/.test(f.hash) &&
    typeof f.secret === 'string' &&
    HEX64_RE.test(f.secret) &&
    typeof f.createdAt === 'string' &&
    typeof f.initializedAt === 'string' &&
    typeof f.passcodeFromEnv === 'boolean'
  );
}

// ------------------------------------------------------------
// লোড-হয়ে-যাওয়া অবস্থা (প্রতি কলে ফাইল পড়া হয় — বাইরে থেকে
// ফাইল মুছে দিলেও সত্য অবস্থা সাথে সাথে প্রতিফলিত হয়)
// ------------------------------------------------------------

interface EffectiveSecurity {
  initialized: boolean;
  /** সেশন-HMAC-এর চাবি (initialized হলে অবশ্যই থাকে) */
  secret: Buffer | null;
  /** প্রযোজ্য salt (env-পথে ফাইলের salt-ই) */
  salt: string;
  /** প্রযোজ্য হ্যাশ — env-পাসকোড সক্রিয় হলে প্রতি বুটে পুনঃগণিত */
  hash: string;
  passcodeFromEnv: boolean;
}

/** issueSession()-এর জন্য সাম্প্রতিক চাবি — HMR-ও টিকে থাকে */
const g = globalThis as unknown as {
  __studioSessionSecret?: Buffer | null;
};

function envPasscode(): string | null {
  const v = process.env.STUDIO_OWNER_PASSCODE;
  return typeof v === 'string' && v.length >= PASSCODE_MIN && v.length <= PASSCODE_MAX
    ? v
    : null;
}

async function readSecurityFile(): Promise<SecurityFileShape | null> {
  try {
    const raw = await readFile(SECURITY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return isValidSecurityFile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeSecurityFile(file: SecurityFileShape): Promise<void> {
  await mkdir(path.dirname(SECURITY_FILE), { recursive: true });
  await writeFile(SECURITY_FILE, JSON.stringify(file, null, 2), 'utf8');
  try {
    await chmod(SECURITY_FILE, 0o600);
  } catch {
    // best-effort — ফাইল-সিস্টেম সমর্থন না করলেও চলবে
  }
}

function hashPasscode(passcode: string, salt: string): string {
  return scryptSync(passcode, Buffer.from(salt, 'hex'), 64).toString('hex');
}

/** স্ট্যান্ডার্ট প্রশ্ন: নিরাপত্তা আরম্ভ হয়েছে কি? */
export async function securityInitialized(): Promise<boolean> {
  const s = await loadSecurity();
  return s.initialized;
}

/**
 * ফাইল পড়ে প্রযোজ্য নিরাপত্তা-অবস্থা বানাও।
 * env-পাসকোড সক্রিয় হলে (ফাইল নেই বা passcodeFromEnv:true):
 *  - ফাইল নেই → স্থায়ী secret-সহ ফাইল তৈরি (passcodeFromEnv:true)
 *  - হ্যাশ মেমরিতে env থেকে পুনঃগণনা
 */
async function loadSecurity(): Promise<EffectiveSecurity> {
  const env = envPasscode();
  let file = await readSecurityFile();

  // env-পাসকোড প্রযোজ্য, কিন্তু ফাইল নেই → স্থায়ী secret-সহ ফাইল বানাও
  if (env && !file) {
    const salt = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    file = {
      version: 1,
      salt,
      hash: hashPasscode(env, salt),
      secret: randomBytes(32).toString('hex'),
      createdAt: now,
      initializedAt: now,
      passcodeFromEnv: true,
    };
    await writeSecurityFile(file);
  }

  if (!file) {
    g.__studioSessionSecret = null;
    return { initialized: false, secret: null, salt: '', hash: '', passcodeFromEnv: false };
  }

  const secret = Buffer.from(file.secret, 'hex');
  g.__studioSessionSecret = secret;

  // env-পাসকোডই মালিক-পাসকোড? তাহলে হ্যাশ প্রতি বুটে মেমরিতে পুনঃগণনা
  if (env && file.passcodeFromEnv) {
    return {
      initialized: true,
      secret,
      salt: file.salt,
      hash: hashPasscode(env, file.salt),
      passcodeFromEnv: true,
    };
  }

  // মালিক নিজে setup-এ বসানো পাসকোড (env নেই বা উপেক্ষিত)
  return {
    initialized: true,
    secret,
    salt: file.salt,
    hash: file.hash,
    passcodeFromEnv: false,
  };
}

// ------------------------------------------------------------
// পাসকোড
// ------------------------------------------------------------

function assertPasscodeShape(passcode: string): void {
  if (
    typeof passcode !== 'string' ||
    passcode.length < PASSCODE_MIN ||
    passcode.length > PASSCODE_MAX
  ) {
    throw new Error('invalid_passcode');
  }
}

/**
 * প্রথমবারের মালিক-পাসকোড সেটআপ → সাথে সাথে সেশন।
 * ইতিমধ্যে আরম্ভ হলে (ফাইল বা env) Error('already_initialized')।
 */
export async function setupOwnerPasscode(
  passcode: string,
): Promise<{ token: string; expiresAt: Date }> {
  assertPasscodeShape(passcode);
  const current = await loadSecurity();
  if (current.initialized) {
    throw new Error('already_initialized');
  }

  const salt = randomBytes(16).toString('hex');
  const secret = randomBytes(32);
  const now = new Date().toISOString();
  const file: SecurityFileShape = {
    version: 1,
    salt,
    hash: hashPasscode(passcode, salt),
    secret: secret.toString('hex'),
    createdAt: now,
    initializedAt: now,
    passcodeFromEnv: false,
  };
  await writeSecurityFile(file);

  // মেমরি-অবস্থা সাথে সাথে সদ্য-লেখা ফাইলের সমান করো
  g.__studioSessionSecret = secret;
  return issueSession();
}

/** পাসকোড যাচাই — ধ্রুব-সময় তুলনা (timingSafeEqual)। */
export async function verifyOwnerPasscode(passcode: string): Promise<boolean> {
  if (typeof passcode !== 'string' || passcode.length === 0) return false;
  const s = await loadSecurity();
  if (!s.initialized) return false;
  const candidate = Buffer.from(hashPasscode(passcode, s.salt), 'hex');
  const expected = Buffer.from(s.hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// ------------------------------------------------------------
// সেশন-টোকেন
// ------------------------------------------------------------

/** নতুন ৩০-দিনের সেশন ইস্যু করো (চাবি আগের loadSecurity/setup থেকে)। */
export function issueSession(): { token: string; expiresAt: Date } {
  const secret = g.__studioSessionSecret ?? null;
  if (!secret) {
    throw new Error('not_initialized');
  }
  const expMs = Date.now() + SESSION_TTL_MS;
  const hmac = createHmac('sha256', secret).update(`${SESSION_CONTEXT}${expMs}`).digest('hex');
  return { token: `${expMs}.${hmac}`, expiresAt: new Date(expMs) };
}

function verifySessionToken(token: string, secret: Buffer): boolean {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return false;
  const expStr = token.slice(0, dot);
  const hmac = token.slice(dot + 1).toLowerCase();
  if (!/^\d{1,16}$/.test(expStr) || !HEX64_RE.test(hmac)) return false;
  const expMs = Number(expStr);
  if (!Number.isFinite(expMs) || expMs <= Date.now()) return false;
  const expected = createHmac('sha256', secret)
    .update(`${SESSION_CONTEXT}${expMs}`)
    .digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(hmac, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ------------------------------------------------------------
// অনুরোধ থেকে সেশন-টোকেন বের করা
// ------------------------------------------------------------

function readCookieToken(req: Request): string | null {
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === SESSION_COOKIE) {
      const value = part.slice(eq + 1).trim();
      return value || null;
    }
  }
  return null;
}

/**
 * অনুরোধ থেকে কাঁচা সেশন-টোকেন — cookie বা x-studio-token হেডার
 * বা `st` কোয়েরি-প্যারামিটার (যে-কোনো একটিতে পাওয়া গেলে)।
 * কোন উৎস অনুমোদিত সেটা requireOwner/isSessionValidForReq ঠিক করে।
 */
export function extractSession(req: Request): string | null {
  const header = req.headers.get(SESSION_HEADER);
  if (header && header.trim()) return header.trim();
  const cookie = readCookieToken(req);
  if (cookie) return cookie;
  try {
    const st = new URL(req.url).searchParams.get(SESSION_QUERY_PARAM);
    if (st && st.trim()) return st.trim();
  } catch {
    // req.url অদ্ভুত হলে কোয়েরি-পথ বাদ
  }
  return null;
}

function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

/**
 * নিয়ম-সচেতন টোকেন-আহরণ:
 *  - হেডার/কুকি সব মেথডে চলে
 *  - `st` কোয়েরি কেবল GET/HEAD-এ এবং allowQueryToken হলে
 *    (<img>/<audio>/EventSource-এর জন্য)
 */
function extractSessionForRequest(
  req: Request,
  opts?: { allowQueryToken?: boolean },
): string | null {
  const header = req.headers.get(SESSION_HEADER);
  if (header && header.trim()) return header.trim();
  const cookie = readCookieToken(req);
  if (cookie) return cookie;
  if (opts?.allowQueryToken && isReadMethod(req.method.toUpperCase())) {
    try {
      const st = new URL(req.url).searchParams.get(SESSION_QUERY_PARAM);
      if (st && st.trim()) return st.trim();
    } catch {
      // উপেক্ষা
    }
  }
  return null;
}

async function hasValidSession(
  req: Request,
  opts?: { allowQueryToken?: boolean },
): Promise<boolean> {
  const s = await loadSecurity();
  if (!s.initialized || !s.secret) return false;
  const token = extractSessionForRequest(req, opts);
  if (!token) return false;
  return verifySessionToken(token, s.secret);
}

/** /api/auth/status-এর সহায়ক — অনুরোধে বৈধ সেশন আছে কি? */
export async function isSessionValidForReq(
  req: Request,
  opts?: { allowQueryToken?: boolean },
): Promise<boolean> {
  return hasValidSession(req, opts);
}

/**
 * কাঁচা টোকন-স্ট্রিং যাচাই (Bearer-হিসেবে /api/v1 প্ল্যাটফর্ম-APIতে
 * মালিক-সেশনও গ্রহণযোগ্য করতে)। টোকেনটি অবশ্যই বর্তমান secret-দ্বারা
 * সইকৃত ও মেয়াদের ভেতরে হতে হবে।
 */
export async function isSessionTokenValid(token: string): Promise<boolean> {
  const s = await loadSecurity();
  if (!s.initialized || !s.secret) return false;
  return verifySessionToken(token, s.secret);
}

// ------------------------------------------------------------
// মালিক-রক্ষী — সংবেদনশীল রুটের শীর্ষে বসে
// ------------------------------------------------------------

export type OwnerGuard =
  | { ok: true }
  | { ok: false; response: NextResponse };

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: 'এই API ব্যবহারের জন্য মালিক-সেশন প্রয়োজন', code: 'auth_required' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * সংবেদনশীল API-এর প্রথম লাইন:
 *
 *   const auth = requireOwner(req, { allowQueryToken: true }); // শুধু GET-মিডিয়া/SSE
 *   if (!auth.ok) return auth.response;
 *
 *  - সেশন নেই/অবৈধ/নিরাপত্তা আরম্ভই হয়নি → 401 auth_required
 *  - হেডার-টোকেন পথ (x-studio-token): যাচাই সফল হলেই অনুমোদিত —
 *    ক্রস-অরিজিন JS কাস্টম-হেডার পাঠাতে পারে না (প্রি-ফ্লাইট ছাড়া,
 *    যা আমাদের সার্ভার অনুমোদন করে না) এবং টোকেন-মান কেবল মালিকের
 *    নিজের পাতার localStorage-এ থাকে — অর্থাৎ এই পথে CSRF অসম্ভব।
 *    (গেটওয়ে/প্রিভিউ-প্রক্সি যে-কোনো Host-রিরাইটেও কাজ করে।)
 *  - cookie/query-টোকেন পথ (লেখা-মেথডে): Origin-হোস্ট ∈
 *    {Host, X-Forwarded-Host} না হলে 403 cross_origin_blocked
 *    (CSRF/Origin প্রতিরক্ষা — ব্রাউজার X-Forwarded-Host বাননো
 *    করতে পারে না বলে প্রক্সি-চেইনেও নিরাপদ)।
 */
export async function requireOwner(
  req: Request,
  opts?: { allowQueryToken?: boolean },
): Promise<OwnerGuard> {
  const s = await loadSecurity();
  if (!s.initialized || !s.secret) {
    return { ok: false, response: unauthorized() };
  }

  // ---- পথ ১: হেডার-টোকেন (CSRF-অসম্ভব — Origin-চেকের প্রয়োজন নেই) ----
  const header = req.headers.get(SESSION_HEADER);
  const headerToken = header && header.trim() !== '' ? header.trim() : null;
  if (headerToken && verifySessionToken(headerToken, s.secret)) {
    return { ok: true };
  }

  // ---- পথ ২: cookie / (GET-এ) query-টোকেন + Origin-প্রতিরক্ষা ----
  let token = readCookieToken(req);
  if (!token && opts?.allowQueryToken && isReadMethod(req.method.toUpperCase())) {
    try {
      const st = new URL(req.url).searchParams.get(SESSION_QUERY_PARAM);
      if (st && st.trim()) token = st.trim();
    } catch {
      // req.url অদ্ভুত হলে কোয়েরি-পথ বাদ
    }
  }
  if (!token || !verifySessionToken(token, s.secret)) {
    return { ok: false, response: unauthorized() };
  }

  const method = req.method.toUpperCase();
  if (!isReadMethod(method)) {
    const origin = req.headers.get('origin');
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        originHost = null;
      }
      // (প্রিভিউ-প্রক্সি ফিক্স) Origin-হোস্টের তুলনা শুধু Host-হেডারের সাথে
      // নয় — প্রক্সি-চেইনের মূল হোস্টও ধরা হয়:
      //  - Host                : সরাসরি (বা হোস্ট-সংরক্ষণকারী প্রক্সির পেছনে)
      //  - X-Forwarded-Host    : গেটওয়ে/edge মূল হোস্ট পুনর্লিখন করলে
      //    (কমা-বিভাজিত তালিকা হতে পারে — সবগুলোই মূল চেইনের অংশ)
      // ব্রাউজার fetch/XHR কখনোই X-Forwarded-Host সেট করতে পারে না
      // (forbidden header) — তাই CSRF-প্রতিরক্ষা অটুট থাকে।
      const allowedHosts = new Set<string>();
      const addCandidate = (raw: string | null) => {
        if (!raw) return;
        for (const part of raw.split(',')) {
          const h = part.trim().toLowerCase();
          if (!h) continue;
          allowedHosts.add(h);
          // ডিফল্ট পোর্ট-প্রত্যয় বাদ দিয়ে রূপটিও রাখো (:443/:80
          // URL-পার্সিংয়ে বাদ পড়ে — অতএব উভয় রূপ মিলাই)।
          const stripped = h.replace(/:(443|80)$/, '');
          if (stripped !== h) allowedHosts.add(stripped);
        }
      };
      addCandidate(req.headers.get('host'));
      addCandidate(req.headers.get('x-forwarded-host'));
      if (!originHost || allowedHosts.size === 0 || !allowedHosts.has(originHost)) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: 'cross-origin request blocked', code: 'cross_origin_blocked' },
            { status: 403, headers: { 'Cache-Control': 'no-store' } },
          ),
        };
      }
    }
  }

  return { ok: true };
}

// ------------------------------------------------------------
// unlock রেট-লিমিট (আইপি-ভিত্তিক, in-memory)
// ------------------------------------------------------------

interface UnlockLimitState {
  failures: Map<string, number[]>;
}

const lockG = globalThis as unknown as { __studioUnlockLimit?: UnlockLimitState };
const unlockState: UnlockLimitState = (lockG.__studioUnlockLimit ??= { failures: new Map() });

function pruneFailures(ip: string, now: number): number[] {
  const list = (unlockState.failures.get(ip) ?? []).filter((ts) => now - ts < UNLOCK_WINDOW_MS);
  if (list.length === 0) unlockState.failures.delete(ip);
  else unlockState.failures.set(ip, list);
  return list;
}

/** এই আইপি কি এখন unlock-লিমিটে (১৫ মিনিটে ≥৫টি ব্যর্থ চেষ্টা)? */
export function unlockRateLimited(ip: string): boolean {
  const list = pruneFailures(ip, Date.now());
  return list.length >= UNLOCK_MAX_FAILURES;
}

/** সীমা ভাঙলে আর কতক্ষণ অপেক্ষা (সেকেন্ডে, ৪২৯-উত্তরের জন্য)। */
export function unlockRetryAfterSec(ip: string): number {
  const list = pruneFailures(ip, Date.now());
  if (list.length < UNLOCK_MAX_FAILURES) return 0;
  const oldest = Math.min(...list);
  return Math.max(1, Math.ceil((oldest + UNLOCK_WINDOW_MS - Date.now()) / 1000));
}

/** একটি ব্যর্থ unlock-চেষ্টা নথিভুক্ত। */
export function registerUnlockFailure(ip: string): void {
  const now = Date.now();
  const list = pruneFailures(ip, now);
  list.push(now);
  unlockState.failures.set(ip, list);
}

/** সফল unlock — জানালা রিসেট। */
export function resetUnlockLimit(ip: string): void {
  unlockState.failures.delete(ip);
}
