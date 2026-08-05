# Build contract

Read this before touching anything. It exists so eight builders can work at once without
stepping on each other, and so a critic can re-render any round and get comparable pixels.

## Ownership map — you may only write inside your own directory

| Piece | Owns (write here) | Exports |
|---|---|---|
| `chamber` | `src/chamber/**` | `createChamber(world): Chamber` |
| `lighting` | `src/lighting/**` | `createLighting(world, deps): Lighting` |
| `board` | `src/board/**` | `createBoard(world): Board` |
| `pieces` | `src/pieces/**` | `createPieceFactory(world): PieceFactory` |
| `destruction` | `src/destruction/**` | `createDestruction(world, deps): Destruction` |
| `camera` | `src/camera/**` | `createCameraRig(world): CameraRig` |
| `chess` | `src/chess/**` | engine API, see below |
| `game` | `src/game/**` | `createGame(world, deps): Game` |

**Frozen — nobody edits these:** `src/core/**`, `src/main.ts`, `index.html`, `tools/**`,
`vite.config.js`, `package.json`, `tsconfig.json`, `docs/CONTRACT.md`.

If you genuinely need a change in frozen core, say so in your report instead of editing it.
Writing outside your directory is the one thing that breaks the parallel build.

## The interfaces

All of these live in `src/core/api.ts`. Import the types from there; do not redeclare them.

```ts
createChamber(world): { group: THREE.Object3D; dispose(): void }
createBoard(world): { group; squareMesh(f, r): THREE.Object3D | null; dispose() }
createLighting(world, { chamber, board }): {
  group; composer: EffectComposer | null; render(): void;
  flare(pos: THREE.Vector3, intensity: number, decay: number): void; dispose();
}
createPieceFactory(world): {
  make(type: PieceType, side: Side, id: string): PieceInstance;
  dispose();
}
createDestruction(world, { pieces }): {
  group; shatter(target: PieceInstance, impact: THREE.Vector3, force: number): void;
  dispose();
}
createCameraRig(world): {
  applyShot(shotId: string, t: number): void;
  free(spec: string): void;
  shake(amount: number): void;
}
createGame(world, deps): { start(); update(t, dt); state(): GameState }
```

`PieceInstance` is:

```ts
interface PieceInstance {
  id: string; type: PieceType; side: Side;
  group: THREE.Object3D;            // origin at the base centre, +Y up
  height: number;                   // actual metres, base to crown
  setSquare(file, rank): void;      // teleport
  walkTo(file, rank, seconds): void;// animated traverse
  strike(target: PieceInstance): Promise<void>;  // resolves at the instant of contact
  destroyed: boolean;
  update(t, dt): void;
}
```

## Determinism — non-negotiable

The critic re-renders your work. If your output is not deterministic, its comparison is
meaningless and your piece cannot be judged.

- **Never** call `Math.random()`, `Date.now()`, `performance.now()`, or `new Date()`.
  Use `world.rng` (fork it: `world.rng.fork('my-subsystem')`) and `world.time`.
- **Never** read the wall clock for animation. Everything is a function of `world.time`.
- Any object that needs its own stable randomness should fork by a stable string key
  (e.g. `world.rng.fork('pawn-e2')`), so adding a new object does not reshuffle existing ones.

Verify with: `npm run capture -- --shot=wide-establishing --t=3 --out=/tmp/a.png` twice and
confirm the two files are byte-identical.

## Scale — non-negotiable

Read `src/core/constants.ts`. One square is 2.35 m. A pawn is 2.55 m tall. Do not invent
your own scale; every piece depends on this agreeing.

## Quality tiers

`world.quality` is `'high'` under capture and `'low'` for fast interactive work. Expensive
detail (high subdivision, extra particle counts, extra shadow cascades) should scale with it,
but the *look* must not change character between tiers — only density.

## How to check your work

```bash
npm run capture -- --shot=<id> --t=<seconds> --out=refs/renders/<id>.png
npm run typecheck
```

`tools/capture.mjs` starts the dev server itself if one is not already running.
