// ============================================================
// REGRESSION TEST 12 — Intent-aware routing (Phase-4 Workstream B)
//
// Module under test (REAL): src/lib/agent/intent/classifier.ts +
// types — the deterministic, testable classification layer, plus the
// composition seam it feeds (specDraftFromIntent → validateSpec →
// createProduction) with the shared path itself.
//
// Boundaries:
//  - classifier: pure — no DB, no SDK, no network (by design).
//  - createProduction integration: '@/lib/db' → in-memory fake;
//    '@/lib/agent/tts-cache' + '@/lib/agent/sdk-helpers' → engine-
//    boundary mocks (t1/t8 pattern) so language_controller loads real
//    with its pure detectLanguage; capabilities/validateSpec real.
//  - No LLM, no provider calls, no storage writes.
//
// Enforced contract (Phase-4 §4 + §2):
//  - Bengali/English/mixed creative requests route to the right
//    category with a normalized intent object.
//  - Ordinary questions NEVER route into production pipelines.
//  - Singing / lip-sync requests are honestly unsupported — never a
//    fake-capable production.
//  - Fast-path eligibility only for clear big-work requests with no
//    material gaps.
//  - specDraftFromIntent output passes the REAL validateSpec.
//  - createProduction (shared path) creates awaiting_confirmation.
// ============================================================

import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { fakeDb, resetFakeDb, seedConversation, seedMessage, state } from '../helpers/fake-db';

// ---- engine-boundary mocks (t1/t8 pattern) — createProduction-ইন্টিগ্রেশনের জন্য
mock.module('@/lib/db', () => ({ db: fakeDb }));
mock.module('@/lib/agent/tts-cache', () => ({
  cachedSynthesizeSpeech: async () => {
    throw new Error('engine mock — must not be called by classification tests');
  },
}));
// (review-fix) isRateLimitErrorText এখানে মক করা যাবে না — sdk-helpers ওটি
// retry.ts থেকে পুনঃ-রপ্তানি করে, আর Bun-এর mock.module পুনঃ-রপ্তানিত বাইন্ডিংও
// ওভাররাইট করে দেয় — ফলে পরবর্তী ফাইলে (t6) সত্যিকারের retry-মডিউলও মক-রেজেক্স
// দেখে ফেলত (REG-6j নিয়ত ব্যর্থ)। t1/t8-এর মতোই শুধু sdk-helpers-এর নিজস্ব
// ফাংশন মক হয়; এই টেস্ট-গ্রাফ (createProduction → language_controller) কখনোই
// sdk-helpers.isRateLimitErrorText ব্যবহার করে না।
mock.module('@/lib/agent/sdk-helpers', () => ({
  transcribeBuffer: async () => {
    throw new Error('engine mock — must not be called by classification tests');
  },
  generateImageBuffer: async () => {
    throw new Error('engine mock — must not be called by classification tests');
  },
  imageSearchSdkFirst: async () => {
    throw new Error('engine mock');
  },
}));

// REAL modules — imported after the mocks
const {
  classifyIntent,
  specDraftFromIntent,
  buildIntentHintNote,
  unsupportedAlternativeText,
} = await import('@/lib/agent/intent/classifier');
const { validateSpec } = await import('@/lib/agent/capabilities');
const { createProduction } = await import('@/lib/agent/production/create');

const BN_MV_REQUEST = 'বাংলা একটি গান দিয়ে মিউজিক ভিডিও বানিয়ে দাও';
const CANARY = 'g8sX-SECRET-canary-x74';

beforeEach(() => {
  resetFakeDb();
});

// ------------------------------------------------------------
// শ্রেণিবিভাজন — ভাষা ও আকৃতির বৈচিত্র্য
// ------------------------------------------------------------

