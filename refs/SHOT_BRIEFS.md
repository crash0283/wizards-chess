# Shot Briefs — the bar

**All six shots now have a real reference frame** in `refs/frames/`. They are the bar.
Where this document and a frame disagree, **the frame wins** — go look at it.

| Shot id | Reference | Camera |
|---|---|---|
| `wide-establishing` | `wide-establishing.webp` | High, looking down the board's long axis |
| `low-across-board` | `low-across-board.webp` | Low wide across the board, army ranked, figures walking on it |
| `knight-looking-up` | `knight-looking-up.webp` | Low, close, among the pieces — the piece-design reference |
| `piece-mid-strike` | `piece-mid-strike.webp` | Medium, a sword thrust landing, target bursting |
| `aftermath-rubble` | `aftermath-rubble.webp` | High, dust plume standing over fresh debris |
| `king-surrender` | `king-surrender.webp` | Wide, the pale king towering, wreckage everywhere |

The frames are film stills, **gitignored on purpose** — local reference only, never committed
or redistributed.

> **Critics: run `node tools/critic-pair.mjs --shot=<id> --round=<n>`.** All six shots now
> return `blind-pair`. Commit to which panel is the film *before* anything else. Never open
> `.critic-keys/`.

---

## ⚠️ Discard these — an earlier draft of this brief was written without frames and was wrong

| Earlier claim | Reality |
|---|---|
| "Warm amber firelight on every lit surface" | The room is **cold blue-slate**. Flames are small local accents. |
| "Uplight is the defining property" | Soft cool ambient dominates; flames light only their immediate surroundings. |
| "Nothing polished, no sharp speculars" | The board is **polished marble with visible reflections and specular bloom**. |
| "Weathered rough block masonry, eroded mortar" | **Carved Gothic architecture** — arcades, moulded portals, massive piers. |
| "Abstract carved chess forms" | **Figurative armoured combatants** on moulded plinths. |
| "Fine suspended haze" | Destruction is a **violent opaque white burst**, not a wisp. |

Measured against the reference, the round-0 baseline was hue 31° / 0 % cool / 0.89 saturation.
The film frame is hue ~250° / 23 % cool / 0.24 saturation, with roughly **5× the detail energy**.

---

## Global look

**Colour.** Cold. Desaturated blue-slate everywhere; `king-surrender` is nearly monochrome blue.
The only warm colour in the room is (a) the small flames and (b) rust-ochre staining on the pale
army. Mean saturation sits around **0.24** — if your render is globally warm or vivid, it is wrong.

**Light.** A soft cool ambient fills the space and models every piece gently — no hard key, no
dramatic single-source. On top of that sit **many small, individual flames**, each roughly
0.4–0.6 m, burning directly on the board's stone kerb, on plinths, and scattered among the pieces.
They are the brightest things in frame and among the only near-white pixels, but each lights only
a metre or two around itself. They do **not** warm the room. Get this relationship wrong — one big
warm key instead of many tiny bright ones in a cold room — and nothing else will save the shot.

**Contrast.** Deep true blacks in the ceiling and corners, with **heavy vignetting**, but lifted
gentle mid-tones. Not a high-contrast image. Small blown highlights (flames, specular bloom on
marble, the dust burst) against a large dark field.

**Air.** Real atmospheric depth. Distance reads as **desaturation and blue lift**, not as darkness
— the far wall in `king-surrender` is heavily veiled.

**Grain.** Visible film grain throughout, strongest in the dark mid-tones. A clean render is an
instant tell.

**Lens.** 2.39:1 anamorphic with hard black bars. Noticeably shallow depth of field —
in `knight-looking-up` and `piece-mid-strike` the background arches are strongly defocused while
the subject stays sharp.

---

## The board

The single most identifiable object in the scene. Study `wide-establishing`.

- **Polished marble, genuinely reflective.** Pieces, plinths and flames reflect in it, softly and
  broadly. There is a visible **specular bloom** where light grazes the surface. Roughness is low
  but not zero — reflections are blurred, not mirror-sharp.
- **Light squares:** cream/white marble carrying **dramatic dark branching veins** — bold, ink-like,
  irregular, running right across a square. This veining is unmissable and is half the board's
  identity. Not subtle mottling; strong graphic figure.
- **Dark squares:** deep navy blue-black marble with its own paler veining, quieter than the light
  squares but present.
- Squares are large, flat, clean-edged, with **crisp joints** — this is finished stonework, not
  weathered slabs.
- The board is bounded by a **raised stone kerb**, and between the marble field and the kerb runs a
  fine **inlaid geometric border strip** (a narrow band of small repeating elements). Flames burn
  on top of this kerb.
- It is a floor: flush, continuous, walked on. Rubble lands and stays on it.

## The architecture

- **Massive dark piers/columns** ring the chamber, receding into black. Vaulted, unresolved
  ceiling — the top of frame is essentially void.
- A **large arched portal** at the end of the room: concentric arch mouldings stepping inward
  around a dark doorway, and within it a door carrying a **geometric relief pattern**.
- Elsewhere, a **fine blind arcade** — a band of small repeating arches in shallow relief.
- The stone is smooth, mid-grey, **carved and ordered**. Age shows as staining and soot, not as
  crumbling. Architecture is the story, not erosion.
