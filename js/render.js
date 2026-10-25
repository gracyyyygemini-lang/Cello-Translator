// The three lanes: German waveform + pitch, cello staff, Chinese text.

import { marked, toneLabel } from "./tones.js";
import { hzToMidi } from "./pitch.js";

const INK = "#111";
const FAINT = "#d6d6d6";
const RED = getComputedStyle(document.documentElement).getPropertyValue("--clash").trim() || "#a8423a";
const STAFF_SCALE = 1.25;
const NOTE_SPACE = 74;

function setupCanvas(canvas, h) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentElement.clientWidth;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

export function drawWave(canvas, samples, sr, analysis) {
  const { g, w, h } = setupCanvas(canvas, 150);
  g.clearRect(0, 0, w, h);
  const dur = samples.length / sr;
  const x = (t) => (t / dur) * w;

  // Waveform, light.
  const mid = h / 2;
  g.fillStyle = FAINT;
  const per = Math.max(1, Math.floor(samples.length / w));
  for (let px = 0; px < w; px++) {
    let lo = 0;
    let hi = 0;
    for (let i = px * per; i < (px + 1) * per && i < samples.length; i++) {
      if (samples[i] < lo) lo = samples[i];
      if (samples[i] > hi) hi = samples[i];
    }
    g.fillRect(px, mid - hi * mid * 0.9, 1, Math.max(0.5, (hi - lo) * mid * 0.9));
  }

  // Syllable spans as hairlines along the bottom.
  g.strokeStyle = INK;
  g.lineWidth = 1;
  analysis.segments.forEach((s) => {
    g.beginPath();
    g.moveTo(x(s.t0), h - 0.5);
    g.lineTo(x(s.t1), h - 0.5);
    g.stroke();
    g.fillRect(x(s.t0), h - 5, 1, 5);
  });

  // Pitch curve.
  const voiced = analysis.curve.filter((f) => f.hz).map((f) => hzToMidi(f.hz));
  if (!voiced.length) return;
  const lo = Math.min(...voiced) - 2;
  const hi = Math.max(...voiced) + 2;
  const y = (m) => 10 + (1 - (m - lo) / (hi - lo)) * (h - 30);
  g.strokeStyle = INK;
  g.lineWidth = 1.5;
  g.lineJoin = "round";
  g.beginPath();
  let pen = false;
  analysis.curve.forEach((f) => {
    if (!f.hz) return (pen = false);
    const px = x(f.t);
    const py = y(hzToMidi(f.hz));
    pen ? g.lineTo(px, py) : g.moveTo(px, py);
    pen = true;
  });
  g.stroke();
}

const PC_KEYS = ["c", "c#", "d", "eb", "e", "f", "f#", "g", "g#", "a", "bb", "b"];
const vfKey = (m) => `${PC_KEYS[m % 12]}/${Math.floor(m / 12) - 1}`;

// Draws the melody and returns each note's x centre (px, in container).
export function drawStaff(el, notes, { raw, steps = [], clashNotes = new Set() }) {
  const VF = Vex.Flow;
  el.innerHTML = "";
  const width = Math.max(el.parentElement.clientWidth, 150 + notes.length * NOTE_SPACE);
  const renderer = new VF.Renderer(el, VF.Renderer.Backends.SVG);
  renderer.resize(width, 150 * STAFF_SCALE);
  const ctx = renderer.getContext();
  ctx.scale(STAFF_SCALE, STAFF_SCALE);
  const w = width / STAFF_SCALE;

  const stave = new VF.Stave(0, 18, w - 1);
  stave.addClef("bass");
  stave.addKeySignature(raw ? "C" : "Dm");
  stave.setContext(ctx).draw();

  const vfNotes = notes.map((n, i) => {
    const note = new VF.StaveNote({ clef: "bass", keys: [vfKey(n.midi)], duration: n.duration, auto_stem: true });
    if (clashNotes.has(i)) note.setStyle({ fillStyle: RED, strokeStyle: RED });
    return note;
  });
  const voice = new VF.Voice({ num_beats: 4, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT).addTickables(vfNotes);
  VF.Accidental.applyAccidentals([voice], raw ? "C" : "Dm");
  const beams = VF.Beam.generateBeams(vfNotes);
  new VF.Formatter().joinVoices([voice]).format([voice], w - stave.getNoteStartX() - 30);
  voice.draw(ctx, stave);
  beams.forEach((b) => b.setContext(ctx).draw());

  // Slurs where one syllable spans two notes.
  steps.forEach((st) => {
    if (st.syl.length === 1 && st.notes.length === 2) {
      new VF.Curve(vfNotes[st.notes[0]], vfNotes[st.notes[1]], { cps: [{ x: 0, y: 12 }, { x: 0, y: 12 }] }).setContext(ctx).draw();
    }
  });

  return vfNotes.map((n) => ((n.getNoteHeadBeginX() + n.getNoteHeadEndX()) / 2) * STAFF_SCALE);
}

// Tone shape as a tiny polyline on a 1–5 grid.
export function toneSvg(shape, clash) {
  const w = 22;
  const h = 16;
  const pts = (shape.length === 1 ? [shape[0], shape[0]] : shape).map((v, i, a) => `${(i / (a.length - 1)) * (w - 2) + 1},${h - 1 - ((v - 1) / 4) * (h - 2)}`);
  return `<svg class="tone${clash ? " clash" : ""}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><line x1="0" y1="${h - 0.5}" x2="${w}" y2="${h - 0.5}"/><polyline points="${pts.join(" ")}"/></svg>`;
}

export function drawChinese(el, result, xs, width) {
  el.style.width = width + "px";
  el.innerHTML = "";
  result.steps.forEach((st) => {
    if (!st.syl.length) return;
    const cx = st.notes.reduce((a, j) => a + xs[j], 0) / st.notes.length;
    st.syl.forEach((i, k) => {
      const r = result.perSyl[i];
      const s = r.syl;
      const div = document.createElement("div");
      div.className = "syl" + (r.clash ? " clash" : "");
      div.dataset.notes = st.notes.join(",");
      const offset = st.syl.length === 2 ? (k === 0 ? -20 : 20) : 0;
      div.style.left = cx + offset + "px";
      div.innerHTML = `<span class="hz">${s.hz}</span><span class="py">${marked(s.py, s.surface)}</span>${toneSvg(s.shape, r.clash)}<span class="tn">${toneLabel(s.written)}${s.surface !== s.written ? "→" + toneLabel(s.surface) : ""}</span>`;
      el.appendChild(div);
    });
  });
}
