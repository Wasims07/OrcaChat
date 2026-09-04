// Lightweight language guesser used to hint the model's reply language and to
// pick a Web Speech language tag. It runs in BOTH the browser (speech input)
// and on the server (system-prompt hint), so it must stay small — it contains
// NO statistical language models (the `franc` package is kept server-side in
// detectLanguageFull.ts to avoid shipping hundreds of KB to the browser).
//
// Strategy (chat messages are short and often defeat statistical guessers):
//  1. SCRIPT DOMINANCE: a script (Devanagari, Malayalam, Arabic, CJK…) only
//     "wins" if it accounts for a large share of the message's letters. A
//     quoted foreign word inside an English question must NOT flip it.
//  2. Latin-script stopword scoring (covers ~25 major languages reliably,
//     with a bias toward English when two languages tie).
//  The server additionally layers in `franc` (see detectLanguageFull.ts) for
//  long/ambiguous text when it wants a finer-grained guess.

const MIN_SCRIPT_SHARE = 0.35;

// Script Unicode ranges as [start, end] codepoint pairs. Only LETTERS
// (category L) inside a range count toward its share, so vowel signs and
// combining marks never inflate the ratio.
const SCRIPT_RANGES: Array<[number, number, string]> = [
  [0x3040, 0x30ff, "Japanese"],
  [0xac00, 0xd7af, "Korean"],
  [0x4e00, 0x9fff, "Chinese"],
  [0x0600, 0x06ff, "Arabic"], // Persian is refined separately
  [0x0370, 0x03ff, "Greek"],
  [0x0530, 0x058f, "Armenian"],
  [0x10a0, 0x10ff, "Georgian"],
  // Indic scripts (Devanagari handled separately — it maps to several languages)
  [0x0980, 0x09ff, "Bengali"],
  [0x0a00, 0x0a7f, "Punjabi"],
  [0x0a80, 0x0aff, "Gujarati"],
  [0x0b00, 0x0b7f, "Odia"],
  [0x0b80, 0x0bff, "Tamil"],
  [0x0c00, 0x0c7f, "Telugu"],
  [0x0c80, 0x0cff, "Kannada"],
  [0x0d00, 0x0d7f, "Malayalam"],
  [0x0d80, 0x0dff, "Sinhala"],
];

const CYRILLIC_START = 0x0400;
const CYRILLIC_END = 0x04ff;
const DEVANAGARI_START = 0x0900;
const DEVANAGARI_END = 0x097f;
// Persian-only letters: پ چ ژ گ ی (used to prefer Persian over generic Arabic).
const PERSIAN_LETTERS = /[\u067e\u0686\u0698\u06af\u06cc]/;
// Ukrainian-only letters (і, ї, є, ґ) — strong signal on short text.
const UKRAINIAN_LETTERS = /[\u0456\u0457\u0454\u0491]/;

const CYRILLIC_FALLBACK: Record<string, string> = {
  rus: "Russian",
  ukr: "Ukrainian",
  bul: "Bulgarian",
  bel: "Belarusian",
  srp: "Serbian",
  mkd: "Macedonian",
};

