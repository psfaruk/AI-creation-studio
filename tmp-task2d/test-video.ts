// tmp-task2d/test-video.ts — Task 2-d-র আসল টুল টেস্ট (bun দিয়ে সরাসরি)
// ১. generate_video (৬ সে., ২ শট)  ২. ফ্রেম-এক্সট্র্যাক্ট → animate_image
// ৩. validate_video ×2  ৪. process_video trim  ৫. generate_subtitles  ৬. lip_sync gating
// চালাও: cd /home/z/my-project && bun tmp-task2d/test-video.ts
import path from 'path';
import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import { db } from '../src/lib/db';
import { VIDEO_TOOLS } from '../src/lib/agent/tools/video';
import { saveArtifactFile } from '../src/lib/agent/storage';
import { runFfmpeg } from '../src/lib/media/ffmpeg';

function getTool(name: string) {
  const t = VIDEO_TOOLS.find(x => x.name === name);
  if (!t) throw new Error(`টুল পাওয়া যায়নি: ${name}`);
  return t;
}

const conv = await db.conversation.create({ data: { title: 'task-2d টুল টেস্ট' } });
const run = await db.agentRun.create({ data: { conversationId: conv.id, status: 'running' } });
console.log('কথোপকথন:', conv.id, '| রান:', run.id);
const ctx = { conversationId: conv.id, runId: run.id, toolCallId: 'test-tc' };

try {
  // ---------- ১. generate_video ----------
  console.log('\n=== generate_video (৬ সে., ২ শট, 16:9, ambient) ===');
  const t0 = Date.now();
  const gv = getTool('generate_video');
  const gvOut = await gv.execute(
    {
      idea: 'A serene river at dawn with mist over the water, then a fisherman casting a net from a wooden boat',
      durationSec: 6,
      aspect: '16:9',
      sound: 'ambient',
    },
    ctx
  );
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`, gvOut.summary);
  console.log('   resultJson:', gvOut.resultJson.slice(0, 220));
  const gvArtifactId = (JSON.parse(gvOut.resultJson) as { artifactId: string }).artifactId;

  // ---------- ২. ফ্রেম এক্সট্র্যাক্ট → চিত্র artifact → animate_image ----------
  console.log('\n=== animate_image (জেনারেট হওয়া ভিডিওর ফ্রেম থেকে) ===');
  const vid = await db.artifact.findUnique({ where: { id: gvArtifactId } });
  const tmp = await mkdtemp(path.join(os.tmpdir(), 't2d-'));
  const framePath = path.join(tmp, 'frame.png');
  await runFfmpeg(['-i', vid!.storagePath!, '-frames:v', '1', framePath], { label: 'ফ্রেম এক্সট্র্যাক্ট' });
  const frameBuf = await readFile(framePath);
  const { storagePath: frameStore } = await saveArtifactFile(frameBuf, 'png');
  const frameArt = await db.artifact.create({
    data: {
      conversationId: conv.id,
      runId: run.id,
      origin: 'tool',
      kind: 'image',
      mimeType: 'image/png',
      fileName: 'extracted-frame.png',
      size: frameBuf.length,
      storagePath: frameStore,
    },
  });
  const ai = getTool('animate_image');
  const aiOut = await ai.execute({ image: frameArt.id, durationSec: 4, cameraMove: 'pan_right', fps: 24 }, ctx);
  console.log(aiOut.summary);
  const aiArtifactId = (JSON.parse(aiOut.resultJson) as { artifactId: string }).artifactId;

  // ---------- ৩. validate_video ×2 ----------
  console.log('\n=== validate_video ===');
  const vv = getTool('validate_video');
  const v1 = await vv.execute({ video: gvArtifactId, expectedFps: 30 }, ctx);
  console.log('গেন-ভিডিও:', v1.summary);
  const v2 = await vv.execute({ video: aiArtifactId, expectedFps: 24 }, ctx);
  console.log('অ্যানিমেট:', v2.summary);

  // ---------- ৪. process_video (trim — কোনো AI নয়) ----------
  console.log('\n=== process_video trim (২ সে.) ===');
  const pv = getTool('process_video');
  const pvOut = await pv.execute({ video: gvArtifactId, op: 'trim', startSec: 0, endSec: 2 }, ctx);
  console.log(pvOut.summary);

  // ---------- ৫. generate_subtitles ----------
  console.log('\n=== generate_subtitles ===');
  const gs = getTool('generate_subtitles');
  const gsOut = await gs.execute(
    { text: 'ভোরের নদীতে কুয়াশা জমেছিল। জেলে নৌকা থেকে জাল ফেলল। রোদ উঠলে নদী সোনালি হয়ে উঠল।', totalDurationSec: 10 },
    ctx
  );
  console.log(gsOut.summary);
  const srtArt = (JSON.parse(gsOut.resultJson) as { artifactId: string }).artifactId;
  const srtRow = await db.artifact.findUnique({ where: { id: srtArt } });
  const srtText = (await readFile(srtRow!.storagePath!)).toString('utf-8');
  console.log('--- SRT (প্রথম ২ কিউ) ---');
  console.log(srtText.split('\n\n').slice(0, 2).join('\n\n'));

  // ---------- ৬. lip_sync gating ----------
  console.log('\n=== lip_sync (gated — সৎ ত্রুটি প্রত্যাশিত) ===');
  const ls = getTool('lip_sync');
  try {
    await ls.execute({ video: gvArtifactId }, ctx);
    console.log('!! ত্রুটি আসেনি — সমস্যা!');
  } catch (err) {
    console.log('সঠিকভাবে গেটেড:', (err as Error).message.slice(0, 130) + '…');
  }

  console.log('\n=== সব টুল-টেস্ট সম্পন্ন ✅ ===');
  console.log('গেন-ভিডিও artifact:', gvArtifactId);
  console.log('অ্যানিমেট artifact:', aiArtifactId);
} finally {
  const arts = await db.artifact.findMany({ where: { conversationId: conv.id } });
  for (const a of arts) {
    if (a.storagePath) await rm(a.storagePath, { force: true }).catch(() => {});
  }
  await db.conversation.delete({ where: { id: conv.id } }).catch(() => {});
  console.log('\nটেস্ট-ডেটা পরিষ্কার করা হয়েছে');
}
