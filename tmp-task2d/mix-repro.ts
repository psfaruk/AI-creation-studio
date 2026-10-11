import { synthesizeInstrumental } from '../src/lib/agent/audio/music_engine';
import { planSoundscape, renderSoundscapeBed, mixSoundLayers, DEFAULT_MIX_RULES } from '../src/lib/agent/audio/sound_design';
import { synthesizeSpeech } from '../src/lib/agent/sdk-helpers';
import { writeFileSync, mkdtempSync } from 'fs';
import path from 'path';

const tmp = mkdtempSync('mixrepro-');
// A1 সংলাপ (TTS), A2 বেড, A4 মিউজিক, A5 বর্ণনা — ৪-স্তর ডাকিং-পথ
const dlg = await synthesizeSpeech('This is a dialogue test line for mixing.', 'jam', 1);
writeFileSync(path.join(tmp, 'a1.wav'), dlg.buffer);
writeFileSync(path.join(tmp, 'a2.wav'), renderSoundscapeBed(planSoundscape('rain at night city'), 12));
writeFileSync(path.join(tmp, 'a4.wav'), (await synthesizeInstrumental({ mood: 'romantic', durationSec: 12 })).buffer);
const nar = await synthesizeSpeech('Narration track for the film.', 'jam', 1);
writeFileSync(path.join(tmp, 'a5.wav'), nar.buffer);

try {
  const r = await mixSoundLayers(
    [
      { layer: 'A1_dialogue', file: path.join(tmp, 'a1.wav'), startSec: 0 },
      { layer: 'A2_ambience', file: path.join(tmp, 'a2.wav'), startSec: 0, gainDbOverride: -17 },
      { layer: 'A4_music', file: path.join(tmp, 'a4.wav'), startSec: 0 },
      { layer: 'A5_narration', file: path.join(tmp, 'a5.wav'), startSec: 8 },
    ],
    path.join(tmp, 'mix.wav'),
    DEFAULT_MIX_RULES
  );
  console.log('মিক্স সফল:', JSON.stringify(r));
} catch (err: any) {
  console.log('মিক্স ব্যর্থ:', String(err.message).slice(0, 900));
}
