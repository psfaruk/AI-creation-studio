// ============================================================
// bn-text-normalizer.ts — বাংলা TTS-বান্ধব টেক্সট-নর্মালাইজার।
// (নতুন পরিকল্পনা §৪ — তৃতীয় ধাপ: বাংলা TTS ঠিক করা)
//
// উদ্দেশ্য: ব্যবহারকারীর লেখা বাংলা টেক্সটকে "যন্ত্র-বান্ধব" করা —
// সংখ্যা/তারিখ/সময় শব্দে, ইংরেজি শব্দের ধ্বন্যাত্মক রূপ,
// প্রচলিত-উচ্চারণ-সমন্বয়, যতিচিহ্ন-পরিচ্ছন্নতা।
//
// ফাংশনটি শুদ্ধ (pure): কোনো IO নেই, কোনো ঘড়ি/ভেদাঙ্ক নেই —
// একই ইনপুট সবসময় একই আউটপুট দেয় (দ্রুত ও নির্ধারক)।
//
// অভ্যন্তরীণ ধাপ-ক্রম (টীকা: তারিখ/সময়-প্যাটার্ন সংখ্যা-রূপান্তরের
// *আগেই* মেলানো হয় — নইলে সংখ্যা শব্দে বদলে যাওয়ার পর প্যাটার্ন
// আর ধরা পড়ে না):
//   ১. ইউনিকোড-পরিচ্ছন্নতা (NFC, ইমোজি/শূন্য-প্রস্থ অক্ষর অপসারণ)
//   ২. মার্কডাউন চিহ্ন অপসারণ (টোকেন-মিলান ভাঙার আগেই)
//   ৩. তারিখ ও সময়-প্যাটার্ন → বাংলা শব্দ
//   ৪. গণিত-সংদর্ভের '+' → 'যোগ' (সংখ্যা-রূপান্তরের আগে)
//   ৫. বাংলা/ASCII সংখ্যা → বাংলা সংখ্যা-শব্দ (৳/%-সহ)
//   ৬. অবশিষ্ট প্রতীক (% & @) → শব্দ
//   ৭. যতিচিহ্ন-সমন্বয় ('…'/'...' → '।', বাংলা বাক্যের ASCII '.' → '।')
//   ৮. ইংরেজি শব্দের ধ্বন্যাত্মক রূপ (অভিধানে থাকলে; না থাকলে অপরিবর্তিত)
//   ৯. বাংলা উচ্চারণ-ওভাররাইড (নির্বাচিত শব্দে)
//   ১০. নিরাপত্তা-শর্ত (বাংলা অক্ষর >৪০% হারালে মূল ইনপুটে ফেরত)
// ============================================================

import { ENGLISH_WORD_RESPellINGS, BN_PRONUNCIATION_OVERRIDES } from './bn-pronunciation-dictionary';

export interface BnNormalizationResult {
  text: string;
  changed: boolean;
  adjustments: string[];
}

// ------------------------------------------------------------
// মৌলিক সারণি — বাংলা সংখ্যা-শব্দ (০–৯৯, কুড়ি-প্রকৃতির সঠিক রূপ)
// মান বিশুদ্ধতাই এখানে সবচেয়ে জরুরি — তাই ১০০টি শব্দই হাতে-সারানো।
// ------------------------------------------------------------
const ONES_TO_99: readonly string[] = [
  'শূন্য', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়',
  'দশ', 'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো', 'ষোলো', 'সতেরো', 'আঠারো', 'ঊনিশ',
  'বিশ', 'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আটাশ', 'ঊনত্রিশ',
  'ত্রিশ', 'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'ঊনচল্লিশ',
  'চল্লিশ', 'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'ঊনপঞ্চাশ',
  'পঞ্চাশ', 'একান্ন', 'বায়ান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'ঊনষাট',
  'ষাট', 'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'ঊনসত্তর',
  'সত্তর', 'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'ঊনআশি',
  'আশি', 'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'আটাশি', 'ঊননব্বই',
  'নব্বই', 'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই',
];

/** বাংলা মাস (জর্জীয়/ইংরেজি বর্ষপঞ্জি — বাংলা লেখায় প্রচলিত রূপ) */
const BN_MONTHS: readonly string[] = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
];

