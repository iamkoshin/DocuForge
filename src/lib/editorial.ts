// The "Editorial" look: word-by-word captions where key words switch typeface. Shared by the renderer
// (how a word looks) and the sound planner (which words get a glitch or a low hit).
import type { WordTiming } from "./schemas";

/** number: big bold sans · name: large roman serif · danger: red bold sans · feeling: italic serif */
export type EmStyle = "number" | "name" | "danger" | "feeling";

const DANGER = new Set(
  "guilty crashed crash collapsed collapse bankrupt bankruptcy fraud stolen stole selling sold everything gone lost lies lied arrested prison jail convicted panic panicked fake scam ponzi dead died killed never nothing illegal hidden secret backdoor".split(" "),
);
const SCALE = /^(hundred|thousand|million|billion|trillion|years?|months?|days?|hours?|minutes?|percent|%|times)$/i;
const NUMERIC = /^[-−$€£¥]?\d|^\d|%$/;

export const cleanWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const bare = (w: string) => w.replace(/^[^\p{L}\p{N}$€£¥−-]+|[^\p{L}\p{N}%]+$/gu, "");

// Spoken numbers ("eight billion dollars", "twenty twenty-two"): scripts write numbers as words for the voice.
const UNITS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const BIG = /^(million|billion|trillion)$/;
const CURRENCY: Record<string, string> = { dollar: "$", dollars: "$", euro: "€", euros: "€", pound: "£", pounds: "£" };
const small = (w: string) => w.split("-").every((p) => p in UNITS || p in TENS);
const isNumberWord = (w: string) => {
  const c = w.toLowerCase().replace(/[^a-z-]/g, "");
  return Boolean(c) && (small(c) || /^(hundred|thousand|point)$/.test(c) || BIG.test(c));
};
/** Part of a figure: digits, number words, scale words, currency and units. */
export const numberish = (w: string) => NUMERIC.test(bare(w)) || isNumberWord(w) || SCALE.test(bare(w)) || cleanWord(w) in CURRENCY;

function hasFigure(words: string[]) {
  if (words.some((w) => NUMERIC.test(bare(w)))) return true;
  const nums = words.filter(isNumberWord);
  // "one" / "a" alone ("one company") isn't a figure.
  return nums.length > 0 && !(nums.length === 1 && /^one$/i.test(cleanWord(nums[0])) && !words.some((w) => BIG.test(cleanWord(w))));
}

/** "eight billion dollars" → "$8 billion", "thirty-two percent" → "32%", "twenty twenty-two" → "2022". Digits pass through. */
export function displayNumber(text: string) {
  const clean = text.replace(/[.,;:!?]+$/, "");
  const words = clean.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z-]/g, ""));
  if (/\d/.test(clean)) return clean;
  // "a million" = 1 million.
  words.forEach((w, i) => (/^an?$/.test(w) && /^(hundred|thousand|million|billion|trillion)$/.test(words[i + 1] ?? "") ? (words[i] = "one") : null));
  if (!words.some((w) => small(w))) return clean;
  const val = (w: string) => w.split("-").reduce((a, p) => a + (UNITS[p] ?? TENS[p] ?? 0), 0);
  // Years said in pairs: "nineteen fifty-three", "twenty twenty-two".
  const nums = words.filter((w) => small(w));
  if (nums.length === 2 && words.length === 2 && val(nums[0]) >= 10 && val(nums[0]) <= 99 && val(nums[1]) >= 10) return String(val(nums[0]) * 100 + val(nums[1]));
  let total = 0;
  let cur = 0;
  let decimals = "";
  let inDecimal = false;
  let scale = "";
  let prefix = "";
  let pct = false;
  const rest: string[] = [];
  for (const w of words) {
    if (small(w) && !scale) {
      if (inDecimal) decimals += String(val(w));
      else cur += val(w);
    } else if (w === "point") inDecimal = true;
    else if (w === "hundred") cur *= 100;
    else if (w === "thousand" && !scale) {
      total += cur * 1000;
      cur = 0;
    } else if (BIG.test(w) && !scale) scale = w;
    else if (w in CURRENCY) prefix = CURRENCY[w];
    else if (w === "percent") pct = true;
    else if (w) rest.push(w);
  }
  const n = total + cur;
  const isYear = !prefix && !pct && !scale && !decimals && n >= 1000 && n <= 2100;
  const num = (isYear ? String(n) : n.toLocaleString("en-US")) + (decimals ? `.${decimals}` : "");
  return `${prefix}${num}${pct ? "%" : ""}${scale ? ` ${scale}` : ""}${rest.length ? ` ${rest.join(" ")}` : ""}`;
}

