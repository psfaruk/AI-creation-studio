// ============================================================
// (অডিট §G) ক্রস-প্ল্যাটফর্ম standalone-প্রস্তুতি — `cp -r`-এর বদলে
// Node.js fs.cpSync। Windows PowerShell/CMD, macOS, Linux — সবখানে চলে।
// ব্যবহার: `npm run build` (next build-এর পরে স্বয়ংক্রিয়ভাবে চলে)
// ============================================================
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const standalone = join(root, '.next', 'standalone');

if (!existsSync(standalone)) {
  console.error('[prepare-standalone] .next/standalone পাওয়া যায়নি — আগে `next build` চালান।');
  process.exit(1);
}

// .next/static → .next/standalone/.next/static
mkdirSync(join(standalone, '.next'), { recursive: true });
cpSync(join(root, '.next', 'static'), join(standalone, '.next', 'static'), { recursive: true });
console.log('[prepare-standalone] .next/static কপি সম্পন্ন');

// public → .next/standalone/public
if (existsSync(join(root, 'public'))) {
  cpSync(join(root, 'public'), join(standalone, 'public'), { recursive: true });
  console.log('[prepare-standalone] public কপি সম্পন্ন');
} else {
  console.log('[prepare-standalone] public ফোল্ডার নেই — স্কিপ');
}

console.log('[prepare-standalone] প্রস্তুত — `npm start` দিয়ে চালান (PORT এনভ-ভ্যারিয়েবলে পোর্ট দিন)');