const LATIN_STOPWORDS: Record<string, Set<string>> = {
  English: new Set(["the", "and", "you", "that", "this", "your", "with", "have", "are", "from", "for", "please", "help", "what", "how", "why", "can", "was", "his", "her", "they", "there"]),
  Spanish: new Set(["el", "la", "los", "las", "y", "que", "por", "para", "con", "una", "como", "está", "muy", "gracias", "puedes"]),
  French: new Set(["le", "la", "les", "et", "que", "pas", "pour", "avec", "une", "ce", "je", "merci", "vous", "est", "pouvez"]),
  German: new Set(["der", "die", "das", "und", "ich", "sie", "für", "mit", "nicht", "ein", "wie", "danke", "bitte", "kannst", "guten", "tag", "vielen", "grüße", "schön", "helfen"]),
  Italian: new Set(["il", "lo", "la", "e", "che", "per", "con", "una", "perché", "come", "sono", "grazie", "puoi", "mi"]),
  Portuguese: new Set(["o", "a", "os", "as", "e", "que", "para", "com", "uma", "como", "por", "obrigado", "você", "pode"]),
  Dutch: new Set(["de", "het", "een", "en", "ik", "je", "voor", "met", "niet", "wat", "hoe", "dank", "alsjeblieft", "kun"]),
  Turkish: new Set(["bir", "ve", "için", "ile", "de", "da", "ben", "sen", "bu", "şu", "nasıl", "teşekkür", "yapabilir"]),
  Indonesian: new Set(["yang", "dan", "ini", "itu", "untuk", "dengan", "saya", "kamu", "apa", "bagaimana", "terima", "kasih", "bisa"]),
  Norwegian: new Set(["og", "er", "ikke", "jeg", "det", "på", "takk", "hei", "ein", "hva", "hvordan", "for", "kan"]),
  Swedish: new Set(["och", "jag", "det", "att", "som", "för", "med", "inte", "ett", "hur", "tack", "var", "kan"]),
  Danish: new Set(["og", "er", "jeg", "det", "til", "tak", "hvordan", "kan", "hjælp", "ikke", "hvad", "med"]),
  Polish: new Set(["i", "nie", "się", "to", "że", "tak", "dla", "jak", "czy", "jest", "dziękuję", "proszę", "możesz"]),
  Vietnamese: new Set(["và", "của", "là", "không", "tôi", "bạn", "một", "cho", "như", "giúp", "cảm", "ơn", "có thể"]),
  Czech: new Set(["a", "je", "pro", "na", "jak", "děkuji", "prosím", "jste", "můžete", "něco", "to", "se", "diky", "díky", "moc", "vás", "vas", "ano"]),
  Romanian: new Set(["și", "este", "cu", "pentru", "ca", "mulțumesc", "dacă", "puteți", "ajutor", "un", "o", "nu"]),
  Hungarian: new Set(["és", "a", "az", "hogy", "kérjük", "köszönöm", "tud", "segít", "mit", "nagyon", "nem", "is"]),
  Finnish: new Set(["ja", "on", "minä", "sinä", "että", "kiitos", "miten", "voit", "apua", "ole", "hän", "se"]),
  Filipino: new Set(["ang", "ng", "sa", "aking", "iyong", "para", "may", "kay", "salamat", "paano", "tulong", "pwede"]),

  // Additional European languages
  Slovak: new Set(["a", "je", "pre", "na", "ako", "ďakujem", "prosím", "môžete", "nie", "to", "sú", "či"]),
  Slovenian: new Set(["in", "je", "za", "kot", "hvala", "prosim", "lahko", "ste", "zelo", "da", "tudi"]),
  Croatian: new Set(["i", "je", "za", "na", "kao", "hvala", "molim", "možete", "mozete", "što", "da", "ali", "sve", "pomoci", "lijepa", "hvala lijepa", "srdačno"]),
  Lithuanian: new Set(["ir", "yra", "kaip", "ačiū", "prašau", "galite", "kad", "tai", "su", "šis", "ne"]),
  Latvian: new Set(["un", "ir", "kā", "paldies", "lūdzu", "varat", "ka", "tas", "kas", "šis", "ne"]),
  Estonian: new Set(["ja", "on", "see", "kuidas", "aitäh", "palun", "saate", "et", "mis", "teid", "ei"]),
  Icelandic: new Set(["og", "er", "ég", "þú", "það", "takk", "hvernig", "getur", "hjálp", "að", "ekki", "sem"]),
  Irish: new Set(["agus", "is", "tá", "tú", "seo", "go", "le do thoil", "conas", "cabhrú", "mé", "ní", "an"]),
  Catalan: new Set(["el", "la", "els", "les", "i", "que", "per", "amb", "una", "com", "gràcies", "pots", "està", "això"]),
  Galician: new Set(["o", "a", "os", "as", "e", "que", "para", "con", "como", "grazas", "podes", "esta", "non"]),
  Basque: new Set(["eta", "bat", "da", "nola", "esker", "mesedez", "duzu", "hau", "zein", "ez", "badakizula"]),
  Maltese: new Set(["u", "huwa", "jien", "int", "kif", "grazzi", "jekk jogħġbok", "tista", "dan", "din", "mhux"]),
  Albanian: new Set(["dhe", "është", "unë", "ti", "si", "faleminderit", "ju lutem", "mund", "këtë", "nuk", "një"]),
  Welsh: new Set(["a", "y", "yr", "mae", "diolch", "os gwelwch yn dda", "gallwch", "helpu", "chi", "yn", "nad"]),
  ScottishGaelic: new Set(["agus", "tha", "thu", "seo", "tapadh", "ciamar", "sibh", "ur", "gu", "chan", "bheil"]),
};

