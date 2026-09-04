// Server-only language detection that layers the `franc` statistical model
// (offline, ~hundreds of KB) on top of the lightweight detector. It is only
// imported by server API routes so franc never ships to the browser bundle.
//
// franc adds finer-grained guesses for long/ambiguous text (e.g. distinguishing
// Hindi/Marathi/Nepali in Devanagari, or Russian/Ukrainian/Bulgarian in
// Cyrillic, and identifying less-common European Latin languages).

import { franc, francAll } from "franc";
import { detectLanguage as detectLanguageLight, speechLangTag } from "@/lib/detectLanguage";

export { speechLangTag };

const DEVANAGARI_FALLBACK: Record<string, string> = {
  hin: "Hindi",
  mar: "Marathi",
  nep: "Nepali",
  san: "Sanskrit",
  kok: "Konkani",
};

const nameCache = new Map<string, string>();
let displayNames: Intl.DisplayNames | undefined;

function languageName(code: string): string | null {
  if (typeof Intl.DisplayNames !== "function") return null;
  displayNames ||= new Intl.DisplayNames("en", { type: "language" });
  if (nameCache.has(code)) return nameCache.get(code) || null;
  try {
    const name = displayNames.of(code) || "";
    nameCache.set(code, name);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

function devanagariLanguage(sample: string): string {
  if (sample.length >= 20) {
    const code = franc(sample);
    if (DEVANAGARI_FALLBACK[code]) return DEVANAGARI_FALLBACK[code];
    const name = languageName(code);
    if (name && ["Hindi", "Marathi", "Nepali", "Sanskrit", "Konkani", "Maithili"].includes(name)) return name;
  }
  return "Hindi";
}

// Constrain franc to European languages so short phrases that confuse the
// full model (e.g. "bonjour merci" → Bulu) score among plausible candidates.
const EUROPEAN_CODES = [
  "sqi", "hye", "eus", "bos", "bul", "cat", "hrv", "ces", "dan", "nld",
  "eng", "est", "fao", "fin", "fra", "fry", "glg", "kat", "deu", "ell",
  "hun", "isl", "gle", "ita", "lav", "lit", "ltz", "mkd", "mlt", "nor",
  "nob", "nno", "pol", "por", "ron", "rus", "gla", "srp", "slk", "slv",
  "spa", "swe", "tur", "ukr", "cym", "oci", "srd", "cos", "scn", "bre",
];

const EURO_NAMES: Record<string, string> = {
  alb: "Albanian", sqi: "Albanian", hye: "Armenian", eus: "Basque", bos: "Bosnian",
  bre: "Breton", bul: "Bulgarian", cat: "Catalan", hrv: "Croatian", ces: "Czech",
  dan: "Danish", nld: "Dutch", eng: "English", est: "Estonian", fao: "Faroese",
  fin: "Finnish", fra: "French", fry: "Frisian", glg: "Galician", kat: "Georgian",
  deu: "German", ell: "Greek", hun: "Hungarian", isl: "Icelandic", gle: "Irish",
  ita: "Italian", lav: "Latvian", lit: "Lithuanian", ltz: "Luxembourgish",
  mkd: "Macedonian", mlt: "Maltese", nor: "Norwegian", nob: "Norwegian",
  nno: "Norwegian", pol: "Polish", por: "Portuguese", ron: "Romanian", rus: "Russian",
  gla: "Scottish Gaelic", srp: "Serbian", slk: "Slovak", slv: "Slovenian",
  spa: "Spanish", swe: "Swedish", tur: "Turkish", ukr: "Ukrainian", cym: "Welsh",
  oci: "Occitan", srd: "Sardinian", cos: "Corsican", scn: "Sicilian",
};

function detectFrancEurope(sample: string): string | null {
  if (sample.length < 30) return null;
  const ranked = francAll(sample, { only: EUROPEAN_CODES });
  if (!ranked || ranked.length === 0) return null;
  const [top, topScore] = ranked[0] || ["und", 0];
  if (!top || top === "und") return null;
  if (topScore < 0.2) return null;

  const english = ranked.find(([code]) => code === "eng");
  if (english && english[1] >= topScore - 0.3 && top !== "eng") {
    return "English";
  }

  const secondScore = ranked[1]?.[1] ?? 0;
  if (topScore - secondScore < 0.12) return null;
  return EURO_NAMES[top] || languageName(top) || null;
}

function detectFranc(sample: string): string | null {
  if (sample.length < 40) return null;
  const ranked = francAll(sample);
  if (!ranked || ranked.length < 2) return null;
  const [top, topScore] = ranked[0] || ["und", 0];
  if (!top || top === "und") return null;
  const secondScore = ranked[1]?.[1] ?? 0;
  if (topScore < 0.2 || topScore - secondScore < 0.06) return null;

  const known: Record<string, string> = { cmn: "Chinese", jpn: "Japanese", kor: "Korean" };
  return known[top] || languageName(top);
}

const DEVANAGARI_START = 0x0900;
const DEVANAGARI_END = 0x097f;
const MIN_SCRIPT_SHARE = 0.35;

function scriptShare(
  start: number,
  end: number,
  sample: string,
  totalLetters: number
): number {
  if (totalLetters === 0) return 0;
  let count = 0;
  for (const ch of sample) {
    const cp = ch.codePointAt(0)!;
    if (cp >= start && cp <= end && /\p{L}/u.test(ch)) count++;
  }
  return count / totalLetters;
}

/**
 * Full server-side language detection: script dominance + stopword scoring
 * (from the lightweight detector) with a `franc` statistical refinement for
 * long or otherwise-ambiguous text.
 */
export function detectLanguageFull(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null;
  const sample = text.slice(0, 1200);

  const letters = sample.match(/\p{L}/gu);
  const totalLetters = letters ? letters.length : 0;
  if (totalLetters === 0) return null;

  // Devanagari needs franc to distinguish Hindi/Marathi/Nepali/….
  if (scriptShare(DEVANAGARI_START, DEVANAGARI_END, sample, totalLetters) >= MIN_SCRIPT_SHARE) {
    return devanagariLanguage(sample);
  }

  // Prefer the lightweight detector for everything else (fast path), then
  // refine with franc only for longer, otherwise-unclassified Latin text.
  const light = detectLanguageLight(sample);
  if (light) return light;

  const european = detectFrancEurope(sample);
  if (european) return european;

  return detectFranc(sample);
}
