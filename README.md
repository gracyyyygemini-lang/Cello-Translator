# The Cello Translator · 大提琴翻译器

Say a German sentence. Your voice becomes a cello melody, and the melody picks the Chinese translation whose tones it can carry.

![Demo](docs/demo.gif)
<!-- Record a short GIF of the app and save it as docs/demo.gif -->

## Use

1. Pick one of ten German sentences.
2. Hold **Hold to record** and say it (or upload a WAV, or try the demo voice).
3. Read the three lanes: German pitch curve, cello staff, and the best-fitting Chinese under its notes. Below them, every candidate is ranked; click one for its per-syllable breakdown.

Plain HTML and JS, no build step and no API keys. Serve the folder over HTTP (ES modules don't load from `file://`):

```
python -m http.server
```

Then open `http://localhost:8000`. Tests are at `/test.html`, or run `node js/tests.js`.

To deploy, push to GitHub and turn on Pages for the main branch, root folder.

## How it works

**Voice → notes.** [pitchy](https://github.com/ianprime0509/pitchy) traces pitch every 5 ms. Energy peaks split the take into syllables (capped near the German syllable count). Each syllable becomes one note at the median pitch of its voiced core, kept in the octave you spoke and snapped to D minor (or rounded to the nearest semitone in Raw mode).

**Tones.** Each tone is a shape on Chao's 1–5 scale: T1 `55`, T2 `35`, T3 `214` at the end of a phrase and `21` elsewhere, T4 `51`. Neutral tones take their height from the tone before: 2 after T1, 3 after T2, 4 after T3, 1 after T4.

**Sandhi.** These rules run before scoring:
- 3-3: a T3 followed by a T3 becomes T2, so a run keeps only its last T3 (你好 2-3, 我有点饿 2-2-3-4).
- 一: becomes `yi2` before T4 and `yi4` before T1–3. It stays `yi1` when alone, at the end of a word, or as an ordinal.
- 不: becomes `bu2` before T4.
- 一 and 不 are neutral in X一X and X不X (看一看, 好不好).

**Alignment.** Dynamic programming matches syllables to notes in order. A syllable can take one note, or two notes joined by a slur (small penalty). A neutral can share a note with its neighbour. Two full tones only share a note, or a note goes unsung, when nothing else fits; those results are marked "crowded".

**Score.** Each syllable gets 50% register fit (note height against the tone's average height in your range) and 50% direction:
- On a slur, the step between its two notes should move like the tone.
- On a held note, a T2 or T4 is judged by the step into the next note, since one note can't rise or fall.
- Into each syllable, the step from the previous note should match the jump from the last tone's end to this tone's start.

Neutral tones count 0.3. Syllables below 0.4 are tone clashes, shown in red.

## Files

| | |
|---|---|
| `index.html`, `css/style.css` | Page |
| `js/data.js` | Sentences and translations |
| `js/tones.js` | Tone shapes, sandhi, pinyin |
| `js/scoring.js` | Alignment and scoring |
| `js/pitch.js` | Pitch tracking, syllables, notes |
| `js/audio.js` | Recording, cello, speech |
| `js/render.js` | Lanes |
| `test.html`, `js/tests.js` | Tests |

## Credits

- Cello samples: recorded by **flcellogrl** on [Freesound](https://freesound.org/) (pack 12408, "real cello notes"), edited and hosted by [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) (Nicholas Brosowsky). Licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- Libraries: [Tone.js](https://tonejs.github.io/), [VexFlow](https://www.vexflow.com/), [pitchy](https://github.com/ianprime0509/pitchy), all loaded from jsDelivr.
- Chinese speech uses your browser's built-in zh-CN voice, when one is installed.
