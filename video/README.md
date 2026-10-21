# The Xave films

Two pieces live here: a 30 second ad built from motion graphics, and a longer tour cut
from real recorded sessions.

## The 30 second film

`src/Ad.tsx` draws everything: the mark, the window card, the block grid, the canvas with
its marquee and minimap, the planner, the palettes. Nothing is screen captured, so the
beats can be as quick as the voice. Its timing comes from `audio/vo-ad/timing.json`, via
`node build-ad.mjs`. `audio/make-ad-score.mjs` writes the soundtrack to `public/ad.wav`: 128 bpm, four on
  the floor, a bass and pluck hook that changes every four bars, and the music ducked
  under each line of voice.

```
node audio/make-ad-vo.mjs
node build-ad.mjs
node audio/make-ad-score.mjs
node_modules/.bin/remotion render src/index.ts XaveAd out/ad.mp4
```

## The tour

A tour of the whole app for the repository front page, built with
[Remotion](https://github.com/remotion-dev/remotion). Every shot is a real session: the
recorder drives Chrome over the DevTools protocol and dispatches actual clicks, drags and
keystrokes at the app, then the film plays that footage inside a window card. Nothing is
a mockup, so the film cannot drift away from the product.

| Time | Scene | What it shows |
| :-- | :-- | :-- |
| 0.0 | Open | The mark, the name, and the promise |
| 4.4 | Classic view | Tabs, and a workspace per part of your life |
| 12.6 | Editor | Bold, headings, lists, checkboxes, highlights, saving as you type |
| 22.9 | Sidebar | Nested folders, and Control K search |
| 30.3 | Board | Notes, to-dos, links, files, comments, tables, add from your notes |
| 42.8 | Canvas | Drag to select, group, landmarks, drawing, the minimap |
| 52.7 | Boards | A board per project, and the board list |
| 58.9 | Planner | Day, week, month, year, and fullscreen |
| 66.1 | Themes | Six palettes, each with a dark side |
| 70.4 | Close | Free, open source, yours |

The runtime follows the narration, not the other way round: the voice is generated first,
then every cut is pinned to a beat the recorder marked in the footage, so the picture
changes exactly when the sentence names the feature.

## Render it

```
npm install
npm run render
```

Output lands in `out/tour.mp4`, then it is copied to `../docs/xave-tour.mp4`.
`remotion.config.ts` points the renderer at the Chrome already installed on this machine,
so nothing is downloaded.

## Re-record the footage

```
node record/record.mjs
```

Each take reloads the app and reseeds it first, so a take never inherits the wreckage of
the one before it. Set `TAKES=classic,canvas` to record only some of them. The film's cut
points come from `record/out/timeline.json`, which records the millisecond of every
`a.mark()` beat.

## Files

- `record/takes.mjs` is the script of every session, one entry per take.
- `record/record.mjs` is the Chrome recorder: screencast frames, plus real input events.
- `build-scenes.mjs` turns the takes plus the narration timing into `src/scenes.ts`.
- `src/Live.tsx` is the film: window card, camera push, intro, close.
- `audio/make-vo.mjs` generates the narration, one file per scene.
- `audio/make-score.mjs` builds the soundtrack: chords, sound effects, and the music
  ducked under the voice.
