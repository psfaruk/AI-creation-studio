// পুনঃব্যবহারযোগ্য ব্যাকটেস্ট: ৪২৯-উইন্ডো চলাকালীন মিউজিক ভিডিও/শর্ট ফিল্ম প্রোডাকশন
// ব্যবহার: bun run scripts/backtest-productions.ts [mv|sf|both]
// আজকের ব্যাকটেস্ট (৪২৯-উইন্ডো চলাকালীন): POST /api/productions → confirm → সমাপ্তি-পর্যন্ত পোল → ffprobe যাচাই
const BASE = 'http://localhost:3000';

async function jfetch(url: string, opts: RequestInit = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function runProduction(spec: any, label: string) {
  console.log(`\n===== ${label} =====`);
  const t0 = Date.now();

  // ১) তৈরি
  const created = await jfetch(`${BASE}/api/productions`, {
    method: 'POST',
    body: JSON.stringify({ spec }),
  });
  if (created.status !== 200) {
    console.log(`CREATE_FAIL ${created.status}`, JSON.stringify(created.data).slice(0, 300));
    return null;
  }
  const prod = created.data.production;
  const pid = prod.id;
  console.log(`CREATED ${pid} status=${prod.status} steps=${(created.data.steps || []).length} quota=${JSON.stringify(created.data.quota)}`);
  if (Array.isArray(created.data.notes) && created.data.notes.length) {
    console.log(`NOTES: ${created.data.notes.join(' | ').slice(0, 400)}`);
  }
  if (Array.isArray(created.data.adjustments) && created.data.adjustments.length) {
    console.log(`ADJUSTMENTS: ${created.data.adjustments.join(' | ').slice(0, 400)}`);
  }

  // ২) নিশ্চিতকরণ
  const confirmed = await jfetch(`${BASE}/api/productions/${pid}/confirm`, { method: 'POST' });
  console.log(`CONFIRM ${confirmed.status}`, JSON.stringify(confirmed.data).slice(0, 200));

  // ৩) সমাপ্তি-পর্যন্ত পোল (সর্বোচ্চ ৯ মিনিট)
  let final: any = null;
  const deadline = Date.now() + 9 * 60_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    const cur = await jfetch(`${BASE}/api/productions/${pid}`);
    const p = cur.data?.production ?? cur.data;
    if (!p) { console.log(`POLL_ERR ${cur.status}`); break; }
    const stepsDone = (p.steps || []).filter((s: any) => s.status === 'done').length;
    const stepsTotal = (p.steps || []).length;
    process.stdout.write(`\rPOLL ${Math.round((Date.now()-t0)/1000)}s status=${p.status} steps=${stepsDone}/${stepsTotal}${p.progressNote ? ' | ' + String(p.progressNote).slice(0,60) : ''}   `);
    if (['completed', 'failed', 'partial', 'cancelled'].includes(p.status)) {
      final = p;
      break;
    }
  }
  console.log('');
  if (!final) { console.log('TIMEOUT_9MIN'); return null; }

  console.log(`FINAL status=${final.status} elapsed=${Math.round((Date.now()-t0)/1000)}s`);
  if (final.status === 'completed' || final.status === 'partial') {
    const pn = final.partialNotes || final.result?.partialNotes || [];
    if (pn.length) console.log(`PARTIAL_NOTES (${pn.length}):`); for (const n of pn) console.log('  *', String(n).slice(0, 140));
    const arts = final.artifacts || [];
    const mp4s = arts.filter((a: any) => String(a.kind || '').includes('video') || String(a.path || '').endsWith('.mp4'));
    console.log(`ARTIFACTS total=${arts.length}`);
    for (const a of arts) {
      console.log(`  - kind=${a.kind} engine=${a.engine || ''} ${String(a.title || '').slice(0, 70)}${a.honestLabel ? ' [হিস্টি-লেবেল: ' + String(a.honestLabel).slice(0, 60) + ']' : ''}`);
      if (a.path) console.log(`    path=${a.path}`);
    }
    const vid = mp4s[0] || arts.find((a: any) => String(a.path || '').endsWith('.mp4'));
    return vid?.path || null;
  } else {
    console.log(`FAILURE: ${JSON.stringify(final.failureReason || final.error || 'unknown').slice(0, 400)}`);
    return null;
  }
}

async function main() {
  const which = process.argv[2] || 'both';

  if (which === 'mv' || which === 'both') {
    const mvPath = await runProduction({
      type: 'music_video',
      title: 'বর্ষার রাতের মেলোডি',
      idea: 'বৃষ্টিভেজা এক বর্ষার সন্ধ্যায় নদীর পাড়ে একা হাঁটা — বিষণ্ণ কিন্তু সুন্দর মুহূর্তগুলো',
      mood: 'sad',
      durationSec: 30,
      quality: 'draft',
      aspect: '9:16',
      fps: 30,
      language: 'bn',
      videoEngine: 'cinematic_motion',
    }, 'মিউজিক ভিডিও (বর্ষার রাতের মেলোডি)');
    console.log(`MV_RESULT_PATH=${mvPath || 'NONE'}`);
  }

  if (which === 'sf' || which === 'both') {
    const sfPath = await runProduction({
      type: 'short_film',
      title: 'শেষ চিঠি',
      story: 'এক বৃদ্ধ ডাকঘরের কেরানি রহমত আলী চল্লিশ বছর ধরে চিঠি বিতরণ করেন। তার শেষ দিনে একটি ঠিকানাহীন চিঠি তার হাতে জমা হয়। চিঠিটি কার তা খুঁজতে গিয়ে সে শহরের নতুন প্রজন্মের সাথে অপ্রত্যাশিত বন্ধুত্ব গড়ে তোলে। অবশেষে চিঠিটি তার নিজের লেখা — চল্লিশ বছর আগের নিজের কাছে লেখা চিঠি বলে জানতে পারেন।',
      durationSec: 36,
      quality: 'draft',
      aspect: '16:9',
      fps: 24,
      language: 'bn',
      videoEngine: 'cinematic_motion',
      filmMode: 'short_film',
    }, 'শর্ট ফিল্ম (শেষ চিঠি)');
    console.log(`SF_RESULT_PATH=${sfPath || 'NONE'}`);
  }
  process.exit(0);
}
main();
