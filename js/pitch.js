// Pitch curve → syllables → notes.

import { PitchDetector } from "https://cdn.jsdelivr.net/npm/pitchy@4.1.0/+esm";

const D_MINOR = [0, 2, 4, 5, 7, 9, 10];
const CELLO_LO = 36; // C2
const CELLO_HI = 69; // A4

export const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

export function analyze(samples, sr, expectedSyl) {
  const curve = pitchCurve(samples, sr);
  const segments = segment(curve, expectedSyl);
  const voiced = curve.filter((f) => f.hz).map((f) => hzToMidi(f.hz)).sort((a, b) => a - b);
  const range = voiced.length ? { lo: pct(voiced, 0.1), hi: pct(voiced, 0.9) } : { lo: 48, hi: 55 };
  return { curve, segments, range };
}

// Frames every 5 ms: { t, hz (null if unvoiced), rms }.
function pitchCurve(samples, sr) {
  const win = 2 ** Math.round(Math.log2(sr * 0.04));
  const hop = Math.round(sr * 0.005);
  const det = PitchDetector.forFloat32Array(win);
  det.minVolumeDecibels = -50;
  const frames = [];
  for (let i = 0; i + win <= samples.length; i += hop) {
    const buf = samples.subarray(i, i + win);
    let e = 0;
    for (let k = 0; k < win; k++) e += buf[k] * buf[k];
    const [hz, clarity] = det.findPitch(buf, sr);
    frames.push({ t: (i + win / 2) / sr, hz: clarity > 0.8 && hz > 60 && hz < 700 ? hz : null, rms: Math.sqrt(e / win) });
  }
  const peak = Math.max(...frames.map((f) => f.rms), 1e-9);
  frames.forEach((f) => {
    if (f.rms < 0.06 * peak) f.hz = null;
  });
  return cleanPitch(frames);
}

// Median filter, and drop octave jumps against the local median.
function cleanPitch(frames) {
  const midi = frames.map((f) => (f.hz ? hzToMidi(f.hz) : null));
  return frames.map((f, i) => {
    if (!f.hz) return f;
    const near = midi.slice(Math.max(0, i - 6), i + 7).filter((m) => m !== null).sort((a, b) => a - b);
    const med = near[near.length >> 1];
    if (near.length < 4 || Math.abs(midi[i] - med) > 7) return { ...f, hz: null };
    const local = midi.slice(Math.max(0, i - 2), i + 3).filter((m) => m !== null).sort((a, b) => a - b);
    return { ...f, hz: midiToHz(local[local.length >> 1]) };
  });
}

// Energy peaks → syllables. Each syllable gets the median pitch of its
// voiced nucleus. `expected` caps the count (German syllables).
function segment(curve, expected) {
  const env = smooth(curve.map((f) => f.rms), 6);
  const peak = Math.max(...env, 1e-9);
  const floor = 0.08 * peak;

  let peaks = [];
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] < floor * 1.5) continue;
    let isMax = true;
    for (let k = Math.max(0, i - 10); k <= Math.min(env.length - 1, i + 10); k++) if (env[k] > env[i]) isMax = false;
    if (isMax && (!peaks.length || i - peaks[peaks.length - 1] > 1)) peaks.push(i);
  }
  peaks = peaks.filter((p) => curve.slice(Math.max(0, p - 8), p + 9).some((f) => f.hz));

  // Remove the shallowest peaks until the count fits.
  const dip = (k) => {
    const p = peaks[k];
    const left = k > 0 ? Math.min(...env.slice(peaks[k - 1], p + 1)) : 0;
    const right = k < peaks.length - 1 ? Math.min(...env.slice(p, peaks[k + 1] + 1)) : 0;
    return 1 - Math.max(left, right) / env[p];
  };
  const cap = expected ? expected + 1 : Infinity;
  while (peaks.length > cap) {
    let worst = 0;
    for (let k = 1; k < peaks.length; k++) if (dip(k) < dip(worst)) worst = k;
    peaks.splice(worst, 1);
  }
  // Merge peaks with almost no dip between them.
  for (let k = peaks.length - 1; k > 0; k--) if (dip(k) < 0.12 && peaks.length > 1) peaks.splice(env[peaks[k]] > env[peaks[k - 1]] ? k - 1 : k, 1);

  const segs = [];
  peaks.forEach((p, k) => {
    let a = k > 0 ? argmin(env, peaks[k - 1], p) : p;
    let b = k < peaks.length - 1 ? argmin(env, p, peaks[k + 1]) : p;
    if (k === 0) while (a > 0 && env[a - 1] > floor) a--;
    if (k === peaks.length - 1) while (b < env.length - 1 && env[b + 1] > floor) b++;
    const nucleus = [];
    for (let i = a; i <= b; i++) if (curve[i].hz && env[i] > 0.4 * env[p]) nucleus.push(hzToMidi(curve[i].hz));
    if (!nucleus.length) return;
    nucleus.sort((x, y) => x - y);
    segs.push({ t0: curve[a].t, t1: curve[b].t, rawMidi: nucleus[nucleus.length >> 1] });
  });
  return segs;
}