/** ইংরেজি মাসের নাম → ক্রমিক মাস (ছোট হাতের কী)। 'may' ইচ্ছাকৃত বাদ — ইংরেজি modal verb-এর সঙ্গে সংঘর্ষ। */
const EN_MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** বাংলা অঙ্ক → ASCII অঙ্ক (বাকি সব অক্ষর অপরিবর্তিত) */
function toEnDigits(s: string): string {
  let out = '';
  for (const ch of s) {
    const idx = BN_DIGITS.indexOf(ch);
    out += idx >= 0 ? String(idx) : ch;
  }
  return out;
}

// ------------------------------------------------------------
// সংখ্যা → বাংলা শব্দ (০ থেকে ৯৯,৯৯,৯৯,৯৯৯ — কোটি/লাখ/হাজার প্রথায়)
// ------------------------------------------------------------

/** ০–৯৯ পর্যন্ত এক টুকরো শব্দ */
function twoDigitsWord(n: number): string {
  return ONES_TO_99[n] ?? String(n);
}

/** ১–৯৯৯: শতক-যুক্ত রূপ (একশো, দুইশো পঁচানব্বই, নয়শো নিরানব্বই …) */
function underThousandWord(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(`${twoDigitsWord(h)}শো`);
  if (r > 0) parts.push(twoDigitsWord(r));
  return parts.join(' ');
}

/**
 * পূর্ণসংখ্যা → বাংলা শব্দ।
 *  - ২০ এককভাবে "কুড়ি" (কুড়ি-প্রকৃতির প্রচলিত রূপ); যৌগিক অবস্থায় "বিশ"
 *  - ১১০০–১৯৯৯: প্রচলিত "উনিশশো একাত্তর"-ধাঁচ (সাল ও টাকা — দুই-ই এভাবেই পড়া হয়)
 *  - ২০০০–২৯৯৯: "দুই হাজার …", এরপর প্রমিত কোটি-লাখ-হাজার-শতক বিন্যাস
 */
function numberToBnWords(raw: number): string {
  const n = Math.floor(raw);
  if (!Number.isFinite(n) || n < 0) return String(raw);
  if (n === 0) return 'শূন্য';
  if (n === 20) return 'কুড়ি';
  if (n >= 1100 && n < 2000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return r === 0 ? `${twoDigitsWord(h)}শো` : `${twoDigitsWord(h)}শো ${twoDigitsWord(r)}`;
  }
  const parts: string[] = [];
  const koti = Math.floor(n / 1e7);
  const lakh = Math.floor(n / 1e5) % 100;
  const hajar = Math.floor(n / 1e3) % 100;
  const rest = n % 1000;
  if (koti > 0) parts.push(numberToBnWords(koti), 'কোটি'); // খুব বড় সংখ্যায় পুনরাবৃত্তি
  if (lakh > 0) parts.push(twoDigitsWord(lakh), 'লাখ');
  if (hajar > 0) parts.push(twoDigitsWord(hajar), 'হাজার');
  if (rest > 0) parts.push(underThousandWord(rest));
  return parts.join(' ');
}

/** দশমিকের ভগ্নাংশ: অঙ্কে-অঙ্কে শব্দ (৪.০৫ → "…দশমিক শূন্য পাঁচ") */
function fractionDigitsWords(frac: string): string {
  return frac
    .split('')
    .map(d => ONES_TO_99[Number(d)] ?? d)
    .join(' ');
}

// ------------------------------------------------------------
// প্যাটার্ন-সাহায্যকারী
// ------------------------------------------------------------
const D = '[০-৯0-9]'; // দুই লিপিরই অঙ্ক

