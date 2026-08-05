# Wizard's Chess

A 3D wizard's chess game: a vast firelit stone chamber, weathered stone pieces at monumental
scale, real weight and dust when one piece destroys another — and a real game of chess
underneath it, with legal move generation, an engine that fights back, and a checkmate that
ends it.

Everything is procedural. There are no external art assets: geometry, stone surfaces,
fracture patterns and dust are all generated in code.

## Running it

```bash
npm install
npm run dev          # http://127.0.0.1:5188
```

## How this project is built

The goal was split into eight pieces small enough to be improved and judged on their own.
Each one is built by an agent and judged by a *separate* agent with fresh context that never
sees the builder's reasoning — only the output. The critic runs the real app, captures the
shot itself, compares against the bar, and if it can tell the render from a film frame it
names the single biggest remaining gap and sends it back. Then it loops.

| Piece | Directory | Judged via |
|---|---|---|
| Chamber — the stone hall | `src/chamber/` | `wide-establishing` |
| Lighting — firelight and air | `src/lighting/` | `wide-establishing` |
| Board — the playing floor | `src/board/` | `low-across-board` |
| Pieces — carved stone chessmen | `src/pieces/` | `knight-looking-up` |
| Destruction — stone breaking stone | `src/destruction/` | `aftermath-rubble` |
| Camera — lens and operator | `src/camera/` | `piece-mid-strike` |
| Chess — rules and engine | `src/chess/` | perft + match play |
| Game — the fight itself | `src/game/` | `piece-mid-strike`, `king-surrender` |

`progress.html` is the live view: every piece, its current round, the latest render beside
its reference, and the latest critique.

## The bar

`refs/SHOT_BRIEFS.md` defines six shots by camera angle, each with hard numeric acceptance
criteria so critics can be objective rather than impressionistic.

The reference frames themselves could not be fetched in the environment this was built in —
`movie-screencaps.com`, `imgs.screencaps.us`, `i0.wp.com` and `external-preview.redd.it` are
all denied by its egress policy (HTTP 403 at the gateway). The critic harness therefore
judges against the written briefs, and switches to true blind A/B automatically if a frame is
placed at `refs/frames/<shot>.jpg`.

## The harness

Determinism is the foundation: the same seed, shot and scene time always produce the same
pixels. Without that, comparing round *n* to round *n+1* means nothing.

```bash
# one frame
npm run capture -- --shot=wide-establishing --t=3 --out=refs/renders/wide.png

# all six shots in one browser session
npm run capture -- --all --tag=r3

# motion: a labelled contact sheet across time, for judging weight and settling
node tools/filmstrip.mjs --shot=piece-mid-strike --from=0 --to=2.4 --frames=9

# objective image statistics
node tools/metrics.mjs refs/renders/wide.png

# blind A/B pair (falls back to brief-only when no film frame is present)
node tools/critic-pair.mjs --shot=wide-establishing --round=3

# rebuild the live progress page
npm run progress
```

Rendering runs under software GL (swiftshader) in this environment, so captures take
minutes rather than seconds.

## Contributing to a piece

Read `docs/CONTRACT.md` first. The short version: write only inside your own piece's
directory, never touch `src/core/**` or `tools/**`, take all randomness from `world.rng` and
all time from `world.time`, and take scale from `src/core/constants.ts`.