describe('REG-12: intent routing (Phase-4 B)', () => {
  test('REG-12a: Bengali music-video request → music_video, high confidence, fast-path eligible', () => {
    const c = classifyIntent(BN_MV_REQUEST);
    expect(c.category).toBe('music_video');
    expect(c.confidence).toBe('high');
    expect(c.fastPathEligible).toBe(true);
    expect(c.proposedWorkflow.productionType).toBe('music_video');
    expect(c.inputAssets.hasAudioUpload).toBe(false);
    // বার্তায় "গান দিয়ে" — গাওয়া-আউটপুট চাওয়া নয় (গাওয়া ≠ গান-উৎস)
    expect(c.extracted.wantsSungSong).not.toBe(true);
    expect(c.suggestedEngine).toBe('ai_diffusion');
  });

  test('REG-12b: English music-video request → music_video fast-path', () => {
    const c = classifyIntent('make me a music video please');
    expect(c.category).toBe('music_video');
    expect(c.confidence).toBe('high');
    expect(c.fastPathEligible).toBe(true);
  });

  test('REG-12c: mixed Bengali/English + Shorts format → extracted aspect/mood', () => {
    const c = classifyIntent('একটা romantic music video বানাও, vertical Shorts format, 30 সেকেন্ড');
    expect(c.category).toBe('music_video');
    expect(c.extracted.aspect).toBe('9:16');
    expect(c.extracted.mood).toBe('romantic');
    expect(c.extracted.durationSec).toBe(30);
    expect(c.fastPathEligible).toBe(true);
  });

  test('REG-12d: image generation request → image_generate with direct tool, no fast-path', () => {
    const c = classifyIntent('একটা সুন্দর পোস্টার এঁকে দাও');
    expect(c.category).toBe('image_generate');
    expect(c.proposedWorkflow.directTools).toContain('generate_image');
    expect(c.proposedWorkflow.productionType).toBe('image');
    expect(c.fastPathEligible).toBe(false); // ছোট কাজ — দ্রুত-পথ শুধু বড় কাজে
  });

  test('REG-12e: image edit — with upload supported, without upload asks for the file', () => {
    const withUpload = classifyIntent('ছবিটা এডিট করে দাও — পটভূমি সরাও', {
      uploads: [{ kind: 'image' }],
    });
    expect(withUpload.category).toBe('image_edit');
    expect(withUpload.capabilityStatus).toBe('supported');

    const noUpload = classifyIntent('ছবিটা এডিট করে দাও', {});
    expect(noUpload.category).toBe('image_edit');
    expect(noUpload.capabilityStatus).toBe('requires_clarification');
    expect(noUpload.missingFields.length).toBeGreaterThan(0);
    expect(noUpload.clarificationQuestion).toBeTruthy();
  });

  test('REG-12f: instrumental request → music_generate with honest procedural limitation', () => {
    const c = classifyIntent('একটা শান্ত ইন্সট্রুমেন্টাল সুর বানাও ৬০ সেকেন্ডের');
    expect(c.category).toBe('music_generate');
    expect(c.capabilityStatus).toBe('supported_with_limitations');
    expect(c.extracted.durationSec).toBe(60);
    const draft = specDraftFromIntent(c, 'ইন্সট্রুমেন্টাল');
    expect(draft?.audioOperation).toBe('instrumental');
  });

  test('REG-12g: Bengali short-film request → short_film fast-path', () => {
    const c = classifyIntent('একটা ছোট সিনেমা বানাও রহস্যময় গল্পের');
    expect(c.category).toBe('short_film');
    expect(c.proposedWorkflow.productionType).toBe('short_film');
    expect(c.fastPathEligible).toBe(true);
    expect(c.extracted.mood).toBe('suspense');
  });

  test('REG-12h: ordinary conversation/questions NEVER route to production (§B.11)', () => {
    for (const msg of [
      'তোমার নাম কি?',
      'মিউজিক ভিডিও কীভাবে বানানো হয়?',
      'how does a music video pipeline work?',
      'ধন্যবাদ!',
      'মিউজিক ভিডিও বানানো শেখাও',
    ]) {
      const c = classifyIntent(msg);
      expect(c.category).toBe('general_chat');
      expect(c.proposedWorkflow.productionType).toBeUndefined();
      expect(c.fastPathEligible).toBe(false);
    }
  });

  test('REG-12i: unrecognized message → ambiguous with one concise clarification', () => {
    const c = classifyIntent('qwerty zxcvb asdf');
    expect(c.category).toBe('unsupported_or_ambiguous');
    expect(c.capabilityStatus).toBe('requires_clarification');
    expect(c.clarificationQuestion).toBeTruthy();
    expect(c.fastPathEligible).toBe(false);
  });

  test('REG-12j: Bengali singing request → honestly unsupported, no fake singing', () => {
    const c = classifyIntent('গান গেয়ে শোনাও একটা');
    expect(c.category).toBe('unsupported_or_ambiguous');
    expect(c.capabilityStatus).toBe('unsupported');
    expect(c.extracted.wantsSungSong).toBe(true);
    const alt = unsupportedAlternativeText(c);
    expect(alt).toBeTruthy();
    expect(alt!).toContain('গাওয়া');
    expect(c.proposedWorkflow.productionType).toBeUndefined();
  });

  test('REG-12k: lip-sync request → honestly unsupported with alternative', () => {
    const c = classifyIntent('ভিডিওতে ঠোঁট মিলিয়ে কথা বলাও');
    expect(c.category).toBe('unsupported_or_ambiguous');
    expect(c.capabilityStatus).toBe('unsupported');
    expect(c.extracted.wantsLipSync).toBe(true);
    expect(unsupportedAlternativeText(c)).toContain('লিপ-সিঙ্ক');
  });

  test('REG-12l: music video expecting own song — no upload → no fast-path, ask; with upload → fast-path', () => {
    const noSong = classifyIntent('আমার গানটা দিয়ে মিউজিক ভিডিও বানিয়ে দাও', {});
    expect(noSong.category).toBe('music_video');
    expect(noSong.fastPathEligible).toBe(false);
    expect(noSong.missingFields).toContain('গানের অডিও ফাইল');
    expect(noSong.clarificationQuestion).toBeTruthy();

    const withSong = classifyIntent('আমার গানটা দিয়ে মিউজিক ভিডিও বানিয়ে দাও', {
      uploads: [{ kind: 'audio' }],
    });
    expect(withSong.fastPathEligible).toBe(true);
    expect(withSong.inputAssets.hasAudioUpload).toBe(true);
  });

  test('REG-12m: cloud-blocked context → honest cinematic_motion engine suggestion', () => {
    const c = classifyIntent('মিউজিক ভিডিও বানাও', { cloudBlocked: true });
    expect(c.suggestedEngine).toBe('cinematic_motion');
    expect(c.fastPathEligible).toBe(true); // লোকাল-বান্ধব পথ — দ্রুত-পথ বৈধ
  });

  test('REG-12n: sung-song inside music-video request stays music_video (honest note via wantsSungSong)', () => {
    const c = classifyIntent('গায়ক গাইছে এমন মিউজিক ভিডিও বানাও');
    expect(c.category).toBe('music_video');
    expect(c.extracted.wantsSungSong).toBe(true);
    expect(c.fastPathEligible).toBe(false); // গাওয়া-প্রত্যাশা → দ্রুত-পথ নয়
  });

  // ------------------------------------------------------------
  // খসড়া-স্পেক → প্রকৃত validateSpec রাউন্ডট্রিপ
  // ------------------------------------------------------------

  test('REG-12o: specDraftFromIntent output passes the REAL validateSpec', () => {
    for (const [msg, expectedType] of [
      [BN_MV_REQUEST, 'music_video'],
      ['একটা শর্ট ফিল্ম বানাও মজার গল্পে', 'short_film'],
      ['মোশন ভিডিও বানাও পাখি উড়ছে', 'motion_video'],
    ] as const) {
      const c = classifyIntent(msg);
      const draft = specDraftFromIntent(c, msg);
      expect(draft).not.toBeNull();
      const v = validateSpec(draft);
      expect(v.ok).toBe(true);
      expect(v.validated!.spec.type).toBe(expectedType);
    }
  });

  test('REG-12p: LLM hint note carries classification, never the raw message text', () => {
    const c = classifyIntent(` romantic music video বানাও ${CANARY}`);
    const hint = buildIntentHintNote(c);
    expect(hint).toContain('music_video');
    expect(hint).toContain('propose_job');
    // রেডাকশন-চুক্তি: হিন্টে বার্তার কাঁচা টেক্সট নয় — শুধু শ্রেণি/উদ্ধৃত-এনাম
    expect(hint).not.toContain(CANARY);
  });
});