/** তারিখ: ডিডি/এমএম/বছর বা ডিডি-এমএম-বছর */
const DATE_DMY_RE = new RegExp(`(?<![${'০-৯0-9'}./-])(${D}{1,2})[/-](${D}{1,2})[/-](${D}{4})(?![${'০-৯0-9'}])`, 'g');
/** তারিখ: বছর-এমএম-ডিডি বা বছর/এমএম/ডিডি */
const DATE_YMD_RE = new RegExp(`(?<![${'০-৯0-9'}./-])(${D}{4})[/-](${D}{1,2})[/-](${D}{1,2})(?![${'০-৯0-9'}])`, 'g');
/** সময়: ঘ:মিমি বা ঘ.মিমি (বিভাজক বাধ্যতামূলক, মিনিট অবশ্যই ২ অঙ্ক) */
const TIME_HM_RE = new RegExp(`(?<![${'০-৯0-9'}:%.-])(${D}{1,2})([:.])(${D}{2})(?![${'০-৯0-9'}])`, 'g');
/** সময়-নির্দেশক শব্দ (সন্নিহিত টোকেনে খোঁজা হয়) */
const TIME_OF_DAY_RE = /(সকাল|সকালে|ভোর|ভোরে|দুপুর|দুপুরে|মধ্যদুপুর|বিকাল|বিকেল|বিকালে|বিকেলে|সন্ধ্যা|সন্ধ্যায়|রাত|রাতে|মধ্যরাত|মধ্যরাতে|ঘণ্টা|মিনিট)/;
/** টোকেনে এগুলো থাকলে সংখ্যা-রূপান্তর হয় না (ল্যাটিন শব্দ/URL/ইমেইল রক্ষা) */
const LATINISH_TOKEN_RE = /[A-Za-z@/]/;
/** সংখ্যা-রান: ঐচ্ছিক ৳ + পূর্ণাংশ (কমা-গুচ্ছসহ) + ঐচ্ছিক দশমিক + ঐচ্ছিক ৳/% */
const NUM_RUN_RE = /(৳?)([০-৯0-9](?:[০-৯0-9,]*[০-৯0-9])?)(?:\.([০-৯0-9]+))?(৳?)(%?)/g;
const BN_LETTER_RE = /[\u0980-\u09FF]/;

