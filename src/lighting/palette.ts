/**
 * PIECE: lighting — colour anchors.
 *
 * The reference frames are a COLD room. `src/core/constants.ts` PALETTE carries warm
 * anchors that belong to the *flames* only; everything ambient in this chamber is
 * blue-slate. These are the lighting piece's own anchors, measured off the frames:
 * the room sits around hue 215-230 with the only warm pixels inside a metre or two
 * of a flame.
 */

/** Cold room. Every one of these is a blue whose R < G < B. */
export const COLD = {
  /** Hemisphere sky term — the soft cool fill that models everything. */
  sky: 0x9baace,
  /** Hemisphere ground term — cold bounce off the marble, darker and bluer. */
  ground: 0x3b4048,
  /** Flat ambient floor so nothing in the deep room goes to pure black too early. */
  ambient: 0x556880,
  /**
   * The soft cold light over the board.
   *
   * Much less blue than it was, and the reason is the marble. This is now the dominant
   * source on the board, and a source at saturation 0.33 turns a neutral cream stone into
   * a strongly blue one: our lit marble was measuring rgb 75/100/135, saturation 0.44,
   * against the film's 80/91/111 at 0.28. The board is a quarter of the frame, so that
   * one colour was carrying the whole image 0.03 over the film's mean saturation on its
   * own. Same hue, same luminance relationship, a third of the chroma — the room still
   * reads cold because everything in it is lit by this and by `sky`, and "cold" in the
   * reference is a matter of hue, not of intensity.
   */
  key: 0xb9c6e4,
  /**
   * The grazing sheen that sweeps the marble. A touch paler and less blue than the key:
   * in the frame the cream squares under the sheen are very nearly white, and a strongly
   * blue source cannot take a 0.72-albedo stone there without turning it cyan. The room
   * stays cold because everything AROUND the board is lit by `sky` and `key`.
   */
  sheen: 0xd4def8,
  /** Atmospheric veil colour. Distance reads as *this*, not as darkness. */
  haze: 0x22334f,
  /**
   * Unresolved ceiling / beyond-the-arcade void.
   *
   * Lifted off the floor. This is `scene.background`, so it is what the top and the outer
   * edges of the frame are made of wherever no geometry was drawn, and at 0x05070c it came
   * out of the grade at luminance 0.031 — below the 0.06 line at which the colour metric
   * will count a pixel as anything at all. A large slice of the frame was therefore
   * registering as neither warm nor cool no matter how blue it was, which is a standing
   * part of the coolFraction gap (0.40 against the film's 0.43). The film's own void is
   * not literal black either: a release print carries base fog and a vaulted ceiling
   * carries some scattered light.
   */
  voidColor: 0x0f1522,
  /**
   * Env gradient stops, top -> horizon -> floor. The energy sits OVERHEAD, not at the
   * horizon where it used to. An IBL whose bright band is at eye level pours light into
   * every vertical surface in the room — the piers, the side walls, the backs of the
   * pieces — which is the same uniform-graze problem as a hemisphere light wearing a
   * different hat. Overhead, it reflects off the polished marble into a camera looking
   * down at it and barely touches a wall.
   */
  envTop: 0x384b68,
  envHorizon: 0x161e2c,
  envFloor: 0x0a0e15,
  /** A whisper of fire bounced into the low env so undersides are not dead blue. */
  envFireBounce: 0x1c1009,
} as const;

/** Fire. Small, local, and the only warm thing in the room. */
export const FIRE = {
  /** Near-white flame core — one of the only blown-out things in frame. */
  core: 0xfff4dc,
  /** The body of the flame. */
  mid: 0xffb055,
  /** Cooling outer tongues. */
  edge: 0xff7a24,
  /** The point light a flame casts. Warmer than the core, it has to tint stone. */
  light: 0xffdcbf,
  /** Once-bounced firelight: a broad dim warm cast off the marble and the kerb. */
  bounce: 0xff9c55,
  /** Impact flare — a dust burst is lit white-grey, not orange. */
  flare: 0xffe8cf,
} as const;