// ------------------------------------------------------------
// ইন্টিগ্রেশন — শ্রেণিবিভাজন → খসড়া → শেয়ার্ড createProduction
// (এটিই দ্রুত-পথ ও ফলব্যাক উভয়ের একমাত্র প্রস্তাব-তৈরির পথ)
// ------------------------------------------------------------

describe('REG-12: classification → createProduction (shared path)', () => {
  test('REG-12q: fast-path composition creates awaiting_confirmation production via real shared path', async () => {
    const conv = seedConversation('conv-12q');
    seedMessage('conv-12q', 'user', BN_MV_REQUEST, { id: 'msg-12q' });

    const c = classifyIntent(BN_MV_REQUEST);
    const draft = specDraftFromIntent(c, BN_MV_REQUEST);
    expect(draft).not.toBeNull();

    const created = await createProduction(draft, conv.id);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('expected creation to succeed');

    const row = state().productions.get(created.productionId);
    expect(row).toBeDefined();
    expect(row!.status).toBe('awaiting_confirmation');
    expect(row!.type).toBe('music_video');
    const spec = JSON.parse(row!.specJson);
    expect(spec.type).toBe('music_video');
    // ভাষা-প্রচার: বাংলা বার্তা → bn (createProduction-এর সৎ নিয়ম)
    expect(spec.language).toBe('bn');
  });
});

