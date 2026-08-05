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
  sky: 0x9db4cc,
  /** Hemisphere ground term — cold bounce off the marble, darker and bluer. */
  ground: 0x3b4048,
  /** Flat ambient floor so nothing in the deep room goes to pure black too early. */
  ambient: 0x556880,
  /** The very soft top light that grounds pieces with a contact shadow. */
  key: 0xa2c0f0,
  /** Atmospheric veil colour. Distance reads as *this*, not as darkness. */
  haze: 0x22334f,
  /** Unresolved ceiling / beyond-the-arcade void. */
  voidColor: 0x05070c,
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
