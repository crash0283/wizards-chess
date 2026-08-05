# Shot Briefs — the bar

**Three real reference frames are now installed** in `refs/frames/`. They are the bar. Where this
document and a frame disagree, **the frame wins** — go look at it.

| Shot id | Reference | What it shows |
|---|---|---|
| `wide-establishing` | `refs/frames/wide-establishing.webp` | Low wide across the board, black army ranked, fires on the floor |
| `aftermath-rubble` | `refs/frames/aftermath-rubble.webp` | High angle, a piece just destroyed, huge dust plume, debris |
| `king-surrender` | `refs/frames/king-surrender.webp` | Wide aftermath, the pale king towering over a small figure |
| `low-across-board` | *(none yet)* | Derive from `wide-establishing` |
| `knight-looking-up` | *(none yet)* | Derive from `wide-establishing` |
| `piece-mid-strike` | *(none yet)* | Derive from `aftermath-rubble` |

The frames are film stills and are **gitignored on purpose** — they are local reference only and
must never be committed or redistributed.

---

## ⚠️ Corrections to the earlier version of this brief

An earlier draft of this file was written without the frames and got the scene's most important
properties **wrong**. If you read that version, discard these beliefs:

| Earlier claim | Reality in the frames |
|---|---|
| "Warm amber firelight on every lit surface" | **The room is COOL.** Dominant blue-slate. Fires are small, local, and do not warm the room. |
| "Uplight is the single most identifiable property" | The key is a **soft cool light from above/behind**. Floor fires are accents, not the key. |
| "Nothing polished, no sharp specular" | The board is **polished marble and visibly reflective** — pieces and figures mirror in it. |
| "Weathered rough block masonry, eroded mortar" | The walls are a **fine Gothic blind arcade** — carved, ordered, architectural. |
| "Abstract carved chess forms" | The pieces are **figurative armoured combatants** — horses, helmed soldiers, robed royalty. |
| "Fine suspended haze" | Ambient haze yes, but destruction produces a **huge opaque white plume**, not a wisp. |

---

## Global look — from the frames

**Colour.** The image is **cold**. Deep desaturated blue-slate dominates; `king-surrender` is very
nearly monochrome blue. Warm colour exists only as small isolated flames and the pale sandstone of
the white army. There is no amber wash. If your render is globally warm, it is wrong.

**Light.** A soft, cool, largely top-down ambient fills the room — enough to read every piece's form
across a very deep space, with no hard key and no dramatic single-source modelling. The flames sit
low (on the floor and on plinths) and are **small, contained, and local**: each throws a modest warm
pool a metre or two wide and does not travel. Crucially the fires read as *set dressing inside a
cold room*, not as the room's light source. Shadows are soft and shallow; nothing is crushed to
pure black except the ceiling void.

**Contrast.** Black point is genuinely deep — the ceiling and upper walls go to near-zero — but the
mid-tones are *lifted* and gentle. This is not a high-contrast image. Highlights (flames, the
brightest marble, the dust plume) are the only things near white, and they are small in area.

**Air.** Real atmospheric depth. The back wall in `king-surrender` is heavily veiled in blue haze
and loses most of its contrast. Distance reads as *desaturation and lift*, not as darkness.

**Grain.** Visible film grain across all three frames, strongest in the dark mid-tones. A clean
render is an instant tell.

**Frame.** 2.39:1 anamorphic, hard black bars. Shallow-ish depth of field but not extreme; the deep
field stays readable.

---

## The architecture

- **Blind arcade.** The dominant wall treatment is a continuous run of **narrow arches in shallow
  relief** — a carved arcade band running horizontally around the chamber at roughly mid-height,
  many small repeating bays. It is fine, ordered, Gothic stonework. Not rubble masonry.
- **A large arched portal** on one side, deeply recessed and dark.
- Walls above the arcade fall away into unresolved dark. No ceiling is ever resolved.
- The stone is smooth, pale-to-mid grey, and **carved**, not weathered-rough. Erosion is not the
  story here; *architecture* is.

## The board

- **Polished marble, and it reflects.** Light squares are cream/white marble with grey veining;
  dark squares are deep blue-black marble, also veined. In `wide-establishing` you can see figures
  and piece bases mirrored in the surface.
- Reflections are **soft and broad**, not mirror-sharp — a wide blurred gloss, roughness low but
  not zero.
- Squares are large, flat, and clean-edged, with a fine inlaid border strip at the board's edge.
- It is a *floor* — flush, continuous, walkable. Debris and rubble sit directly on it.
- Wear is subtle: veining and scuffing, not chipping. Damage comes from the fight, not from age.

