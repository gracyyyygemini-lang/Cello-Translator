import { SENTENCES } from "./data.js";
import { parsePinyin, applySandhi, marked, toneLabel } from "./tones.js";
import { rank } from "./scoring.js";
import { analyze, toNotes, demoSignal } from "./pitch.js";
import { recorder, decode, playMelody, speak, chineseVoice, loadSampler } from "./audio.js";
import { drawWave, drawStaff, drawChinese, toneSvg } from "./render.js";

const $ = (s) => document.querySelector(s);
const state = { sentence: 0, raw: false, cello: "sampled", audio: null, analysis: null, notes: null, ranked: null, shown: 0 };

// Sentences
function renderSentences() {
  $("#sentences").innerHTML = SENTENCES.map((s, i) => `<li><button data-i="${i}" class="${i === state.sentence ? "on" : ""}">${s.de}</button></li>`).join("");
  const zh = SENTENCES[state.sentence].zh;
  $("#pool").innerHTML = zh.map((c) => `<li><span class="hz">${c.hz}</span><span class="py">${pinyinLine(sylls(c))}</span></li>`).join("");
}
$("#sentences").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.sentence = +b.dataset.i;
  renderSentences();
  if (state.analysis) update();
});

const sylls = (c) => applySandhi(parsePinyin(c.py), c.hz);
const pinyinLine = (ss) => ss.map((s) => marked(s.py, s.surface)).join(" ");

// Toggles
document.querySelectorAll(".toggle").forEach((t) =>
  t.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    t.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    state[t.dataset.key] = t.dataset.key === "raw" ? b.dataset.v === "raw" : b.dataset.v;
    if (t.dataset.key === "cello" && b.dataset.v === "sampled") loadSampler().catch(() => status("Samples didn't load. Using the synthesized cello."));
    if (state.analysis) update();
  })
);

// Recording
const rec = recorder();
const recBtn = $("#record");
let holding = false;
let started = null;
let timer;

async function startRec() {
  if (holding) return;
  holding = true;
  recBtn.classList.add("live");
  recBtn.textContent = "Recording — release to stop";
  try {
    started = rec.start();
    await started;
  } catch {
    holding = false;
    started = null;
    resetRecBtn();
    return status("Microphone unavailable. Upload a WAV instead.");
  }
  if (!holding) return; // released while the permission prompt was open
  const t0 = performance.now();
  timer = setInterval(() => status(`${((performance.now() - t0) / 1000).toFixed(1)} s`), 100);
}
async function stopRec() {
  const pending = started;
  if (!pending) return;
  started = null;
  holding = false;
  try {
    await pending;
  } catch {
    return;
  }
  clearInterval(timer);
  resetRecBtn();
  try {
    load(await rec.stop());
  } catch {
    status("Recording failed. Try again.");
  }
}
function resetRecBtn() {
  recBtn.classList.remove("live");
  recBtn.textContent = "Hold to record";
}
recBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  startRec();
});
["pointerup", "pointerleave", "pointercancel"].forEach((ev) => recBtn.addEventListener(ev, () => holding && stopRec()));
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !e.repeat && document.activeElement === recBtn) {
    e.preventDefault();
    startRec();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space" && holding) stopRec();
});

$("#upload").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    load(await decode(await f.arrayBuffer()));
  } catch {
    status("Couldn't read that file.");
  }
  e.target.value = "";
});
$("#demo").addEventListener("click", () => {
  const sr = 44100;
  load({ samples: demoSignal(SENTENCES[state.sentence], sr), sr, demo: true });
});

function load(audio) {
  if (audio.samples.length < audio.sr * 0.3) return status("Too short. Hold a little longer.");
  state.audio = audio;
  state.analysis = analyze(audio.samples, audio.sr, SENTENCES[state.sentence].syl);
  if (!state.analysis.segments.length) {
    state.analysis = null;
    return status("No voiced syllables found. Try again closer to the mic.");
  }
  status(audio.demo ? "Demo voice, generated in the browser." : "");
  update();
}

// Analysis → ranking → lanes
function update() {
  const { audio, analysis } = state;
  state.notes = toNotes(analysis.segments, state.raw);
  const cands = SENTENCES[state.sentence].zh.map((c) => ({ ...c, sylls: sylls(c) }));
  state.ranked = rank(cands, state.notes, analysis.range);
  state.shown = 0;
  $("#results").hidden = false;
  requestAnimationFrame(() => {
    $("#results").classList.add("in");
    drawWave($("#wave"), audio.samples, audio.sr, analysis);
    drawLanes();
    renderRanking();
  });
}

