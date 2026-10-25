// Aligns syllables to notes and scores how well tones fit the melody.
// Pure functions, no browser APIs.

import { registerTarget } from "./tones.js";

export const CLASH = 0.4;
const PEN_SLUR = 0.1; // one syllable over two notes
const PEN_SHARE = 0.25; // a neutral sharing a note with a full tone
const PEN_FORCED = 0.8; // two full tones on one note, last resort
const PEN_SKIP = 0.5; // a note left without a syllable, last resort

// Note heights on the 1–5 scale from the speaker's own range.
// `range` = { lo, hi } in MIDI (10th and 90th percentile of the voice).
export function noteLevels(notes, range) {
  let { lo, hi } = range;
  if (hi - lo < 4) {
    const mid = (lo + hi) / 2;
    lo = mid - 2;
    hi = mid + 2;
  }
  return notes.map((n) => clamp(1 + (4 * (n.midi - lo)) / (hi - lo), 0.5, 5.5));
}

const sign = (d, flat) => (Math.abs(d) < flat ? 0 : Math.sign(d));
function agree(expected, actual) {
  if (expected === actual) return 1;
  if (expected === 0 || actual === 0) return 0.5;
  return 0;
}

// Scores syllable `i` sung on notes [j0..j1].
export function scoreSyllable(syl, sylls, i, notes, levels, j0, j1) {
  const level = (levels[j0] + levels[j1]) / 2;
  const target = registerTarget(syl);
  const register = clamp(1 - Math.abs(level - target) / 2.5, 0, 1);

  const parts = [];
  const t = syl.surface;

  // Inside the syllable.
  if (t !== 5) {
    const want = { 1: 0, 2: 1, 3: -1, 4: -1 }[t];
    if (j1 > j0) {
      parts.push({ kind: "slur", value: agree(want, sign(notes[j1].midi - notes[j0].midi, 0.5)) });
    } else if (t === 2 || t === 4) {
      // A held note can't rise or fall: use the step into the next note.
      const next = notes[j1 + 1];
      if (next) parts.push({ kind: "next", value: agree(want, sign(next.midi - notes[j1].midi, 0.5)) });
    } else {
      parts.push({ kind: "held", value: 1 }); // T1 and T3 sit still on one note
    }
  }

  // Into the syllable: previous tone's end to this tone's start.
  if (i > 0 && j0 > 0) {
    const prev = sylls[i - 1];
    const want = sign(syl.shape[0] - prev.shape[prev.shape.length - 1], 1);
    parts.push({ kind: "into", value: agree(want, sign(notes[j0].midi - notes[j0 - 1].midi, 0.5)) });
  }

  const direction = parts.length ? parts.reduce((a, p) => a + p.value, 0) / parts.length : 1;
  const score = 0.5 * register + 0.5 * direction;
  return { register, direction, parts, score, level, target };
}

// Two syllables share note j: the second one's "into" step is flat.
function scoreShared(sylls, i, notes, levels, j) {
  const a = scoreSyllable(sylls[i], sylls, i, notes, levels, j, j);
  const b = scoreSyllable(sylls[i + 1], sylls, i + 1, notes, levels, j, j);
  const prev = sylls[i];
  const want = sign(sylls[i + 1].shape[0] - prev.shape[prev.shape.length - 1], 1);
  const into = agree(want, 0);
  const others = b.parts.filter((p) => p.kind !== "into");
  b.parts = [...others, { kind: "into", value: into }];
  b.direction = b.parts.reduce((s, p) => s + p.value, 0) / b.parts.length;
  b.score = 0.5 * b.register + 0.5 * b.direction;
  return [a, b];
}

const weight = (syl) => (syl.surface === 5 ? 0.3 : 1);

// DP over (syllables used, notes used). Cost is the weighted shortfall
// from a perfect fit plus move penalties.
export function align(sylls, notes, range) {
  const strict = runDP(sylls, notes, range, false);
  return strict || runDP(sylls, notes, range, true);
}

function runDP(sylls, notes, range, forced) {
  const n = sylls.length;
  const m = notes.length;
  const levels = noteLevels(notes, range);
  const best = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null));
  best[0][0] = { cost: 0, steps: [] };

  const relax = (i, j, ni, nj, cost, step) => {
    const cur = best[i][j];
    if (!cur || ni > n || nj > m) return;
    const total = cur.cost + cost;
    if (!best[ni][nj] || total < best[ni][nj].cost) best[ni][nj] = { cost: total, steps: [...cur.steps, step] };
  };

  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (!best[i][j]) continue;
      if (i < n && j < m) {
        const r = scoreSyllable(sylls[i], sylls, i, notes, levels, j, j);
        relax(i, j, i + 1, j + 1, weight(sylls[i]) * (1 - r.score), { syl: [i], notes: [j], results: [r], penalty: 0 });
      }
      if (i < n && j + 1 < m) {
        const r = scoreSyllable(sylls[i], sylls, i, notes, levels, j, j + 1);
        relax(i, j, i + 1, j + 2, weight(sylls[i]) * (1 - r.score) + PEN_SLUR, { syl: [i], notes: [j, j + 1], results: [r], penalty: PEN_SLUR });
      }
      if (i + 1 < n && j < m) {
        const hasNeutral = sylls[i].surface === 5 || sylls[i + 1].surface === 5;
        if (hasNeutral || forced) {
          const pen = hasNeutral ? PEN_SHARE : PEN_FORCED;
          const [a, b] = scoreShared(sylls, i, notes, levels, j);
          const cost = weight(sylls[i]) * (1 - a.score) + weight(sylls[i + 1]) * (1 - b.score) + pen;
          relax(i, j, i + 2, j + 1, cost, { syl: [i, i + 1], notes: [j], results: [a, b], penalty: pen });
        }
      }
      if (forced && j < m) {
        relax(i, j, i, j + 1, PEN_SKIP, { syl: [], notes: [j], results: [], penalty: PEN_SKIP });
      }
    }
  }

  const end = best[n][m];
  if (!end) return null;
  return summarize(sylls, end.steps, forced);
}

function summarize(sylls, steps, forced) {
  const perSyl = [];
  let penalties = 0;
  steps.forEach((st) => {
    penalties += st.penalty;
    st.syl.forEach((i, k) => {
      const r = st.results[k];
      perSyl[i] = { ...r, syl: sylls[i], notes: st.notes, shared: st.syl.length === 2, clash: r.score < CLASH };
    });
  });
  const wsum = sylls.reduce((a, s) => a + weight(s), 0);
  const mean = perSyl.reduce((a, r) => a + weight(r.syl) * r.score, 0) / wsum;
  const total = Math.round(clamp(mean - penalties / sylls.length, 0, 1) * 100);
  return { total, perSyl, steps, forced };
}

// Ranks candidates (each already run through applySandhi).
export function rank(candidates, notes, range) {
  return candidates
    .map((c) => ({ ...c, result: align(c.sylls, notes, range) }))
    .sort((a, b) => b.result.total - a.result.total);
}

function clamp(x, a, b) {
  return Math.min(b, Math.max(a, x));
}
