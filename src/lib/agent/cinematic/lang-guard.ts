// Shared prompt-language guard helpers (Recovery Round R — contract for D-F03).
// Owned by the LEAD (recovery session): fix agents may IMPORT but not EDIT this file.
// Bengali script = Unicode block "Bengali" (U+0980–U+09FF).
const BENGALI_SCRIPT_RE = /[\u0980-\u09FF]/;

/** True when the text contains at least one Bengali-script character. */
export function containsBengaliScript(text: string | null | undefined): boolean {
  if (!text) return false;
  return BENGALI_SCRIPT_RE.test(text);
}

/** Share (0..1) of non-whitespace characters that are Bengali-script. */
export function bengaliScriptShare(text: string | null | undefined): number {
  if (!text) return 0;
  const chars = Array.from(text).filter((c) => !/\s/.test(c));
  if (chars.length === 0) return 0;
  let bn = 0;
  for (const c of chars) if (BENGALI_SCRIPT_RE.test(c)) bn += 1;
  return bn / chars.length;
}