// ------------------------------------------------------------
// মূল ফাংশন
// ------------------------------------------------------------
export function normalizeBengaliSpeechText(input: string): BnNormalizationResult {
  const original = input ?? '';
  if (!original.trim()) {
    return { text: original, changed: false, adjustments: [] };
  }
  const adjustments: string[] = [];
  const note = (s: string) => {
    adjustments.push(s);
  };

  // ---- ধাপ ১: ইউনিকোড-পরিচ্ছন্নতা ----
  let text = original.normalize('NFC');
  const stripRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200B}-\u{200F}\u{2060}\u{FEFF}]/gu;
  const stripCount = (text.match(stripRe) ?? []).length;
  if (stripCount > 0) {
    text = text.replace(stripRe, ' ');
    note(`ইমোজি/অদৃশ্য অক্ষর সরানো হয়েছে (${stripCount}টি)`);
  }
  text = text.replace(/\s+/g, ' ').trim();

  // ---- ধাপ ২: মার্কডাউন চিহ্ন অপসারণ ----
  const mdBefore = text;
  text = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__|~~|`|\*|\|)/g, '');
  if (text !== mdBefore) note('মার্কডাউন চিহ্ন (#, **, __, `) সরানো হয়েছে');

  // ---- ধাপ ৩ক: তারিখ → বাংলা শব্দ ----
  // বছর-আগে-রূপ (YYYY-MM-DD): "দুই হাজার ছাব্বিশ সালের পনেরো জানুয়ারি"
  text = text.replace(DATE_YMD_RE, (match, ys: string, ms: string, ds: string) => {
    const y = Number(toEnDigits(ys));
    const m = Number(toEnDigits(ms));
    const d = Number(toEnDigits(ds));
    if (!(y >= 1000 && y <= 9999) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return match;
    const out = `${numberToBnWords(y)} সালের ${twoDigitsWord(d)} ${BN_MONTHS[m - 1]}`;
    note(`তারিখ→শব্দ: ${match} → ${out}`);
    return out;
  });
  // দিন-আগে-রূপ (ডিডি/এমএম/বছর): "পনেরো জানুয়ারি দুই হাজার ছাব্বিশ"
  text = text.replace(DATE_DMY_RE, (match, ds: string, ms: string, ys: string) => {
    const y = Number(toEnDigits(ys));
    const m = Number(toEnDigits(ms));
    const d = Number(toEnDigits(ds));
    if (!(y >= 1000 && y <= 9999) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return match;
    const out = `${twoDigitsWord(d)} ${BN_MONTHS[m - 1]} ${numberToBnWords(y)}`;
    note(`তারিখ→শব্দ: ${match} → ${out}`);
    return out;
  });

  // ---- ধাপ ৩খ: সময় → বাংলা কথ্য রূপ ("নয় টা ত্রিশ") ----
  text = text.replace(TIME_HM_RE, (match, hs: string, sep: string, ms: string, offset: number, whole: string) => {
    const h = Number(toEnDigits(hs));
    const m = Number(toEnDigits(ms));
    // রক্ষণশীল: ঘণ্টা ১–১২ হতে হবে
    if (h < 1 || h > 12 || m > 59) return match;
    if (sep === '.') {
      // বিন্দু-রূপ সময় নির্দ্বিধায় সময় নয় — কেবল সন্নিহিত সময়-শব্দ থাকলেই
      const around = `${whole.slice(Math.max(0, offset - 14), offset)} ${whole.slice(offset + match.length, offset + match.length + 14)}`;
      if (!TIME_OF_DAY_RE.test(around)) return match;
    }
    const out = m === 0 ? `${twoDigitsWord(h)} টা` : `${twoDigitsWord(h)} টা ${twoDigitsWord(m)}`;
    note(`সময়→শব্দ: ${match} → ${out}`);
    return out;
  });

  // ---- ধাপ ৪: গণিত-সংদর্ভের '+' → 'যোগ' (সংখ্যা শব্দে বদলানোর আগে) ----
  const plusBefore = text;
  text = text.replace(new RegExp(`(${D})\\s*\\+\\s*(${D})`, 'g'), '$1 যোগ $2');
  if (text !== plusBefore) note("প্রতীক→শব্দ: '+' → 'যোগ' (গণিত-সংদর্ভ)");

  // ---- ধাপ ৫: সংখ্যা → বাংলা শব্দ (টোকেন-ভিত্তিক রক্ষাকবচসহ) ----
  text = text
    .split(' ')
    .map(tok => {
      if (!tok || LATINISH_TOKEN_RE.test(tok) || !/[০-৯0-9]/.test(tok)) return tok;
      return tok.replace(NUM_RUN_RE, (m, takaBefore: string, intPart: string, fracPart: string | undefined, takaAfter: string, pct: string, offset: number, whole: string) => {
        const enInt = toEnDigits(intPart).replace(/,/g, '');
        let words: string;
        let noted = false;
        if (fracPart !== undefined) {
          // দশমিক: পূর্ণাংশ শব্দে + 'দশমিক' + ভগ্নাংশ অঙ্কে-অঙ্কে
          const intWords = enInt === '0' ? 'শূন্য' : numberToBnWords(Number(enInt));
          words = `${intWords} দশমিক ${fractionDigitsWords(toEnDigits(fracPart))}`;
        } else if (enInt.length >= 10 || (enInt.length >= 7 && enInt.startsWith('0'))) {
          // ফোন-নম্বর-ধাঁচের দীর্ঘ সংখ্যা — কোটি-ভাঙন নয়, অঙ্কে-অঙ্কে পড়াই সঠিক
          words = fractionDigitsWords(enInt);
          note(`দীর্ঘ সংখ্যা অঙ্কে-অঙ্কে (ফোন-নম্বর-ধাঁচ): ${intPart} → ${words}`);
          noted = true;
        } else {
          words = numberToBnWords(Number(enInt));
        }
        if (takaBefore || takaAfter) words += ' টাকা'; // ৳ → 'টাকা' শব্দ
        if (pct) words += ' শতাংশ';
        if (!noted) note(`সংখ্যা→শব্দ: ${intPart}${fracPart !== undefined ? '.' + fracPart : ''} → ${words}`);
        // সংলগ্ন বাংলা অক্ষরের সঙ্গে একটি ফাঁক রাখা হয় (TTS-সংযোগ রোধ)
        const prev = offset > 0 ? whole.slice(offset - 1, offset) : '';
        const next = whole.slice(offset + m.length, offset + m.length + 1);
        if (prev && BN_LETTER_RE.test(prev)) words = ' ' + words;
        if (next && BN_LETTER_RE.test(next)) words += ' ';
        return words;
      });
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  // ---- ধাপ ৬: অবশিষ্ট প্রতীক (% & @) → শব্দ ----
  // এখানে রক্ষাকবচ শুধু ল্যাটিন *অক্ষর* — ইমেইল/ল্যাটিন আইডি রক্ষিত থাকে,
  // কিন্তু বাংলা-প্রেক্ষিতের একক @ বা সংযুক্ত @-বাংলা রূপান্তরিত হয়।
  text = text
    .split(' ')
    .map(tok => {
      if (/[A-Za-z]/.test(tok)) return tok;
      if (tok.includes('%') && !/[০-৯0-9]/.test(tok)) {
        note("প্রতীক→শব্দ: '%' → 'শতাংশ'");
        return tok.replace(/%/g, ' শতাংশ ');
      }
      if (tok.includes('&')) {
        note("প্রতীক→শব্দ: '&' → 'এবং'");
        return tok.replace(/&/g, ' এবং ');
      }
      if (tok.includes('@')) {
        note("প্রতীক→শব্দ: '@' → 'অ্যাট'");
        return tok.replace(/@/g, 'অ্যাট ');
      }
      return tok;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  // ---- ধাপ ৭: যতিচিহ্ন-সমন্বয় ----
  // এলিপসিস/বহু-বিন্দু → দাঁড়ি (বিরতি-বান্ধব)
  const ellipsisBefore = text;
  text = text.replace(/([^\s।])\s*(?:\.\.\.+|…+)/g, '$1।');
  if (text !== ellipsisBefore) note("'…'/'...' → '।' (বিরতি-সমন্বয়)");
  // বাংলা অক্ষরের পরে বাক্য-শেষের ASCII '.' → '।'
  const dotBefore = text;
  text = text.replace(/([\u0980-\u09FF])\s*\.(?=\s|$)/g, '$1।');
  if (text !== dotBefore) note("যতিচিহ্ন: বাংলা বাক্যের শেষে ASCII '.' → '।'");
  // যতিচিহ্নের আগের ফাঁকা জায়গা সরানো
  const spaceBefore = text;
  text = text.replace(/\s+([।,;:!?])/g, '$1');
  if (text !== spaceBefore) note('যতিচিহ্নের আগের অতিরিক্ত ফাঁকা জায়গা সরানো হয়েছে');
  text = text.replace(/\s+/g, ' ').trim();

  // ---- ধাপ ৮: ইংরেজি শব্দ → ধ্বন্যাত্মক রূপ (অভিধানে থাকলে) ----
  const tokens = text.split(' ');
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i]) continue;
    // দুই-টোকেনের বাক্যাংশ (যেমন "thank you")
    if (i + 1 < tokens.length) {
      const sa = splitLatinToken(tokens[i]);
      const sb = splitLatinToken(tokens[i + 1]);
      if (sa && sb && PUNCT_ONLY_RE.test(sa.suffix) && PUNCT_ONLY_RE.test(sb.suffix)) {
        const key = `${sa.core.toLowerCase()} ${sb.core.toLowerCase()}`;
        const phraseRep = ENGLISH_WORD_RESPellINGS[key];
        if (phraseRep) {
          const words = phraseRep.split(' ');
          if (words.length === 2) {
            tokens[i] = `${sa.prefix}${words[0]}${sa.suffix}`;
            tokens[i + 1] = `${sb.prefix}${words[1]}${sb.suffix}`;
          } else {
            tokens[i] = `${sa.prefix}${phraseRep}${sa.suffix}`;
            tokens[i + 1] = '';
          }
          note(`ইংরেজি শব্দের ধ্বন্যাত্মক রূপ: ${key} → ${phraseRep}`);
          i++;
          continue;
        }
      }
    }
    const s = splitLatinToken(tokens[i]);
    if (!s) continue;
    if (!PUNCT_ONLY_RE.test(s.suffix) && !BN_SUFFIX_RE.test(s.suffix)) continue;
    const lower = s.core.toLowerCase();
    if (ENGLISH_WORD_RESPellINGS[lower]) {
      const rep = ENGLISH_WORD_RESPellINGS[lower];
      tokens[i] = `${s.prefix}${rep}${s.suffix}`;
      note(`ইংরেজি শব্দের ধ্বন্যাত্মক রূপ: ${lower} → ${rep}`);
      continue;
    }
    const monthIdx = EN_MONTHS[lower];
    if (monthIdx) {
      const rep = BN_MONTHS[monthIdx - 1];
      tokens[i] = `${s.prefix}${rep}${s.suffix}`;
      note(`মাসের নাম বাংলায়: ${s.core} → ${rep}`);
      continue;
    }
    // অজানা ইংরেজি শব্দ সজ্ঞানে অপরিবর্তিত থাকে — সৎ আচরণ
  }
  text = tokens.filter(Boolean).join(' ');

  // ---- ধাপ ৯: বাংলা উচ্চারণ-ওভাররাইড (নির্বাচিত শব্দে) ----
  text = text
    .split(' ')
    .map(tok => {
      const m = tok.match(/^([^\p{L}\p{N}]*)([\u0980-\u09FF]+)([\s\S]*)$/u);
      if (!m) return tok;
      const word = m[2];
      const rep = BN_PRONUNCIATION_OVERRIDES[word];
      if (!rep) return tok;
      note(`উচ্চারণ-সমন্বয়: ${word} → ${rep}`);
      return `${m[1]}${rep}${m[3]}`;
    })
    .join(' ');

  text = text.replace(/\s+/g, ' ').trim();

  // ---- ধাপ ১০: নিরাপত্তা-শর্ত ----
  const bnIn = (original.match(/[\u0980-\u09FF]/g) ?? []).length;
  const bnOut = (text.match(/[\u0980-\u09FF]/g) ?? []).length;
  if (!text || (bnIn > 0 && bnOut < Math.ceil(bnIn * 0.6))) {
    // বাংলা অক্ষরের >৪০% হারিয়ে গেছে বা ফলাফল খালি — নিশ্চিতভাবে বাগ;
    // মূল ইনপুটই অক্ষত ফেরত দেওয়া হয় (নর্মালাইজেশন-নাকচ)
    return { text: original, changed: false, adjustments: ['নর্মালাইজেশন বাতিল — নিরাপত্তা-শর্ত'] };
  }

  // সমন্বয়-তালিকা: সদৃশ বাদ, সীমা ছাড়ালে সারসংক্ষেপ
  let finalAdjustments = [...new Set(adjustments)];
  if (finalAdjustments.length > 20) {
    const extra = finalAdjustments.length - 20;
    finalAdjustments = [...finalAdjustments.slice(0, 20), `…আরও ${extra}টি সমন্বয়`];
  }
  const changed = text !== original;
  if (changed && finalAdjustments.length === 0) {
    finalAdjustments.push('হালকা পরিচ্ছন্নতা-সমন্বয় (স্পেস/ইউনিকোড)');
  }
  return { text, changed, adjustments: finalAdjustments };
}

// ------------------------------------------------------------
// ইংরেজি শব্দ-খোঁজার সাহায্যকারী
// ------------------------------------------------------------

interface LatinSplit {
  prefix: string; // শব্দের আগের বিরামচিহ্ন
  core: string; // ল্যাটিন অক্ষরের ধারা
  suffix: string; // শব্দের পরের অংশ (বিরামচিহ্ন বা বাংলা সংযোজন যেমন '-এর')
}

/** টোকেনের শুরুর ল্যাটিন অংশ আলাদা করা ('project-এর,' → prefix/core/suffix) */
function splitLatinToken(tok: string): LatinSplit | null {
  const m = tok.match(/^([^\p{L}\p{N}]*)([A-Za-z]+(?:['’][A-Za-z]+)*)([\s\S]*)$/u);
  if (!m) return null;
  return { prefix: m[1], core: m[2], suffix: m[3] };
}

const PUNCT_ONLY_RE = /^[\p{P}\p{S}\s]*$/u;
const BN_SUFFIX_RE = /^-[\u0980-\u09FF]+$/;