export function emphasisStyle(text: string, sentenceStart: boolean): EmStyle {
  const words = text.split(/\s+/);
  if (hasFigure(words)) return "number";
  if (words.some((w) => DANGER.has(cleanWord(w)))) return "danger";
  // Capitalised mid-sentence = a name (person, company, place).
  if (!sentenceStart && /^\p{Lu}/u.test(bare(words[0]))) return "name";
  if (words.length > 1 && words.every((w) => /^\p{Lu}/u.test(bare(w)))) return "name";
  return "feeling";
}

export interface CaptionItem {
  words: WordTiming[];
  text: string;
  start: number;
  style?: EmStyle; // set = display word(s)
}
export interface CaptionPhrase {
  items: CaptionItem[];
  start: number;
  end: number;
}

/**
 * Split a scene's words into on-screen phrases (they replace each other with a hard cut) and mark the
 * emphasis words. Consecutive emphasis words, and a number followed by "billion"/"years"/…, form one item.
 */
export function editorialPhrases(words: WordTiming[], emphasis: string[], maxWords = 7): CaptionPhrase[] {
  const em = new Set(emphasis.flatMap((e) => e.split(/\s+/)).map(cleanWord).filter(Boolean));
  const items: CaptionItem[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = items[items.length - 1];
    const isEm = em.has(cleanWord(w.word));
    const sentenceStart = i === 0 || /[.!?]["”’)]?$/.test(words[i - 1].word);
    const open = prev && !/[.,!?;:—]$/.test(prev.text);
    const joinsPrev = open && prev.style && (isEm || (prev.style === "number" && numberish(w.word)));
    if (joinsPrev) {
      prev.words.push(w);
      prev.text += ` ${w.word}`;
      prev.style = emphasisStyle(prev.text, false) === "number" ? "number" : prev.style;
      continue;
    }
    const item: CaptionItem = { words: [w], text: w.word, start: w.start, style: isEm ? emphasisStyle(w.word, sentenceStart) : undefined };
    // "eight" (plain) + "billion" (emphasised): pull the start of the figure into the display item.
    if (isEm && numberish(w.word)) {
      while (items.length) {
        const p = items[items.length - 1];
        const article = /^an?$/i.test(p.text) && BIG.test(cleanWord(item.words[0].word)) || (/^an?$/i.test(p.text) && /^(hundred|thousand)$/i.test(cleanWord(item.words[0].word)));
        if (p.style || /[.,!?;:—]$/.test(p.text) || !(article || NUMERIC.test(bare(p.text)) || isNumberWord(p.text) || cleanWord(p.text) in CURRENCY)) break;
        items.pop();
        item.words.unshift(...p.words);
        item.text = `${p.text} ${item.text}`;
        item.start = p.start;
      }
      if (item.words.length > 1 || hasFigure([w.word])) item.style = "number";
    }
    items.push(item);
  }

  const phrases: CaptionPhrase[] = [];
  let cur: CaptionItem[] = [];
  let count = 0;
  const flush = () => {
    if (cur.length) {
      const last = cur[cur.length - 1].words;
      phrases.push({ items: cur, start: cur[0].start, end: last[last.length - 1].end });
    }
    cur = [];
    count = 0;
  };
  items.forEach((it, i) => {
    const next = items[i + 1];
    cur.push(it);
    count += it.words.length;
    const gap = next ? next.start - it.words[it.words.length - 1].end : 0;
    const ended = /[.!?;:—]["”’)]?$/.test(it.text) || (/,$/.test(it.text) && count >= 3);
    const fullAfterDisplay = it.style && it.style !== "feeling" && count >= 4;
    if (ended || gap > 0.45 || count >= maxWords || fullAfterDisplay) flush();
  });
  flush();
  return phrases;
}
