// ভিত্তি-যাচাই — নতুন ইঞ্জিনগুলো লোকালভাবে কাজ করে কি না (কোনো API-খরচ নেই)
// চালাও: cd /home/z/my-project && bun tmp-task2d/foundation-smoke.ts
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { synthesizeInstrumental, validateInstrumental, detectMoodFromText, moodLabel } from '../src/lib/agent/audio/music_engine';
import { planSoundscape, renderSoundscapeBed, mixSoundLayers, SOUND_LAYERS } from '../src/lib/agent/audio/sound_design';
import { detectLanguage, estimateSpeechSec, resolveVoice, LANGUAGE_PROFILES, transcriptSimilarity } from '../src/lib/agent/audio/language_controller';
import { capabilityRouterTableBn, routeVideoRequest } from '../src/lib/agent/video/capability_router';
import { lipSyncCapabilityReport } from '../src/lib/agent/video/lip_sync_module';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('=== ১. মিউজিক ইঞ্জিন (প্রসিডিউরাল) ===');
for (const mood of ['sad', 'romantic', 'joyful', 'suspense', 'action', 'peaceful'] as const) {
  const r = await synthesizeInstrumental({ mood, durationSec: 20, tempoBpm: mood === 'action' ? 150 : undefined });
  const v = await validateInstrumental(r.buffer, r.meta);
  const tmp = mkdtempSync('mus-');
  const f = tmp + '/m.wav';
  writeFileSync(f, r.buffer);
  const dur = execFileSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
  check(
    `${moodLabel(mood)} (${mood})`,
    r.buffer.length > 100_000 && Math.abs(Number(dur) - 20) < 1.5 && v.ok,
    `${r.buffer.length}B, ${dur}s, ${r.meta.tempoBpm}BPM, ${r.meta.beatsSec.length} বিট, বৈধ=${v.ok}${v.issues.length ? ' [' + v.issues.join('; ') + ']' : ''}`
  );
  rmSync(tmp, { recursive: true, force: true });
}
check('মুড-শনাক্তকরণ: "বিষণ্ণ বিদায়"', detectMoodFromText('বিদায়ের কান্না') === 'sad');
check('মুড-শনাক্তকরণ: rain→peaceful-ish', detectMoodFromText('শান্ত ভোরে বৃষ্টির পর') !== null);

console.log('=== ২. সাউন্ড-ডিজাইন ইঞ্জিন ===');
const plan1 = planSoundscape('বৃষ্টিভেজা সন্ধ্যায় চায়ের দোকানে দুই বন্ধু কথা বলছে, চায়ের কাপ তুলে চুমুক দিচ্ছে');
check('দৃশ্য-পরিকল্পনা: বৃষ্টি+চায়ের দোকান', plan1.ambience.includes('rain') && plan1.ambience.includes('cafe'), JSON.stringify(plan1.ambience));
check('ফোলে: কাপ', plan1.foley.includes('cup_place'), JSON.stringify(plan1.foley));
const bed = renderSoundscapeBed(plan1, 15);
check('A2+A3 বেড রেন্ডার', bed.length > 100_000, `${bed.length}B WAV`);
const plan2 = planSoundscape('রাতের শহরের রাস্তায় হাঁটছে');
check('দৃশ্য-পরিকল্পনা: রাত+শহর', plan2.ambience.includes('night') || plan2.ambience.includes('city_traffic'), JSON.stringify(plan2.ambience));
check('৫-স্তর সংজ্ঞা', SOUND_LAYERS.length === 5);

// মিক্সার পরীক্ষা: সংশ্লেষিত বেড + প্রসিডিউরাল মিউজিক → ducking-সহ মাস্টার
const tmp = mkdtempSync('mix-');
const ambPath = tmp + '/amb.wav';
const musPath = tmp + '/mus.wav';
writeFileSync(ambPath, renderSoundscapeBed(planSoundscape('বৃষ্টি'), 12));
writeFileSync(musPath, (await synthesizeInstrumental({ mood: 'romantic', durationSec: 12 })).buffer);
const mixReport = await mixSoundLayers(
  [
    { layer: 'A2_ambience', file: ambPath },
    { layer: 'A4_music', file: musPath },
  ],
  tmp + '/mix.wav'
);
check('§৮ মিক্সার (A2+A4, ডাকিং-নিয়মসহ)', mixReport.durationSec > 10 && mixReport.peakDb !== undefined, `দৈর্ঘ্য=${mixReport.durationSec}s, পিক=${mixReport.peakDb}dB, LUFS=${mixReport.loudnessLufs}, বৈধ=${mixReport.ok}`);
rmSync(tmp, { recursive: true, force: true });

console.log('=== ৩. ভাষা-নিয়ন্ত্রক (বিশুদ্ধ ফাংশন) ===');
check('বাংলা শনাক্তকরণ', detectLanguage('আমি বাংলায় কথা বলি').language === 'bn');
check('ইংরেজি শনাক্তকরণ', detectLanguage('I speak English').language === 'en');
check('মিশ্র শনাক্তকরণ', detectLanguage('আমি English বলি').language === 'mixed');
check('বাংলা কণ্ঠ-নির্বাচন jam', resolveVoice('bn') === 'jam');
check('ইংরেজি কণ্ঠ-নির্বাচন jam', resolveVoice('en') === 'jam');
check('অবৈধ কণ্ঠ → প্রোফাইল-ডিফল্ট', resolveVoice('bn', 'tongtong') === 'jam');
check('দৈর্ঘ্য-আনুমান', estimateSpeechSec('আমি আজ চায়ের দোকানে বসেছিলাম', 'bn') > 2);
const sim = transcriptSimilarity('I sat at a tea stall', 'i sat at a tea stall this morning', 'en');
check('ইংরেজি সাদৃশ্য-গণনা', sim > 0.5, `${(sim * 100).toFixed(0)}%`);
check('বাংলা সাদৃশ্য (অনুপাত-ভিত্তিক)', transcriptSimilarity('বৃষ্টি', 'বৃষ্টি পড়ছে', 'bn') > 0.5);
check('ভাষা-প্রোফাইল সৎ-নোট', LANGUAGE_PROFILES.bn.notes.length >= 3);

console.log('=== ৪. Capability Router (§৪.৩) ===');
const table = capabilityRouterTableBn();
check('৭টি রুট', table.length === 7);
check('ছবি→ভিডিও রুট AI', routeVideoRequest('image_to_video').realAiGeneration === true);
check('লিপ-সিঙ্ক রুট অবরুদ্ধ', routeVideoRequest('lip_sync').status === 'unavailable');
check('এডিট-কাট রুট প্রসেসিং', routeVideoRequest('edit_cut').realAiGeneration === false);

console.log('=== ৫. লিপ-সিঙ্ক সৎ-প্রতিবেদন (§৫) ===');
const ls = lipSyncCapabilityReport();
check('অবরুদ্ধ ঘোষণা', ls.available === false && ls.talking.status === 'unavailable');
check('৭-ধাপ ওয়ার্কফ্লো', ls.talking.steps.length === 7);
check('গান-গাওয়ার অতিরিক্ত চাহিদা', ls.singing.extra.length >= 5);
check('সম্মতি-নিয়ম', ls.consentRules.length >= 3);

console.log(`\nফলাফল: ${pass} পাস, ${fail} ব্যর্থ`);
process.exit(fail > 0 ? 1 : 0);
