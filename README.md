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

## Is it actually a real game?

Yes, and both halves are independently verified rather than asserted.

**The rules.** `tools/perft.mjs` checks the move generator against the published node counts
for the five standard perft positions — start position to depth 5, kiwipete, and positions 3,
4 and 5. All values match exactly. Castling, en passant, promotion, pinned-piece legality and
check evasion are all covered by those numbers.

**The engine fights back.** Alpha-beta with iterative deepening, a transposition table,
MVV-LVA ordering, killer and history heuristics, quiescence search over captures, and a
positional evaluation. Roughly 500k nodes/sec. It does not lose to a random mover or to a
greedy material mover. Search is bounded by an explicit **node budget rather than wall-clock
time**, so it returns the same move on a fast machine and a slow one — which is what lets a
capture be re-rendered and come out identical.

**Checkmate ends it.** `tools/verify-mate.mjs` replays every ply of each demo line through
the generator, confirms the final FEN matches, and asserts the mated side is in check with
**exactly zero legal replies**. The mated king then releases its blade and everything stops.

`progress.html` is the live view: every piece, its current round, the latest render beside
its reference, and the latest critique.

## The bar

`refs/SHOT_BRIEFS.md` defines six shots by camera angle, each with hard numeric acceptance
criteria so critics can be objective rather than impressionistic.

All six shots have a real reference frame, supplied directly. They live in `refs/frames/` and
are **gitignored on purpose** — they are film stills, kept as local reference and never
committed or redistributed. With them present, `tools/critic-pair.mjs` composites the render
and the film frame as panels A and B in an order the critic cannot predict, hides the answer
in `.critic-keys/`, and forces a choice: *which one is the movie?*

An earlier draft of the brief was written before the frames were available and got the
scene's most important properties wrong — it described a warm amber room with matte weathered
stone and abstract carved chess forms. The frames show a **cold blue-slate room** lit by many
small local flames, a **polished veined marble** board that reflects, and **figurative
armoured combatants** on moulded plinths. `SHOT_BRIEFS.md` carries a corrections table at the
top so nobody inherits the old assumptions.

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

# chess correctness: perft against the five standard positions, plus match play
npm run perft

# prove the demo games really do end in checkmate — this replays every ply through
# the move generator rather than trusting the engine's own "verified" flag
node tools/verify-mate.mjs
```

Rendering runs under software GL (swiftshader) in this environment, so captures take
minutes rather than seconds.

## Contributing to a piece

Read `docs/CONTRACT.md` first. The short version: write only inside your own piece's
directory, never touch `src/core/**` or `tools/**`, take all randomness from `world.rng` and
all time from `world.time`, and take scale from `src/core/constants.ts`.