- Behind the ranks sits a **heap of accumulated rubble** from pieces already destroyed, with flames
  burning in it.

## The pieces

Figurative armoured combatants in carved stone, each on its own moulded plinth. Study
`knight-looking-up`.

- **Pawn** — a **crouching, hunched armoured foot-soldier** in a rounded dome helmet, low to the
  ground, shield and short blade held close. Compact and heavy. Seen from behind they are a row of
  domed shells. This is the most distinctive silhouette on the board and nothing like a classical
  pawn.
- **Knight** — an armoured **rider on a horse**, wearing a conical/crusader helm with a **cross-shaped
  visor slit**, a flowing cape rendered as **chainmail drapery**, leaning aggressively forward with
  a **curved blade**. In the wide shots the horses rear.
- **Bishop** — a tall standing armoured figure, hands together at the chest, narrow silhouette.
- **Rook** — a **castle tower** with crenellations and masonry courses, sometimes with a figure at it.
- **Queen / King** — tall robed figures with crowned helms; the king carries a staff or mace and is
  the tallest thing on the board. The dark king/queen reads from behind as an enormous
  **draped chainmail cape**.
- **Plinths** — **hexagonal/octagonal stepped, moulded stone bases** with real carved profiles.
  Pale pieces on pale plinths, dark pieces on dark plinths. These are architectural, not discs.
- **Two materials:** the pale army is warm off-white limestone heavily marked with **rust and ochre
  staining** — irregular orange-brown blotches, very distinctive. The dark army is near-black
  blue-grey stone. They differ in hue, value **and** grain.
- **Fabric elements exist** — capes and tabards, dull dark red or grey, carved as stone drapery but
  reading as cloth. When a piece breaks, torn fabric scatters with the stone.

## Destruction

`piece-mid-strike` and `aftermath-rubble` together.

- **The strike:** the attacker drives a **thin sword straight through** the target — an extended
  thrust, arm fully out, body committed and leaning, cape trailing. The attacker stays comparatively
  **sharp**; the debris carries the motion blur.
- **The burst:** the target detonates into a **dense opaque white-grey dust cloud** with **dark
  angular fragments flying outward through it**, silhouetted against the pale dust. Violent and
  fast — an explosion, not a collapse. The dust is the brightest thing in frame.
- Fragments are **angular, hard-edged, wildly varied in size**, and clearly recognisable as pieces
  of the figure (helm sections, limbs, plinth blocks). Fresh break faces are pale and raw.
- **Torn dark-red fabric** is thrown among the stone — a distinct non-stone element.
- **Aftermath:** the plume persists as a tall lobed cauliflower mass well above the piece's original
  height, still lit, still moving, while debris lies settled across several squares. The victor
  holds its follow-through, motionless.
- Debris **accumulates over the game** — by `king-surrender` the board is strewn with wreckage from
  many captures, and it stays there.

## Scale

`king-surrender` and `low-across-board` fix it: a child's silhouette against the king puts the king
at roughly **three to four times a child's height**; pawns read at adult to 1.5× adult. The
constants in `src/core/constants.ts` are in the right range — keep them.

---

## Per-shot acceptance criteria

Measured with `node tools/metrics.mjs <render> refs/frames/<shot>.webp` — the `delta` block is what
you are minimising.

### `wide-establishing`
- Camera high, looking **down the board's long axis**; the empty centre of the board dominates the
  frame and recedes to a vanishing point. Armies ranked left and right.
- **Many small bright flames** on the kerb and among the pieces — count them in the reference.
- Marble veining clearly legible on the light squares; reflections and specular bloom present.
- Heavy vignette; dark piers and void ceiling above.
- `meanSaturation`, `meanLitHueDeg`, `warmFraction`/`coolFraction` within tight delta of reference.

### `low-across-board`
- Low, wide, across the board. Pieces tower; the board surface fills the lower frame and reflects.
- Flames at floor level as small isolated warm points inside a cold room.
- Blind arcade legible behind the ranks.

### `knight-looking-up`
- Piece design must be **figurative and specific**: crouching helmed pawns, mounted knight with
  cross-slit conical helm and chainmail cape, hexagonal moulded plinths.
- Rust/ochre staining on the pale stone.
- Background strongly defocused; subject sharp.

### `piece-mid-strike`
- Extended sword thrust connecting; attacker committed and comparatively sharp.
- Opaque white-grey burst with **dark angular fragments flying through it**, motion-blurred.
- Background arches heavily defocused. Visible grain.

### `aftermath-rubble`
- Tall lobed opaque plume, brightest element, real internal structure.
- ≥ 30 debris bodies spanning ≥ 10:1 size range, including recognisable figure fragments and
  dark-red fabric.
- Fresh break faces brighter than outer surfaces. Victor still, in follow-through.

### `king-surrender`
- Near-monochrome cold blue; `meanSaturation` within ±0.03 of reference.
- Strong blue atmospheric veiling on the far wall.
- King tallest and palest; small figure for scale; wide debris field.
- **Board position must validate as a legal checkmate.**

---

## How the critic uses this

Render the shot yourself, get the numbers, then do the blind pair. Decide which panel is the film
and say so with confidence before reading anything else. If you can tell, name **one** gap — the
biggest — so the builder has an unambiguous next move. Not a list.
