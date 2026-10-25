// Tones, pitch shapes and sandhi. Pure functions, no browser APIs.

// Chao tone letters, 1 (low) to 5 (high).
export const SHAPES = {
  1: [5, 5],
  2: [3, 5],
  3: [2, 1, 4], // phrase-final full third
  "3h": [2, 1], // half-third, anywhere else
  4: [5, 1],
};

// Neutral tone height by previous surface tone.
export const NEUTRAL_AFTER = { 1: 2, 2: 3, 3: 4, 4: 1 };

const SYLLABLE = /[a-zü:v]+r?[1-5]/g;

// "wo3 xi3huan5 ni3" -> [{ py: "wo", tone: 3, word: 0 }, ...]
// Words are separated by spaces; syllables inside a word are joined.
export function parsePinyin(py) {
  const out = [];
  py.trim().split(/\s+/).forEach((word, w) => {
    const syls = word.toLowerCase().match(SYLLABLE) || [];
    syls.forEach((s) => out.push({ py: s.slice(0, -1), tone: +s.slice(-1), word: w }));
  });
  return out;
}

// Applies 一/不 rules, 3-3 sandhi and neutral heights.
// `hz` is the characters in order, one per syllable (spaces ignored).
export function applySandhi(sylls, hz = "") {
  const chars = [...hz.replace(/\s/g, "")];
  let c = 0;
  const s = sylls.map((x) => {
    let h = chars[c++] || "";
    if (x.py.endsWith("r") && x.py !== "er" && chars[c] === "儿") h += chars[c++]; // erhua: 哪儿 = one syllable
    return { ...x, hz: h, written: x.tone, surface: x.tone, rule: "" };
  });

  // 一 and 不 in X一X (看一看) and X不X (好不好) become neutral.
  s.forEach((x, i) => {
    if ((x.hz === "一" || x.hz === "不") && i > 0 && i < s.length - 1 && s[i - 1].hz && s[i - 1].hz === s[i + 1].hz) {
      x.surface = 5;
      x.rule = x.hz === "一" ? "一 in reduplication" : "不 in A-not-A";
    }
  });

  s.forEach((x, i) => {
    if (x.rule) return;
    const next = s[i + 1];
    if (x.hz === "一" && x.written === 1) {
      const wordFinal = !next || next.word !== x.word;
      const ordinal = i > 0 && s[i - 1].hz === "第";
      if (!next || ordinal || (wordFinal && !isMeasureWord(next))) return;
      x.surface = next.written === 4 ? 2 : 4;
      x.rule = next.written === 4 ? "一 before T4" : "一 before T1–3";
    } else if (x.hz === "不" && x.written === 4 && next && next.written === 4) {
      x.surface = 2;
      x.rule = "不 before T4";
    }
  });

  // 3-3: every T3 directly followed by a T3 becomes T2, so a run of
  // threes keeps only its last (你好 2-3, 展览馆 2-2-3, 我有点 2-2-3).
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i].surface === 3 && s[i].written === 3 && s[i + 1].written === 3) {
      s[i].surface = 2;
      s[i].rule = "3-3 sandhi";
    }
  }

  // Shapes, with neutral height taken from the previous surface tone.
  s.forEach((x, i) => {
    const prev = s[i - 1];
    if (x.surface === 5) {
      const level = !prev ? 3 : prev.surface === 5 ? Math.max(1, prev.shape[0] - 1) : NEUTRAL_AFTER[prev.surface];
      x.shape = [level];
    } else if (x.surface === 3) {
      x.shape = i === s.length - 1 ? SHAPES[3] : SHAPES["3h"];
    } else {
      x.shape = SHAPES[x.surface];
    }
  });
  return s;
}

// 一 followed by a measure word in its own "word" (一 个) still sandhis.
function isMeasureWord(next) {
  return ["个", "下", "点", "起", "块", "样", "次", "会"].includes(next.hz);
}

// Average height used for register fit.
export function registerTarget(x) {
  if (x.surface === 5) return x.shape[0];
  if (x.surface === 3) return x.shape.length === 3 ? 2 : 1.5;
  return { 1: 5, 2: 4, 4: 3 }[x.surface];
}

export const toneLabel = (t) => (t === 5 ? "0" : String(t));

// Pinyin with tone marks for display.
const MARKS = { a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", ü: "ǖǘǚǜ" };
export function marked(py, tone) {
  py = py.replace(/u:|v/g, "ü");
  if (tone === 5) return py;
  const pos = /[ae]/.test(py) ? py.search(/[ae]/) : py.includes("ou") ? py.indexOf("o") : lastVowel(py);
  if (pos < 0) return py;
  return py.slice(0, pos) + MARKS[py[pos]][tone - 1] + py.slice(pos + 1);
}
function lastVowel(py) {
  for (let i = py.length - 1; i >= 0; i--) if (MARKS[py[i]]) return i;
  return -1;
}
