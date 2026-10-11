// ============================================================
// Sprint-2 Smoke — §১০ রিট্রাই-নীতি + SDK-প্রথম ছবি-সার্চ (Task 2-b)
//  (ক) withRetry-র জিটার/ব্যাকঅফ আচরণ (মক ফাংশন — কোনো API কল নয়)
//  (খ) নিরন্তর ৪২৯-এ TemporarilyUnavailableError + TEMPORARILY_UNAVAILABLE: প্রিফিক্স
//  (গ) ৫xx-নিঃশেষে সাধারণ সৎ-ব্যর্থতা (TemporarilyUnavailableError নয়)
//  (ঘ) Retry-After সম্মান (সেকেন্ড-সংখ্যা, headers-বস্তু, HTTP-date)
//  (ঙ) imageSearchSdkFirst — একটি বাস্তব কল, via:'sdk' প্রত্যাশিত
// চালানো: bun tmp-sprint2/retry-policy-smoke.ts
// ============================================================
import {
  withRetry,
  TemporarilyUnavailableError,
  parseRetryAfterMs,
  fullJitterDelayMs,
  imageSearchSdkFirst,
} from '../src/lib/agent/sdk-helpers';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log('\n[ক] withRetry — full-jitter এক্সপোনেনশিয়াল ব্যাকঅফ (মক ৪২৯):');
  {
    const callTimes: number[] = [];
    const delays: number[] = [];
    let calls = 0;
    try {
      await withRetry(
        async () => {
          callTimes.push(Date.now());
          calls++;
          if (calls > 1) delays.push(callTimes[calls - 1] - callTimes[calls - 2]);
          throw new Error('API request failed with status 429: Too many requests');
        },
        'মক-৪২৯',
        4,
        100,
        { maxDelayMs: 400 }
      );
    } catch {
      // প্রত্যাশিত — নিচে (খ)-তে আলাদা যাচাই
    }
    check('ঠিক ৪টি চেষ্টা হয়েছে', calls === 4, `calls=${calls}`);
    check('৩টি ব্যাকঅফ-ব্যবধান রেকর্ড হয়েছে', delays.length === 3, `delays=${delays.length}`);
    // attempt-0: [50,100], attempt-1: [50,200], attempt-2: [50,400] (+ সামান্য ওভারহেড)
    check('প্রতিটি বিলম্ব ≥৪৫ms (floor=baseMs/2)', delays.every(d => d >= 45), JSON.stringify(delays));
    check('প্রতিটি বিলম্ব ≤৪৫০ms (ছাদ=৪০০ms + ওভারহেড)', delays.every(d => d <= 450), JSON.stringify(delays));
  }

  console.log('\n[খ] নিরন্তর ৪২৯ — TemporarilyUnavailableError:');
  {
    let calls = 0;
    let err: any = null;
    try {
      await withRetry(
        async () => {
          calls++;
          throw new Error('API request failed with status 429: {"error":"Too many requests, please try again later"}');
        },
        'TTS-মক',
        3,
        20,
        { maxDelayMs: 60 }
      );
    } catch (e) {
      err = e;
    }
    check('ত্রুটি TemporarilyUnavailableError-এর ইনস্ট্যান্স', err instanceof TemporarilyUnavailableError);
    check('বার্তা TEMPORARILY_UNAVAILABLE: দিয়ে শুরু', String(err?.message ?? '').startsWith('TEMPORARILY_UNAVAILABLE:'), String(err?.message ?? '').slice(0, 80));
    check('বার্তায় "রেট-লিমিট" উল্লেখ (লাইসেন্স-সমস্যা নয়)', /রেট-লিমিট/.test(String(err?.message ?? '')));
    check('সর্বোচ্চ চেষ্টার পরই ছুড়েছে', calls === 3, `calls=${calls}`);
  }

  console.log('\n[গ] নিরন্তর ৫০৩ — সাধারণ সৎ-ব্যর্থতা (৪২৯-রায় নয়):');
  {
    let err: any = null;
    try {
      await withRetry(
        async () => {
          throw new Error('API request failed with status 503: unavailable');
        },
        'মক-৫০৩',
        2,
        20,
        { maxDelayMs: 50 }
      );
    } catch (e) {
      err = e;
    }
    check('TemporarilyUnavailableError নয়', !(err instanceof TemporarilyUnavailableError));
    check('পুরনো বার্তা-ফরম্যাটে ("সব পুনঃচেষ্টা ব্যর্থ")', /সব পুনঃচেষ্টা ব্যর্থ/.test(String(err?.message ?? '')));
  }

  console.log('\n[ঘ] Retry-After পার্সিং ও সম্মান:');
  {
    check('err.retryAfter (সেকেন্ড-সংখ্যা 0.12 → ~120ms)', Math.abs((parseRetryAfterMs(Object.assign(new Error('429'), { retryAfter: 0.12 })) ?? -1) - 120) < 15);
    check('headers["retry-after"]="0.2" → ~200ms', Math.abs((parseRetryAfterMs(Object.assign(new Error('429'), { headers: { 'retry-after': '0.2' } })) ?? -1) - 200) < 15);
    check('বার্তা-টেক্সট "Retry-After: 30" → 30000ms', parseRetryAfterMs(new Error('429 … Retry-After: 30 seconds')) === 30000);
    const httpDate = new Date(Date.now() + 1500).toUTCString(); // পূর্ণ-সেকেন্ড নির্ভুলতা (toUTCString ms কাটে)
    const ra = parseRetryAfterMs(Object.assign(new Error('429'), { headers: { 'retry-after': httpDate } })) ?? -1;
    check('HTTP-date → ~১.৫ সে. (০.৫–২.৫ সে.-এ)', ra >= 500 && ra <= 2500, `ra=${ra}`);
    check('Retry-After না থাকলে null', parseRetryAfterMs(new Error('429 Too many requests')) === null);
    // Retry-After সম্মান: বিলম্ব ≈ সেট করা মান
    const t: number[] = [];
    let calls = 0;
    try {
      await withRetry(
        async () => {
          t.push(Date.now());
          calls++;
          throw Object.assign(new Error('429 Too many requests'), { retryAfter: 0.15 });
        },
        'মক-RA',
        3,
        50,
        { maxDelayMs: 1000 }
      );
    } catch {
      // প্রত্যাশিত
    }
    const d = t.length >= 2 ? t[1] - t[0] : -1;
    check('৪২৯-ব্যাকঅফে Retry-After (১৫০ms) মানা হয়েছে', d >= 140 && d <= 400, `delay=${d}ms, calls=${calls}`);
  }

  console.log('\n[ঙ] fullJitterDelayMs — সীমা-সম্মতি (১০০০ নমুনা):');
  {
    let okFloor = true;
    let okCap = true;
    for (let i = 0; i < 1000; i++) {
      const d = fullJitterDelayMs(60000, 3, 90000);
      if (d < 30000) okFloor = false;   // floor = baseMs/2
      if (d > 90000) okCap = false;     // ছাদ = ৯০ সে.
    }
    check('সব নমুনা [৩০ সে., ৯০ সে.]-এ', okFloor && okCap);
    // এক্সপোনেনশিয়াল-ছাদ বৃদ্ধি: attempt 0-এর ছাদ < attempt 2-এর ছাদ
    const cap0 = Math.max(...Array.from({ length: 200 }, () => fullJitterDelayMs(100, 0, 90000)));
    const cap2 = Math.max(...Array.from({ length: 200 }, () => fullJitterDelayMs(100, 2, 90000)));
    check('ছাদ এক্সপোনেনশিয়ালভাবে বাড়ে (a0 < a2)', cap0 < cap2, `cap0=${cap0} cap2=${cap2}`);
  }

  console.log('\n[চ] imageSearchSdkFirst — একটি বাস্তব SDK কল:');
  {
    const t0 = Date.now();
    try {
      const out = await imageSearchSdkFirst('red rose flower closeup', 3);
      check("via === 'sdk'", out.via === 'sdk', `via=${out.via}`);
      check('কমপক্ষে ১টি ফলাফল', out.results.length >= 1, `count=${out.results.length}`);
      check('প্রতিটি ফলাফলে url (string) আছে', out.results.every(r => typeof r.url === 'string' && r.url.length > 0));
      console.log(`    (${out.results.length} ফলাফল, ${Date.now() - t0}ms — প্রথমটি: ${out.results[0]?.url?.slice(0, 70) ?? ''}…)`);
    } catch (err: any) {
      check('imageSearchSdkFirst সফল', false, String(err?.message ?? err).slice(0, 200));
    }
  }

  console.log(`\nফলাফল: ${pass} পাস, ${fail} ব্যর্থ\n`);
  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('ধূম-স্ক্রিপ্ট fatal:', err);
  process.exit(1);
});