function drawLanes() {
  const c = state.ranked[state.shown];
  const clashNotes = new Set();
  c.result.perSyl.forEach((r) => r.clash && r.notes.forEach((j) => clashNotes.add(j)));
  const xs = drawStaff($("#staff"), state.notes, { raw: state.raw, steps: c.result.steps, clashNotes });
  drawChinese($("#chinese"), c.result, xs, $("#staff svg").clientWidth || $("#staff").scrollWidth);
  $("#lane-zh-label").textContent = state.shown === 0 ? "Chinese · best fit" : `Chinese · #${state.shown + 1}`;
  $("#score-big").textContent = c.result.total;
}

function renderRanking() {
  $("#ranking").innerHTML = state.ranked
    .map((c, k) => {
      const r = c.result;
      const clashes = r.perSyl.filter((p) => p.clash).length;
      return `<li class="${k === state.shown ? "on" : ""}" data-k="${k}">
        <button class="row">
          <span class="rank">${String(k + 1).padStart(2, "0")}</span>
          <span class="hz">${c.hz}</span>
          <span class="py">${pinyinLine(c.sylls)}</span>
          <span class="meta">${clashes ? `<em>${clashes} clash${clashes > 1 ? "es" : ""}</em>` : ""}${r.forced ? " · crowded" : ""}</span>
          <span class="score">${r.total}</span>
        </button>
        <div class="detail">${breakdown(r)}</div>
      </li>`;
    })
    .join("");
}

function breakdown(r) {
  const pct = (v) => Math.round(v * 100);
  const noteName = (j) => Tone.Frequency(state.notes[j].midi, "midi").toNote();
  const rows = r.perSyl
    .map((p) => {
      const s = p.syl;
      const tone = toneLabel(s.written) + (s.surface !== s.written ? ` → ${toneLabel(s.surface)}` : "");
      const parts = p.parts.map((x) => `${x.kind} ${pct(x.value)}`).join(", ");
      return `<tr class="${p.clash ? "clash" : ""}">
        <td class="hz">${s.hz}</td><td>${marked(s.py, s.surface)}</td>
        <td>${tone}${s.rule ? `<small>${s.rule}</small>` : ""}</td>
        <td>${toneSvg(s.shape, p.clash)}</td>
        <td>${p.notes.map(noteName).join("–")}${p.shared ? "<small>shared</small>" : ""}</td>
        <td>${pct(p.register)}<small>${p.level.toFixed(1)} vs ${p.target}</small></td>
        <td>${pct(p.direction)}<small>${parts || "—"}</small></td>
        <td>${pct(p.score)}</td></tr>`;
    })
    .join("");
  return `<table><thead><tr><th></th><th>Pinyin</th><th>Tone</th><th>Shape</th><th>Note</th><th>Register</th><th>Direction</th><th>Fit</th></tr></thead><tbody>${rows}</tbody></table>`;
}

$("#ranking").addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li || !e.target.closest(".row")) return;
  const k = +li.dataset.k;
  const wasOpen = li.classList.contains("open");
  document.querySelectorAll("#ranking li").forEach((x) => x.classList.remove("open", "on"));
  if (!wasOpen) li.classList.add("open");
  li.classList.add("on");
  state.shown = k;
  drawLanes();
});

// Playback
function highlight(j) {
  document.querySelectorAll("#chinese .syl").forEach((d) => d.classList.toggle("now", d.dataset.notes.split(",").includes(String(j))));
}
const current = () => state.ranked[state.shown];
$("#play-cello").addEventListener("click", () => playMelody(state.notes, state.cello, highlight));
$("#speak").addEventListener("click", sayChinese);
$("#play-both").addEventListener("click", () => {
  playMelody(state.notes, state.cello, highlight);
  sayChinese();
});
function sayChinese() {
  if (!("speechSynthesis" in window)) return status("Speech synthesis isn't available in this browser.");
  if (!chineseVoice()) status("No Chinese voice found; your system may read it with another voice.");
  speak(current().hz);
}
speechSynthesis?.getVoices();

let resizeT;
window.addEventListener("resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => state.analysis && (drawWave($("#wave"), state.audio.samples, state.audio.sr, state.analysis), drawLanes()), 150);
});

function status(msg) {
  $("#status").textContent = msg;
}

renderSentences();
