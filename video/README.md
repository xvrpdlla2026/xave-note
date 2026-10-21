# The Xave film

A 30 second piece for the repository front page, built with
[Remotion](https://github.com/remotion-dev/remotion). Everything on screen is either the
real app, running, or the same shapes the app draws, so the film cannot drift away from
the product.

| Time | Scene | What it says |
| :-- | :-- | :-- |
| 0.0 | Open | The mark, the name, and the promise typed out |
| 3.2 | Write | A note, saving itself, with the live cursor |
| 8.7 | Arrange | The board of cards on its canvas |
| 14.4 | Plan | Week, day and month, cutting on the beat |
| 20.1 | Find | The search palette, with real keycaps |
| 24.9 | Claim | Offline, local only, open source |
| 27.6 | Close | The mark, the name and a short promise |

## Render it

```
npm install
npm run render
```

Output lands in `out/xave-30s.mp4`. `remotion.config.ts` points the renderer at the
Chrome already installed on this machine, so nothing is downloaded.

The silent cut is rendered first, then muxed with the bed:

```
node audio/make-bed.mjs
```

That script writes `audio/bed.wav` by synthesis: a pad that follows three chords, a low
drone for body, and a soft bloom on each cut. No samples, so there is nothing to license.
It is not committed; regenerate it before muxing.

## Files

- `src/Video.tsx` holds the seven scenes and their timings.
- `src/parts.tsx` holds the shared look: backdrop, mark, headline, pills, window.
- `public/shots` mirrors the screenshots in `../docs`, at full size.
- `audio/make-bed.mjs` is the soundtrack generator.
