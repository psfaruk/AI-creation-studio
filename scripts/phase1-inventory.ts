// Phase-1 Task 6: read-only tool inventory dump (no network, no db writes)
import { TOOLS, CORE_TOOLS, toolParityReport } from '../src/lib/agent/registry';
import { IMAGE_TOOLS } from '../src/lib/agent/tools/image';
import { AUDIO_TOOLS } from '../src/lib/agent/tools/audio';
import { VIDEO_TOOLS } from '../src/lib/agent/tools/video';
import { PRODUCTION_TOOLS } from '../src/lib/agent/tools/production';
import { TOOL_CATALOG } from '../src/lib/types';

const inventory = TOOLS.map((t) => ({
  name: t.name,
  timeoutMs: t.timeoutMs,
  purpose: t.usage.split('—')[0].trim(),
}));
const counts = {
  core: CORE_TOOLS.length,
  image: IMAGE_TOOLS.length,
  audio: AUDIO_TOOLS.length,
  video: VIDEO_TOOLS.length,
  production: PRODUCTION_TOOLS.length,
  total: TOOLS.length,
  catalog: TOOL_CATALOG.length,
};
console.log(JSON.stringify({ counts, parity: toolParityReport(TOOL_CATALOG), inventory }, null, 1));
process.exit(0);
