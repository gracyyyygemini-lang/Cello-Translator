// Tests for sandhi and scoring. Runs in the browser (test.html) or Node:
//   node js/tests.js

import { parsePinyin, applySandhi } from "./tones.js";
import { align, scoreSyllable, noteLevels, rank } from "./scoring.js";
import { SENTENCES } from "./data.js";

const results = [];
function test(group, name, fn) {
  try {
    fn();
    results.push({ group, name, ok: true });
  } catch (e) {
    results.push({ group, name, ok: false, error: e.message });
  }
}
function eq(actual, expected, msg = "") {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`);
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}

const surface = (hz, py) => applySandhi(parsePinyin(py), hz).map((s) => s.surface);
const shapes = (hz, py) => applySandhi(parsePinyin(py), hz).map((s) => s.shape);

// Sandhi
test("Sandhi", "你好 → 2 3", () => eq(surface("你好", "ni3hao3"), [2, 3]));
test("Sandhi", "展览馆 → 2 2 3", () => eq(surface("展览馆", "zhan3lan3guan3"), [2, 2, 3]));
test("Sandhi", "我有点饿 → 2 2 3 4", () => eq(surface("我有点饿", "wo3 you3dian3 e4"), [2, 2, 3, 4]));
test("Sandhi", "我好想你 → 2 2 2 3", () => eq(surface("我好想你", "wo3 hao3 xiang3 ni3"), [2, 2, 2, 3]));
test("Sandhi", "neutral breaks a 3-3 run: 我喜欢你", () => eq(surface("我喜欢你", "wo3 xi3huan5 ni3"), [2, 3, 5, 3]));
test("Sandhi", "一 before T4: 一下 → yi2", () => eq(surface("一下", "yi1xia4"), [2, 4]));
test("Sandhi", "一 before T3: 一起 → yi4", () => eq(surface("一起", "yi1qi3"), [4, 3]));
test("Sandhi", "一 before T1: 一天 → yi4", () => eq(surface("一天", "yi1tian1"), [4, 1]));
test("Sandhi", "一 alone stays yi1", () => eq(surface("一", "yi1"), [1]));
test("Sandhi", "一 word-final stays yi1: 十一", () => eq(surface("十一", "shi2yi1"), [2, 1]));
test("Sandhi", "一 ordinal stays yi1: 第一天", () => eq(surface("第一天", "di4 yi1 tian1"), [4, 1, 1]));
test("Sandhi", "看一看 → 一 neutral", () => eq(surface("看一看", "kan4 yi1 kan4"), [4, 5, 4]));
test("Sandhi", "不 before T4: 不错 → bu2", () => eq(surface("不错", "bu4cuo4"), [2, 4]));
test("Sandhi", "不 before T2 stays bu4", () => eq(surface("不来", "bu4 lai2"), [4, 2]));
test("Sandhi", "好不好 → 不 neutral, 好 keeps 3", () => eq(surface("好不好", "hao3 bu4 hao3"), [3, 5, 3]));
test("Sandhi", "去不去 → 不 neutral (not bu2)", () => eq(surface("去不去", "qu4 bu4 qu4"), [4, 5, 4]));
test("Sandhi", "erhua: 车站在哪儿 is 5 syllables", () => eq(applySandhi(parsePinyin("che1zhan4 zai4 nar3"), "车站在哪儿").map((s) => s.hz), ["车", "站", "在", "哪儿"]));

// Shapes
test("Shapes", "neutral after T1 = 2", () => eq(shapes("他的", "ta1 de5")[1], [2]));
test("Shapes", "neutral after T2 = 3", () => eq(shapes("国的", "guo2 de5")[1], [3]));
test("Shapes", "neutral after T3 = 4", () => eq(shapes("姐姐", "jie3jie5")[1], [4]));
test("Shapes", "neutral after T4 = 1", () => eq(shapes("谢谢", "xie4xie5")[1], [1]));
test("Shapes", "neutral after sandhi T2 uses T2 (3)", () => eq(shapes("你好吗", "ni3 hao3 ma5").map((s) => s.join("")), ["35", "21", "4"]));
test("Shapes", "final T3 is full 214, otherwise half 21", () => eq(shapes("好人好", "hao3 ren2 hao3").map((s) => s.join("")), ["21", "35", "214"]));

// Scoring
const notesOf = (...midi) => midi.map((m) => ({ midi: m }));
const range = { lo: 48, hi: 60 };
const sylls = (hz, py) => applySandhi(parsePinyin(py), hz);

test("Scoring", "levels map the speaker range to 1–5", () => eq(noteLevels(notesOf(48, 54, 60), range), [1, 3, 5]));
test("Scoring", "narrow range is widened to 4 semitones", () => eq(noteLevels(notesOf(50, 52), { lo: 51, hi: 51 }), [2, 4]));
test("Scoring", "T2 on a held note: rising into next note scores 1", () => {
  const s = sylls("来", "lai2");
  const r = scoreSyllable(s[0], s, 0, notesOf(55, 58), noteLevels(notesOf(55, 58), range), 0, 0);
  eq(r.parts.map((p) => [p.kind, p.value]), [["next", 1]]);
});
test("Scoring", "T4 on a held note: falling into next note scores 1", () => {
  const s = sylls("去", "qu4");
  const r = scoreSyllable(s[0], s, 0, notesOf(58, 52), noteLevels(notesOf(58, 52), range), 0, 0);
  eq(r.direction, 1);
});
test("Scoring", "T4 held, last note: no direction penalty", () => {
  const s = sylls("去", "qu4");
  const r = scoreSyllable(s[0], s, 0, notesOf(55), noteLevels(notesOf(55), range), 0, 0);
  eq(r.direction, 1);
});
test("Scoring", "T2 on a falling slur clashes", () => {
  const s = sylls("来", "lai2");
  const n = notesOf(56, 50);
  const r = scoreSyllable(s[0], s, 0, n, noteLevels(n, range), 0, 1);
  eq(r.parts[0].value, 0);
});
test("Scoring", "T1 high fits better than T3 on a high note", () => {
  const n = notesOf(60);
  const t1 = sylls("天", "tian1");
  const t3 = sylls("好", "hao3");
  ok(scoreSyllable(t1[0], t1, 0, n, noteLevels(n, range), 0, 0).score > scoreSyllable(t3[0], t3, 0, n, noteLevels(n, range), 0, 0).score, "T1 should win");
});
test("Scoring", "falling melody prefers 4-shaped 谢谢 over rising", () => {
  const down = notesOf(58, 50);
  const up = notesOf(50, 58);
  const s = sylls("多谢", "duo1xie4");
  ok(align(s, down, range).total > align(s, up, range).total, "falling should fit 多谢 (55→51)");
});
test("Scoring", "alignment uses slur when notes outnumber syllables", () => {
  const r = align(sylls("爱你", "ai4 ni3"), notesOf(58, 52, 50), range);
  eq(r.steps.map((s) => s.notes.length), [2, 1]);
});
test("Scoring", "neutral may share a note; two full tones may not (strict)", () => {
  const r = align(sylls("谢谢你", "xie4xie5 ni3"), notesOf(58, 50), range);
  ok(!r.forced, "should be strict");
  ok(r.steps.some((s) => s.syl.length === 2), "a neutral should share");
});
test("Scoring", "too many full tones falls back to forced mode", () => {
  const r = align(sylls("非常感谢", "fei1chang2 gan3xie4"), notesOf(58, 50), range);
  ok(r.forced, "should be forced");
});
test("Scoring", "every preset ranks without errors, scores in 0–100", () => {
  const n = notesOf(55, 57, 53, 52, 50, 48);
  SENTENCES.forEach((sent) => {
    const ranked = rank(sent.zh.map((c) => ({ ...c, sylls: sylls(c.hz, c.py) })), n, range);
    ranked.forEach((c) => ok(c.result.total >= 0 && c.result.total <= 100, `${c.hz}: ${c.result.total}`));
  });
});
test("Data", "every candidate has one character per syllable", () => {
  SENTENCES.forEach((sent) =>
    sent.zh.forEach((c) => {
      const s = sylls(c.hz, c.py);
      eq(s.map((x) => x.hz).join(""), c.hz, c.hz);
    })
  );
});

export { results };

if (typeof window === "undefined") {
  const failed = results.filter((r) => !r.ok);
  results.forEach((r) => console.log(`${r.ok ? "pass" : "FAIL"}  ${r.group} · ${r.name}${r.ok ? "" : "\n      " + r.error}`));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}
