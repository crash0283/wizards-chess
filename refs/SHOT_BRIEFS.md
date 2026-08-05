# Shot Briefs — the bar

## Status of the reference frames

The frame sources named in the task brief are **blocked by this session's egress policy**.
Every one of these returned `403` at the gateway on both `curl` and the sanctioned fetch tool:

| Host | Result |
|---|---|
| `movie-screencaps.com` | 403 CONNECT denied |
| `imgs.screencaps.us` | 403 CONNECT denied |
| `i0.wp.com` (the 4K direct-image CDN) | 403 CONNECT denied |
| `external-preview.redd.it` | 403 CONNECT denied |

Policy is explicit that gateway denials are not to be retried or routed around, so `refs/frames/`
is empty. It is wired as a **drop-in directory**: put real frames there using the filenames in the
table below and the critic harness switches from brief-only judging to true side-by-side blind
comparison with no code changes (`tools/critic-pair.mjs` detects them automatically).

Until then, the bar is these written briefs. They describe the target shots — framing, scale,
light, materials, motion — in enough detail to be judged against, and each one lists **hard
numeric acceptance criteria** so a critic can be objective rather than impressionistic.

## Shot table

| # | Shot id | Reference filename to drop in | Purpose |
|---|---|---|---|
| 1 | `wide-establishing` | `refs/frames/wide-establishing.jpg` | The reveal — whole chamber, whole board |
| 2 | `low-across-board` | `refs/frames/low-across-board.jpg` | Floor-level look across the board, pieces towering |
| 3 | `knight-looking-up` | `refs/frames/knight-looking-up.jpg` | Extreme low angle up a mounted knight |
| 4 | `piece-mid-strike` | `refs/frames/piece-mid-strike.jpg` | A piece mid-swing, the instant before contact |
| 5 | `aftermath-rubble` | `refs/frames/aftermath-rubble.jpg` | Destroyed piece, debris settling, dust in the light |
| 6 | `king-surrender` | `refs/frames/king-surrender.jpg` | Checkmate — the king's blade falls, game ends |

---

## Global look — applies to every shot

**The room.** A vast subterranean stone hall. Not a decorated room — a raw, cold, engineered
cavern. Squared-off block masonry, courses visible, mortar lines dark and eroded. The walls climb
past the top of frame in most shots; the ceiling is only implied, lost in black. Scale reads as
roughly 25–30 m across and at least 15 m to anything resembling a ceiling. Emptiness is the point:
no furniture, no banners, no decoration. Stone, board, pieces, dark.

**Palette.** Extremely narrow. Warm amber-orange from firelight on every lit surface
(roughly `#c8863f` at the brightest falling to `#5a3418`), and a cold desaturated blue-grey in
shadow (`#2a3340`-ish) that is 3–5% of the key's intensity. There is no green anywhere, no
saturated colour, nothing pure white. Mid-grey stone reads warm on one face and cold on the other.
Overall image saturation is low; the warmth comes from light, not from pigment.

**Light.** Firelight only. Sources are low and to the sides — braziers or wall torches near floor
level — so every vertical surface is lit from *below the middle*, and shadows are thrown *upward*
across the pieces and walls. This is the single most identifiable property of the scene: uplight.
The light is unstable, flickering at roughly 6–11 Hz with ±8% intensity and a small positional
jitter, never a clean sine. Falloff is fast — a piece 8 m from a brazier is 4–6 stops darker than
one at 2 m — which is what makes the room feel enormous.

**Air.** The room is never clear. There is permanent haze — fine suspended dust — thick enough
that distant walls lose 30–50% contrast and every light source has a visible volumetric cone.
Shafts of light are structural to the image, not an effect layered on top.

**Material.** Everything is the same stone. Weathered, porous, pitted, blotchy with age.
Nothing is clean, nothing is polished, nothing has a specular highlight sharper than a broad soft
sheen. Surfaces carry three scales of detail simultaneously: large-scale blotching and staining
(metres), medium chips and erosion (10 cm), and fine grain/pitting (mm). A surface with only one
of these reads as CG immediately.

**Camera.** Anamorphic-flavoured: long-ish lenses, shallow depth of field for the scale, a slight
barrel character, subtle chromatic fringing at the extreme edges. Handheld weight on every shot —
never locked off, never perfectly smooth. Contrast is filmic: rich blacks that are *not* crushed
to zero (floor around 3–6/255), highlights that roll rather than clip.

**Weight.** Pieces are stone and read as tons. Nothing accelerates fast. Nothing bounces.
Everything that moves has a low, grinding inevitability, and the ground registers it.

---

## Shot 1 — `wide-establishing`

**Framing.** High and back, roughly 12 m up and 22 m out from the board's near edge, looking down
the long axis at about 18–22° declination. The full 8×8 board occupies the middle third of frame.
Chamber walls run out of frame left and right; the far wall is visible but hazed. Pieces read as
silhouettes in the far rank, only the near ranks catch enough light to show form.

**What has to be true.**
- The board is *floor* — its squares are the same stone as the room, inset flush, not a table.
- Squares are large: a piece stands within one square with room around it, ~2.2–2.5 m per square,
  so the whole board is ~18–20 m across.
- Pieces are 2.5 m (pawn) to 4.5 m (king). A human standing among them reaches a pawn's chest.
- Light pools. There are 3–5 clearly separated bright zones with genuinely dark space between them.
  A uniformly lit room fails this shot outright.
- The top 15% of frame is essentially black — the ceiling is not resolved.

**Acceptance criteria.** Median luminance below 0.18. At least 22% of pixels below 0.04.
No more than 0.6% of pixels above 0.92. Warm/cool hue split present with a mean hue near 28–35°
in lit regions. Visible haze gradient front-to-back of at least 25% contrast loss.

