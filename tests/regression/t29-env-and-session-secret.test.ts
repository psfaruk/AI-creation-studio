// ============================================================
// REGRESSION TEST 29 — Env validation + Session-secret (Phase 1)
//
// Boundaries:
//  - Modules under test (REAL): src/lib/env.ts (validateEnv,
//    envStartupWarnings) ও src/lib/security.ts-এর খাঁটি সহায়ক
//    resolveSessionSecret — কোনো ফাইল-স্পর্শ নেই, কোনো আসল
//    storage/security.json পড়া/লেখা হয় না।
//  - No network, no DB, no SDK.
//
// Enforced contracts:
//  ১. validateEnv: dev-মোডে DATABASE_URL-ই একমাত্র required;
//     প্রোডাকশনে STUDIO_OWNER_PASSCODE-ও required।
//  ২. অনুপস্থিত/অবৈধ আকৃতি সৎভাবে ok=false — মান কখনো ফেরানো হয় না।
//  ৩. resolveSessionSecret: বৈধ env-চাবি (৬৪-হেক্স বা ≥৩২ অক্ষর) →
//     env-চাবি; env-না-থাকলে ফাইল-হেক্স; দুটোই না → null।
//  ৪. HF_TOKEN সংরক্ষিত-স্লট — এখন ঐচ্ছিক, কোনো required-দাবি নেই।
// ============================================================

import { describe, expect, test, afterAll } from 'bun:test';
import { validateEnv, envStartupWarnings } from '@/lib/env';
import { resolveSessionSecret } from '@/lib/security';

const HEX64 = 'a'.repeat(64);
const OTHER_HEX64 = 'b'.repeat(64);