## The pieces

They are **figurative armoured combatants carved in stone**, standing on cylindrical moulded
plinths. This is the biggest single departure from generic chess geometry.

- **Pawns** — squat, hunched/kneeling armoured figures in wide rounded helmets, seen from behind as
  a ranked row of domed shells. Compact and heavy.
- **Knights** — a rider on a **rearing horse**, forelegs off the ground, the whole mass dynamic and
  raised. The most visually dominant piece.
- **Bishops** — tall, narrow, mitred figures holding a crozier/staff.
- **Rooks** — heavy armoured figures with squared shoulders.
- **Queen / King** — tall robed figures with crowned helms, the king carrying a staff or mace, the
  tallest thing on the board.
- **Two materials, two identities:** the black army is **dark blue-grey/near-black stone**; the
  white army is **warm pale sandstone/limestone** with rust-and-ochre staining. They differ in hue,
  value, *and* grain.
- Surfaces are carved and detailed — armour plates, helm ridges, horse musculature — with soft
  broad sheen, not tight highlights. Fabric elements (capes, tabards) exist and are a **dull dark
  red**; when a piece breaks, torn red fabric scatters with the stone.
- Plinths are turned, moulded cylinders — real architectural bases, stepped and profiled.

## Destruction

From `aftermath-rubble`, the most instructive frame in the set:

- **The dust plume is the event.** A dense, opaque, white-grey billow rises well above the piece's
  original height in a cauliflower/mushroom mass, brightly lit and easily the brightest thing in
  frame. It has real internal structure — lobes and rolls — and reads as a *volume*, not a sprite.
- Debris is **large and angular**: recognisable fragments of the figure (limb sections, helm pieces,
  plinth blocks) scattered across several squares, not uniform gravel. Fresh break faces are
  pale and raw against the stained outer surface.
- **Torn dark-red fabric** is thrown with the stone — a distinct non-stone element in the debris.
- The attacker holds its follow-through, arm extended, blade out, absolutely still.
- Fragments come to rest on the marble and stay there; the board accumulates a debris field over
  the course of the game (`king-surrender` shows a board strewn with the wreckage of many pieces).

## Scale

`king-surrender` fixes it precisely: a child's silhouette stands against the king, and the king is
roughly **three to four times the child's height**. Pawns read at roughly adult-to-1.5× adult
height; the rearing knights are the tallest pieces of all. The existing constants in
`src/core/constants.ts` are in the right range — keep them.

---

## Per-shot acceptance criteria

Numbers are measured with `node tools/metrics.mjs <render> <reference>`. The reference's own values
are the target; the delta block in that tool's output is what you are minimising.

### `wide-establishing`
- Overall **cool**: `warmFraction` must NOT dominate `coolFraction`. Match the reference's split.
- Small isolated warm flame sources visible at floor level, each with a local pool only.
- The blind arcade must be legible along the back wall.
- Board reflections visible under the pieces.
- Ranked rows of *figurative* pieces, silhouettes clearly non-abstract.
- `medianLuminance` and `fracDeepShadow` within ±0.05 of the reference.

### `aftermath-rubble`
- A dense opaque dust plume, the brightest element in frame, with internal lobed structure.
- ≥ 30 distinct debris bodies spanning at least a 10:1 size range, including recognisable
  fragments of the destroyed figure, plus dark-red fabric pieces.
- Fresh break faces measurably brighter than outer surfaces.
- Attacker present, still, in follow-through.
- Board marble reads polished under the debris.

### `king-surrender`
- Near-monochrome cold blue; `meanSaturation` within ±0.03 of the reference.
- Strong blue atmospheric veiling on the far wall — visible front-to-back contrast falloff.
- The king is the tallest, palest element; a small figure gives the scale.
- A wide debris field across many squares from earlier captures.
- Position on the board validates as a legal checkmate.

### `low-across-board`, `knight-looking-up`, `piece-mid-strike`
No frame yet. Judge against the global look above plus the nearest reference, and say in your
critique that you judged without a direct frame.

---

## How the critic uses this

`node tools/critic-pair.mjs --shot=<id> --round=<n>` now returns **mode `blind-pair`** for the three
shots that have frames: it composites the render and the film frame as panels A and B in a seeded
order and hides the answer in `.critic-keys/` — which you must not open. Decide which panel is the
film, commit to it, then name the single biggest tell. One gap, the biggest one, so the builder has
an unambiguous next move.