---

## Shot 2 — `low-across-board`

**Framing.** Camera on the board surface itself, ~0.8 m up — below a pawn's knee — one square back
from the front rank, looking across. Near piece bases fill the left and right thirds and are
substantially out of focus. The centre channel runs between them to a lit piece 4–6 squares away.

**What has to be true.**
- Perspective is aggressive. Verticals converge hard; the near pieces are cut by the frame edges.
- The floor plane occupies the bottom third and is the most detailed surface in shot — mortar
  lines, grit, chips, dust drifts collected in the joints.
- Depth of field is real: the near bases are soft (a 4–8 px circle of confusion), the mid piece
  is sharp, the background is soft again.
- The horizon of the board is *above* frame centre — the camera is looking slightly up.

**Acceptance criteria.** Focus falloff measurable: near-field high-frequency energy under 35% of
mid-field. At least three distinct depth layers separable by blur. Bottom third contains the
image's peak local detail variance.

---

## Shot 3 — `knight-looking-up`

**Framing.** Camera at the foot of a mounted knight, ~0.5 m off the floor, tilted up 40–55°.
The knight fills the frame diagonally, its head and raised foreleg crossing the top corner.
Chamber void behind it, one distant firelight source flaring past the silhouette's edge.

**What has to be true.**
- The piece reads as *carved*, not modelled: chisel facets, the horse's mane cut in blocky planes,
  eroded edges. No smooth generic curvature.
- Strong rim light along one edge from the flare source; the mass of the piece is in shadow but
  never black — bounce from the floor lifts the underside slightly warm.
- Dust motes cross the frame, catching light, drifting not falling.
- The piece is chipped. At least one significant corner or edge is broken away, older than the
  current fight.

**Acceptance criteria.** Silhouette occupies 35–55% of frame. Rim highlight present as a
contiguous bright edge at least 200 px long. Underside shadow luminance between 0.02 and 0.08 —
not crushed. Visible surface detail at three distinct spatial frequencies.

---

## Shot 4 — `piece-mid-strike`

**Framing.** Medium, slightly low, ~1.6 m up, 6–8 m out, ~35° off the strike axis so the swing
crosses the frame rather than coming at camera. Attacker's weapon at the top of its arc or just
past it. Target piece in frame, still whole, occupying the opposite third.

**What has to be true.**
- The attacker has *committed weight*. The body is rotated into the swing, the base is loaded,
  and it is not a piece politely gesturing.
- Motion blur on the weapon only — the body is comparatively sharp. Directional, arc-shaped,
  not a uniform smear.
- The strike disturbs the room *before* it lands: dust already lifting from the floor along the
  swing path, light already changing.
- Camera has reacted — a small lag/whip, so the framing is slightly imperfect. A perfectly
  composed strike frame reads as animation, not photography.

**Acceptance criteria.** Directional blur detectable on the weapon with anisotropy ratio ≥ 3:1.
Attacker's centre of mass displaced ≥ 15% of its height from rest. Airborne particulate present
above the floor plane along the swing arc.

---

## Shot 5 — `aftermath-rubble`

**Framing.** Slightly high, ~3 m up, 5 m out, looking down at the square where the destroyed piece
stood. The victor stands over the rubble, partly in frame. Debris field spread across two to three
squares.

**What has to be true.**
- The break is **stone breaking**, not a piece disassembling. Chunks are angular, of wildly
  different sizes — a few large torso-sized blocks, many fist-sized, and a great deal of grit —
  and the interior faces of the breaks are *lighter and rougher* than the weathered outer surface.
  This freshly-exposed-interior contrast is the tell that separates real destruction from a
  shatter effect.
- Debris has *settled*. Pieces have come to rest against each other, some leaning, some rocked
  into stillness. Nothing is resting on a mathematically flat contact.
- The dust plume is still in the air and still moving — a slow billow at head height, thickest
  where the piece stood, drifting laterally. It is lit through, so the light shafts in the room
  are momentarily much stronger.
- Scoring on the floor where debris skidded. Fine dust deposited in a halo around the impact.
- The victor is *still*. It has already finished. Its stillness is what sells the violence.

**Acceptance criteria.** ≥ 40 distinct debris bodies with a size distribution spanning at least
a 12:1 ratio. Fresh-break faces measurably brighter than weathered faces (≥ 25% luminance delta).
Volumetric dust density above the impact at least 3× ambient haze. Floor shows a deposition
gradient radiating from impact point.

---

## Shot 6 — `king-surrender`

**Framing.** Wide, chest height, the full board visible past the checkmated king. The king is the
tallest thing in frame and the brightest-lit. Everything else has stopped.

**What has to be true.**
- The king's sword/blade releases and falls — a slow topple, tipping from the hilt, striking stone
  with a heavy dead sound, not a clatter.
- The game is genuinely over: the position on the board is a real checkmate, and it is legible —
  the checking piece and the king's blocked escape squares are both visible in frame.
- Every surviving piece has come to rest. Total stillness after the fall, held long enough to feel.
- The room's light drops slightly and settles as the fires calm.

**Acceptance criteria.** Board position must validate as legal checkmate. Blade contacts floor with
no bounce > 2 cm. Post-fall frame-to-frame pixel delta below 0.5% for a sustained hold.

---

## How the critic uses this

For each round, the critic gets: the render, and either the reference frame (if dropped in) or
this brief. It must answer the same question either way — **is this a film frame or a render?** —
and if it can tell, name the single biggest reason. Not a list. One gap, the biggest one, so the
builder has an unambiguous next move.