// Syllables → notes, kept near the voice, snapped to D minor or rounded.
export function toNotes(segments, raw) {
  const durs = segments.map((s) => s.t1 - s.t0).sort((a, b) => a - b);
  const med = durs[durs.length >> 1] || 0.2;
  return segments.map((s) => {
    let m = s.rawMidi;
    while (m < CELLO_LO - 0.5) m += 12;
    while (m > CELLO_HI + 0.5) m -= 12;
    const midi = raw ? Math.round(m) : snap(m);
    const ratio = (s.t1 - s.t0) / med;
    return { ...s, midi, duration: ratio < 0.7 ? "8" : ratio < 1.6 ? "q" : "h" };
  });
}

export function snap(m) {
  let best = null;
  for (let c = Math.floor(m) - 2; c <= Math.ceil(m) + 2; c++) {
    if (!D_MINOR.includes(((c % 12) + 12) % 12)) continue;
    if (best === null || Math.abs(c - m) < Math.abs(best - m)) best = c;
  }
  return best;
}

// A voice-like test signal: syllable bumps on a falling contour,
// rising at the end of yes/no questions.
export function demoSignal(sentence, sr = 44100) {
  const n = sentence.syl;
  const rise = /^(Kommst|Darf)/.test(sentence.de);
  const sylDur = 0.2;
  const gap = 0.06;
  const out = new Float32Array(Math.ceil(sr * (n * (sylDur + gap) + 0.4)));
  let phase = 0;
  for (let k = 0; k < n; k++) {
    const x = k / Math.max(1, n - 1);
    const accent = k === 0 ? 1.15 : k === Math.floor(n / 2) ? 1.08 : 1;
    const base = 150 - 40 * x + (rise && k === n - 1 ? 60 : 0);
    const len = Math.floor(sr * (k === n - 1 ? sylDur * 1.6 : sylDur));
    const start = Math.floor(sr * (0.2 + k * (sylDur + gap)));
    for (let i = 0; i < len && start + i < out.length; i++) {
      const u = i / len;
      const f = base * accent * (1 + (rise && k === n - 1 ? 0.25 * u : -0.04 * u));
      phase += (2 * Math.PI * f) / sr;
      let v = 0;
      for (let h = 1; h <= 8; h++) v += Math.sin(h * phase) / h;
      out[start + i] = 0.25 * v * Math.sin(Math.PI * u) ** 0.6;
    }
  }
  return out;
}

function smooth(a, r) {
  return a.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, i - r); k <= Math.min(a.length - 1, i + r); k++) {
      s += a[k];
      c++;
    }
    return s / c;
  });
}
function argmin(a, from, to) {
  let best = from;
  for (let i = from; i <= to; i++) if (a[i] < a[best]) best = i;
  return best;
}
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