// ------------------------------------------------------------
// (R-FIX-4) UI সততা-লক — C-F05/C-F06/O-3/O-4। REAL কম্পোনেন্ট-মডিউল থেকে
// পিওর একক (DOM রেন্ডার নয় — স্যুটে RTL নেই, তাই ParsedResult-পার্সার +
// লেবেল-মানচিত্র স্তরে চুক্তি আটকানো)।
// ------------------------------------------------------------

const {
  parseResultSummary,
  VIDEO_ENGINE_LABELS,
  VIDEO_ENGINE_NOTES,
} = await import('@/components/studio/production-card');
const { FILM_MODES } = await import('@/components/studio/studio-view');

describe('REG-12r: completed-result honest-status notes + UI honest labels (C-F05/C-F06/O-3/O-4)', () => {
  test('REG-12r-1 [C-F05]: parseResultSummary surfaces resultJson.notes (pipeline contract: string[]) — legacy results without notes parse unchanged, dirty entries are filtered, corrupt JSON stays null', () => {
    // পাইপলাইন-চুক্তি: MV-র সৎ নোট (যেমন "লিপ-সিঙ্ক নেই…") এখন
    // resultJson.notes: string[] হয়ে আসে — কার্ড সেটি রেন্ডার করে।
    const mvNote = 'লিপ-সিঙ্ক নেই — "গায়কের মুখ নড়ছে" দাবি করা হয় না।';
    const withNotes = parseResultSummary(
      JSON.stringify({ engine: 'ai_diffusion', aiShots: 4, notes: [mvNote] })
    );
    expect(withNotes).not.toBeNull();
    expect(withNotes!.notes).toEqual([mvNote]);
    expect(withNotes!.engine).toBe('ai_diffusion');

    // একাধিক নোটও ক্রম-সংরক্ষণে আসে
    const two = parseResultSummary(JSON.stringify({ notes: [mvNote, 'দ্বিতীয় সৎ নোট'] }));
    expect(two!.notes?.length).toBe(2);

    // প্রতিরোধমূলক: পুরনো ফলাফলে notes ক্ষেত্রই নেই — undefined থাকে, কার্ড
    // কিছুই রেন্ডার করে না (feature-detect)
    const legacy = parseResultSummary(JSON.stringify({ quality: 'মান: standard', partialNotes: ['x'] }));
    expect(legacy?.quality).toBe('মান: standard');
    expect(legacy?.notes).toBeUndefined();

    // প্রতিরোধমূলক: অ-স্ট্রিং/ফাঁকা এন্ট্রি ছাঁকা যায়, অ্যারে-নয় উপেক্ষিত
    const dirty = parseResultSummary(JSON.stringify({ notes: ['সৎ নোট', 42, null, '  '] }));
    expect(dirty!.notes).toEqual(['সৎ নোট']);
    const notArray = parseResultSummary(JSON.stringify({ notes: 'লিপ-সিঙ্ক নেই' }));
    expect(notArray!.notes).toBeUndefined();

    // বিকৃত/খালি JSON → null (পূর্বের সৎ আচরণ অক্ষত)
    expect(parseResultSummary('{broken')).toBeNull();
    expect(parseResultSummary(null)).toBeNull();
    expect(parseResultSummary(undefined)).toBeNull();
  });

  test('REG-12r-2 [O-3/O-4]: engine label carries no unverified quality adjective; the ai_diffusion note honestly admits the storyboard fallback path', () => {
    // O-3: "রিয়েলিস্টিক" বিশেষণটি অ-যাচাইকৃত ছিল — আর নেই; প্রকৃত
    // ইঞ্জিন-নাম + প্রকৃত খরচই থাকে
    expect(VIDEO_ENGINE_LABELS.ai_diffusion).not.toContain('রিয়েলিস্টিক');
    expect(VIDEO_ENGINE_LABELS.ai_diffusion).toContain('CogVideoX-3');
    expect(VIDEO_ENGINE_LABELS.ai_diffusion).toContain('ধীর');
    // cinematic_motion-এর সততা-লেবেল অক্ষত
    expect(VIDEO_ENGINE_LABELS.cinematic_motion).toContain('স্টোরিবোর্ড');

    // O-4: ai_diffusion নোট স্টোরিবোর্ড+ক্যামেরা-মোশন ফলব্যাক স্বীকার করে
    expect(VIDEO_ENGINE_NOTES.ai_diffusion).toContain('স্টোরিবোর্ড+ক্যামেরা-মোশনে নামতে পারে');
    expect(VIDEO_ENGINE_NOTES.ai_diffusion).toContain('CogVideoX-3');
    // cinematic_motion-এর নোট অক্ষত
    expect(VIDEO_ENGINE_NOTES.cinematic_motion).toContain('ডিফিউশন ভিডিও-মডেল নয়');
  });

  test('REG-12r-3 [C-F06]: the film-dialogue mode card carries the explicit no-mouth-sync statusNote its siblings have', () => {
    const dialogue = FILM_MODES.find(m => m.id === 'film-dialogue');
    expect(dialogue).toBeDefined();
    expect(dialogue!.statusNote).toBe('সংলাপ-কণ্ঠ ও সাবটাইটেল — ঠোঁট-সিঙ্ক নয়');
    // ভাইবোদের স্বীকারোক্তি অক্ষত — সব কথা-ঘন মোডে একই সততা
    const short = FILM_MODES.find(m => m.id === 'film-short');
    expect(short!.statusNote).toContain('ঠোঁট-সিঙ্ক নয়');
    const mv = FILM_MODES.find(m => m.id === 'film-music-video');
    expect(mv!.statusNote).toContain('লিপ-সিঙ্ক নেই');
  });
});
