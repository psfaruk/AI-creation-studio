// লাইসেন্স-যাচাই (§২): নির্ভরযোগ্য source থেকে মডেল-লাইসেন্স নিশ্চিত করা
import ZAI from 'z-ai-web-dev-sdk';

async function main() {
  const zai = await ZAI.create();
  const queries = [
    'MusicGen audiocraft model weights license CC-BY-NC facebookresearch',
    'YuE lyrics-to-song model GitHub license Apache CC-BY-NC weights',
    'Wan2.2 video generation model GitHub license Apache 2.0',
  ];
  for (const q of queries) {
    try {
      const results = await zai.functions.invoke('web_search', { query: q, num: 4 });
      console.log(`\n=== ${q} ===`);
      for (const r of results) {
        console.log(`- [${r.host_name}] ${r.name}\n  ${r.url}\n  ${String(r.snippet ?? '').slice(0, 220)}`);
      }
    } catch (err: any) {
      console.log(`\n=== ${q} ===\n  SEARCH-ERROR: ${String(err?.message ?? err).slice(0, 150)}`);
    }
  }
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
