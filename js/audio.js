// Recording, cello playback (Tone.js, global `Tone`) and Chinese speech.

const SAMPLE_BASE = "https://nbrosowsky.github.io/tonejs-instruments/samples/cello/";
const SAMPLE_NOTES = ["C2", "E2", "G2", "As2", "C3", "E3", "G3", "A3", "C4", "D4", "C5"];
const STRETCH = 1.3; // play a little slower than speech

let ctx;
export const audioContext = () => (ctx ||= new AudioContext());

// Hold-to-record. start() resolves once the mic is live; stop() resolves
// to { samples, sr }.
export function recorder() {
  let rec;
  let chunks = [];
  let stream;
  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
      chunks = [];
      rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.start();
    },
    stop() {
      return new Promise((resolve, reject) => {
        if (!rec || rec.state === "inactive") return reject(new Error("not recording"));
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          try {
            resolve(await decode(await new Blob(chunks).arrayBuffer()));
          } catch (e) {
            reject(e);
          }
        };
        rec.stop();
      });
    },
  };
}

export async function decode(arrayBuffer) {
  const buf = await audioContext().decodeAudioData(arrayBuffer);
  const samples = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) samples[i] += d[i] / buf.numberOfChannels;
  }
  return { samples, sr: buf.sampleRate };
}

let out;
let sampler;
let samplerReady = null;
let synth;

function output() {
  if (out) return out;
  out = new Tone.Reverb({ decay: 2.4, wet: 0.22 }).toDestination();
  return out;
}

export function loadSampler() {
  if (samplerReady) return samplerReady;
  samplerReady = new Promise((resolve, reject) => {
    sampler = new Tone.Sampler({
      urls: Object.fromEntries(SAMPLE_NOTES.map((n) => [n.replace("s", "#"), `${n}.mp3`])),
      baseUrl: SAMPLE_BASE,
      release: 1.2,
      onload: () => resolve(sampler),
      onerror: reject,
    }).connect(output());
    sampler.volume.value = -4;
  });
  return samplerReady;
}

function getSynth() {
  if (synth) return synth;
  const vibrato = new Tone.Vibrato(5.2, 0.06).connect(output());
  const filter = new Tone.Filter(1100, "lowpass", -24).connect(vibrato);
  synth = new Tone.MonoSynth({
    oscillator: { type: "fatsawtooth", count: 3, spread: 12 },
    envelope: { attack: 0.09, decay: 0.2, sustain: 0.85, release: 0.5 },
    filterEnvelope: { attack: 0.12, decay: 0.3, sustain: 0.6, release: 0.5, baseFrequency: 220, octaves: 2.2 },
  }).connect(filter);
  synth.volume.value = -14;
  return synth;
}

// Plays notes with the speech rhythm. Calls onNote(index) as each starts.
// Resolves to the total length in seconds.
export async function playMelody(notes, mode, onNote = () => {}) {
  await Tone.start();
  let inst;
  if (mode === "sampled") {
    try {
      inst = await loadSampler();
    } catch {
      inst = getSynth();
    }
  } else {
    inst = getSynth();
  }
  const now = Tone.now() + 0.08;
  const t0 = notes[0].t0;
  let end = 0;
  notes.forEach((n, i) => {
    const at = (n.t0 - t0) * STRETCH;
    const next = notes[i + 1] ? (notes[i + 1].t0 - t0) * STRETCH : at + Math.max(0.5, (n.t1 - n.t0) * STRETCH + 0.3);
    const dur = Math.max(0.2, next - at - 0.02);
    inst.triggerAttackRelease(Tone.Frequency(n.midi, "midi").toNote(), dur, now + at, 0.8);
    setTimeout(() => onNote(i), (at + 0.08) * 1000);
    end = at + dur;
  });
  setTimeout(() => onNote(-1), (end + 0.3) * 1000);
  return end;
}

// zh-CN speech synthesis.
export function chineseVoice() {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang === "zh-CN") || voices.find((v) => /^zh[-_](CN|Hans)/i.test(v.lang)) || voices.find((v) => /^zh/i.test(v.lang)) || null;
}

export function speak(text) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN";
  u.rate = 0.85;
  const v = chineseVoice();
  if (v) u.voice = v;
  speechSynthesis.speak(u);
  return u;
}
