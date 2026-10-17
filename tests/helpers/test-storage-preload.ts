// ============================================================
// D-1 টেস্ট-আইসোলেশন প্রিলোড (B1 — "tests cannot mutate production
// voice-verification records")
//
// সমস্যা (2026-10-17 অডিটে প্রমাণিত): verifySpeechBuffer →
// recordVoiceVerification প্রকৃত storage/voice-verification.json-এ
// লেখে; কোনো টেস্ট VOICE_VERIFICATION_FILE ওভাররাইড সেট করত না,
// তাই প্রতি স্যুট-রানে ~১৭টি ফ্যাব্রিকেটেড রেকর্ড ব্যবহারকারীরর
// প্রকৃত প্রোভাইডার-স্বাস্থ্য ডেটা মুছে দিত (REG-1h-এর নীরব 2.0s
// WAV "pass" রেকর্ড প্রকৃত 403-fail রেকর্ডকে ওভাররাইট করেছিল)।
//
// সমাধান: bunfig.toml [test] preload — প্রতিটি টেস্ট-প্রসেসের শুরুতেই
// রেকর্ড-ফাইলের পথ একটি অনন্য টেম্প-ডিরেক্টরিতে রাউট হয়।
// edge_tts.ts:verificationFilePath() প্রতি-কলে এনভায়রনমেন্ট পড়ে,
// তাই ইমপোর্ট-ক্রম নির্বিশেষে এটি কার্যকর। স্পষ্ট এনভায়রনমেন্ট
// (CI/ডিবাগ) থাকলে সেটিকে সম্মান করা হয় (?? শর্ত)।
// ============================================================
import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';

const isolatedDir = mkdtempSync(path.join(os.tmpdir(), 'suite-voice-verify-'));
process.env.VOICE_VERIFICATION_FILE =
  process.env.VOICE_VERIFICATION_FILE ?? path.join(isolatedDir, 'voice-verification.json');