describe('t29 · validateEnv', () => {
  // চুক্তি: প্রতিটি টেস্ট শেষে অবশ্যই আসল মানে ফিরে যেতে হবে — ফাইল-
  // স্কোপড একক-স্ন্যাপশট (প্রথম সেটের আগের অবস্থা) থেকে পুনরুদ্ধার।
  // (বহিরাগত ফাইলে NODE_ENV-লিক রোধ — এই স্যুটে প্রসেস-জুড়ে দূষণ
  // মারাত্মক পার্শ্ব-প্রভাব তৈরি করেছিল।)
  const ENV_KEYS = [
    'DATABASE_URL',
    'STUDIO_OWNER_PASSCODE',
    'STUDIO_SESSION_SECRET',
    'HF_TOKEN',
    'NODE_ENV',
  ] as const;
  const ORIGINALS: Record<string, string | undefined> = Object.fromEntries(
    ENV_KEYS.map(k => [k, (process.env as Record<string, string | undefined>)[k]])
  );

  // process.env-এর লেখাযোগ্য উপনাম (Next-টাইপে NODE_ENV রিড-ওনলি —
  // টেস্টে প্রতিস্থাপন/পুনরুদ্ধারের জন্য কাস্ট)
  const envRecord = process.env as unknown as Record<string, string | undefined>;

  function setEnv(vars: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>): void {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete envRecord[k];
      else envRecord[k] = v;
    }
  }

  function restoreEnv(): void {
    for (const key of ENV_KEYS) {
      const v = ORIGINALS[key];
      if (v === undefined) delete envRecord[key];
      else envRecord[key] = v;
    }
  }

  afterAll(() => {
    restoreEnv();
  });

  test('dev: শুধু DATABASE_URL required — দিলে ok', () => {
    setEnv({ DATABASE_URL: 'file:./db/custom.db', NODE_ENV: 'development' });
    try {
      const r = validateEnv();
      expect(r.production).toBe(false);
      expect(r.ok).toBe(true);
      const db = r.items.find(i => i.key === 'DATABASE_URL');
      expect(db?.level).toBe('required');
      expect(db?.ok).toBe(true);
      // dev-এ পাসকোড কেবল recommended
      const pass = r.items.find(i => i.key === 'STUDIO_OWNER_PASSCODE');
      expect(pass?.level).toBe('recommended');
    } finally {
      restoreEnv();
    }
  });

  test('dev: DATABASE_URL অনুপস্থিত → ok=false + সতর্ক-সারি', () => {
    setEnv({ DATABASE_URL: undefined, NODE_ENV: 'development' });
    try {
      const r = validateEnv();
      expect(r.ok).toBe(false);
      const w = envStartupWarnings(r);
      expect(w.some(x => x.includes('DATABASE_URL'))).toBe(true);
    } finally {
      restoreEnv();
    }
  });

  test('production: পাসকোড-বিহীন → required-ব্যর্থতা', () => {
    setEnv({
      DATABASE_URL: 'file:./db/custom.db',
      STUDIO_OWNER_PASSCODE: undefined,
      NODE_ENV: 'production',
    });
    try {
      const r = validateEnv();
      expect(r.production).toBe(true);
      expect(r.ok).toBe(false);
      const pass = r.items.find(i => i.key === 'STUDIO_OWNER_PASSCODE');
      expect(pass?.level).toBe('required');
      expect(pass?.ok).toBe(false);
      expect(envStartupWarnings(r).some(x => x.includes('STUDIO_OWNER_PASSCODE'))).toBe(true);
    } finally {
      restoreEnv();
    }
  });

  test('production: সব-আবশ্যক বসালে ok — সেশন-চাবি recommended পূরণও যাচাই', () => {
    setEnv({
      DATABASE_URL: 'postgresql://u:p@h/db',
      STUDIO_OWNER_PASSCODE: 'owner-pass-8+',
      STUDIO_SESSION_SECRET: HEX64,
      NODE_ENV: 'production',
    });
    try {
      const r = validateEnv();
      expect(r.ok).toBe(true);
      const secret = r.items.find(i => i.key === 'STUDIO_SESSION_SECRET');
      expect(secret?.level).toBe('recommended');
      expect(secret?.ok).toBe(true);
      expect(envStartupWarnings(r)).toEqual([]);
    } finally {
      restoreEnv();
    }
  });

  test('HF_TOKEN সংরক্ষিত-স্লট — এখন ঐচ্ছিক; অনুপস্থিতি কোনো ব্যর্থতা নয়', () => {
    setEnv({ DATABASE_URL: 'file:./db/custom.db', NODE_ENV: 'development', HF_TOKEN: undefined });
    try {
      const r = validateEnv();
      expect(r.ok).toBe(true);
      expect(r.items.find(i => i.key === 'HF_TOKEN')?.level).toBe('optional');
    } finally {
      restoreEnv();
    }
  });

  test('খাটো পাসকোড আকৃতি-অবৈধ (ok=false)', () => {
    setEnv({ DATABASE_URL: 'file:./db/custom.db', STUDIO_OWNER_PASSCODE: 'short', NODE_ENV: 'production' });
    try {
      const r = validateEnv();
      expect(r.items.find(i => i.key === 'STUDIO_OWNER_PASSCODE')?.ok).toBe(false);
      expect(r.ok).toBe(false);
    } finally {
      restoreEnv();
    }
  });
});

describe('t29 · resolveSessionSecret (env-চাবি > ফাইল-চাবি > null)', () => {
  test('বৈধ ৬৪-হেক্স env → বাইট-নির্ভুল হেক্স-ডিকোড', () => {
    const buf = resolveSessionSecret(HEX64, OTHER_HEX64);
    expect(buf).not.toBeNull();
    expect(buf!.toString('hex')).toBe(HEX64); // env-ই জয়ী
  });

  test('≥৩২ অক্ষরের অ-হেক্স env → utf-8 বাইট (এখনও env-জয়ী)', () => {
    const envStr = 'x'.repeat(40);
    const buf = resolveSessionSecret(envStr, OTHER_HEX64);
    expect(buf!.toString('utf8')).toBe(envStr);
  });

  test('খাটো env উপেক্ষিত → ফাইল-হেক্স ব্যবহৃত', () => {
    const buf = resolveSessionSecret('short', OTHER_HEX64);
    expect(buf!.toString('hex')).toBe(OTHER_HEX64);
  });

  test('env অনুপস্থিত → ফাইল-হেক্স', () => {
    expect(resolveSessionSecret(undefined, OTHER_HEX64)!.toString('hex')).toBe(OTHER_HEX64);
  });

  test('দুটোই অবৈধ/অনুপস্থিত → null', () => {
    expect(resolveSessionSecret(undefined, null)).toBeNull();
    expect(resolveSessionSecret('short', 'not-hex')).toBeNull();
  });
});