const SPEECH_TAGS: Record<string, string> = {
  English: "en-US",
  Spanish: "es-ES",
  French: "fr-FR",
  German: "de-DE",
  Irish: "ga-IE",
  Italian: "it-IT",
  Portuguese: "pt-PT",
  "Brazilian Portuguese": "pt-BR",
  "Portuguese (Brazil)": "pt-BR",
  Dutch: "nl-NL",
  Turkish: "tr-TR",
  Indonesian: "id-ID",
  Polish: "pl-PL",
  Romanian: "ro-RO",
  Hungarian: "hu-HU",
  Czech: "cs-CZ",
  Slovak: "sk-SK",
  Slovenian: "sl-SI",
  Croatian: "hr-HR",
  Serbian: "sr-RS",
  Bulgarian: "bg-BG",
  Ukrainian: "uk-UA",
  Russian: "ru-RU",
  Greek: "el-GR",
  Swedish: "sv-SE",
  Danish: "da-DK",
  Norwegian: "no-NO",
  Finnish: "fi-FI",
  Arabic: "ar-SA",
  Persian: "fa-IR",
  Hindi: "hi-IN",
  Marathi: "mr-IN",
  Nepali: "ne-NP",
  Bengali: "bn-BD",
  Tamil: "ta-IN",
  Telugu: "te-IN",
  Kannada: "kn-IN",
  Malayalam: "ml-IN",
  Gujarati: "gu-IN",
  Punjabi: "pa-IN",
  Odia: "or-IN",
  Sinhala: "si-LK",
  Japanese: "ja-JP",
  Korean: "ko-KR",
  Chinese: "zh-CN",
  Filipino: "fil-PH",
  Vietnamese: "vi-VN",
  Thai: "th-TH",
};

export function speechLangTag(languageName: string): string | null {
  if (!languageName) return null;
  const tag = SPEECH_TAGS[languageName];
  return tag || null;
}

function wordsOf(sample: string): string[] {
  return sample
    .toLowerCase()
    .split(/[^\p{L}'’]+/u)
    .filter((w) => w.length > 1);
}

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

function detectLatin(sample: string): string | null {
  const words = wordsOf(sample);
  if (words.length === 0) return null;

  let bestLang: string | null = null;
  let bestHits = 0;
  const scores = new Map<string, number>();
  for (const [lang, stops] of Object.entries(LATIN_STOPWORDS)) {
    let hits = 0;
    for (const w of words) if (stops.has(w)) hits++;
    if (hits > 0) {
      scores.set(lang, hits);
      if (hits > bestHits) {
        bestLang = lang;
        bestHits = hits;
      }
    }
  }
  // Tie-break toward English so a lone shared word can't pin another language.
  if (bestHits > 0 && bestLang !== "English" && (scores.get("English") ?? 0) >= bestHits) {
    bestLang = "English";
  }
  return bestLang;
}

function detectCyrillic(sample: string): string {
  if (UKRAINIAN_LETTERS.test(sample)) return "Ukrainian";
  return CYRILLIC_FALLBACK["rus"] || "Russian";
}

/**
 * Lightweight, model-free language detection. Covers script-dominant and the
 * most common Latin-script languages via stopword scoring. It intentionally
 * avoids the `franc` statistical model to keep the browser bundle small.
 */
export function detectLanguage(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null;
  const sample = text.slice(0, 1200);

  const letters = sample.match(/\p{L}/gu);
  const totalLetters = letters ? letters.length : 0;
  if (totalLetters === 0) return null;

  // 1) Script dominance — a script must dominate BEFORE it counts. Devi/Malayalam
  //    quotes inside otherwise-English text will now fall through to English.
  if (scriptShare(DEVANAGARI_START, DEVANAGARI_END, sample, totalLetters) >= MIN_SCRIPT_SHARE) {
    return "Hindi";
  }
  for (const [start, end, lang] of SCRIPT_RANGES) {
    const share = scriptShare(start, end, sample, totalLetters);
    if (lang === "Arabic" && share >= MIN_SCRIPT_SHARE) {
      return PERSIAN_LETTERS.test(sample) ? "Persian" : "Arabic";
    }
    if (share >= MIN_SCRIPT_SHARE) return lang;
  }
  const cyrillicShare = scriptShare(CYRILLIC_START, CYRILLIC_END, sample, totalLetters);
  if (cyrillicShare >= MIN_SCRIPT_SHARE) {
    return detectCyrillic(sample);
  }

  // 2) Latin-script stopword scoring.
  return detectLatin(sample);
}
