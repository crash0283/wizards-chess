/**
 * PIECE: camera — depth of field, done as a real circle of confusion.
 *
 * The reference frames are not uniformly blurred behind the subject: the softness grows
 * with distance, foreground plinths go soft *in front* of the focal plane as well, and
 * bright things out of focus grow into shapes rather than fading. That is a circle of
 * confusion, and nothing simpler reproduces it. So this is a scatter-as-gather bokeh:
 * every pixel is given a signed blur radius derived from depth (`lens.ts`), and the
 * gather accepts a neighbour's colour only if that neighbour's own blur circle is wide
 * enough to actually reach here. Two consequences fall straight out of that rule, and
 * both are visible in the frames:
 *
 *   - a sharp subject never gets contaminated by the soft background behind it, because
 *     the background's samples are rejected at the subject's pixels;
 *   - a soft foreground *does* spill over the sharp midground behind it, because its
 *     circles genuinely do reach — which is the half of depth of field that separable
 *     blurs always get wrong.
 *
 * WHERE THIS RUNS. The lighting piece owns the composer and the grade; this must not
 * touch either. But defocus is not grade — it happens at the glass, before the film, so
 * it has to land before the atmosphere, the bloom and the grain, and it has to be able to
 * read depth. The one seam that satisfies all of that without reaching into another
 * piece's code is `scene.onAfterRender`: three calls it after the scene render has
 * resolved into the composer's buffer and before any post pass has run. So the passes
 * below run there, sample that buffer and its depth texture, and hand back the same
 * buffer with the lens applied. Bloom then blooms the bokeh, and the grain lands on top
 * of the blur rather than inside it — which is the correct order and, incidentally, why
 * defocused film grain still looks sharp.
 *
 * Cost: the gather runs at half resolution, which is where the whole budget goes; the
 * full-resolution work is a lerp and a blit. Tap count scales with `world.quality`.
 */
import * as THREE from 'three';
import type { World } from '../core/world';
import { LENS, cocConstantPx } from './lens';

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Shared: depth -> signed circle of confusion radius, in pixels of the full frame. */
const COC_GLSL = /* glsl */ `
uniform float uNear, uFar, uFocus, uK, uMaxCoc, uNearKnee, uNearMax;
float linearDepth(float d){
  return (uNear * uFar) / (uFar - (uFar - uNear) * d);
}
float cocAt(float d){
  // Nothing drawn: the void past the architecture. Treat it as infinitely far so the
  // silhouette of a defocused arch against black goes soft on both sides of the edge.
  if (d >= 0.99995) return uMaxCoc;
  float z = linearDepth(d);
  float coc = uK * (z - uFocus) / max(z, 0.001);
  // Near-field roll-off — see the note in lens.ts. Physical up to the knee, then a
  // rational soft clip that approaches uNearMax and never reaches it.
  if (coc < -uNearKnee){
    float over = -coc - uNearKnee;
    float span = max(0.001, uNearMax - uNearKnee);
    coc = -(uNearKnee + span * over / (over + span));
  }
  return clamp(coc, -uMaxCoc, uMaxCoc);
}
`;

function prepShader() {
  return {
    uniforms: {
      tScene: { value: null as THREE.Texture | null },
      tDepth: { value: null as THREE.Texture | null },
      uInvSize: { value: new THREE.Vector2() },
      uNear: { value: 0.1 },
      uFar: { value: 400 },
      uFocus: { value: 8 },
      uK: { value: 0 },
      uMaxCoc: { value: LENS.maxCocPx },
      uNearKnee: { value: LENS.nearKneePx },
      uNearMax: { value: LENS.nearMaxPx },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform vec2 uInvSize;
varying vec2 vUv;
${COC_GLSL}
void main(){
  // One bilinear fetch at the half-res centre is an exact 4-texel box of the full frame.
  vec3 c = texture2D(tScene, vUv).rgb;
  // Depth cannot be filtered, so take the four texels and keep the strongest blur of the
  // group — losing a thin foreground edge into a background depth is far more visible
  // than the reverse.
  vec2 o = uInvSize * 0.5;
  float c0 = cocAt(texture2D(tDepth, vUv + vec2(-o.x, -o.y)).x);
  float c1 = cocAt(texture2D(tDepth, vUv + vec2( o.x, -o.y)).x);
  float c2 = cocAt(texture2D(tDepth, vUv + vec2(-o.x,  o.y)).x);
  float c3 = cocAt(texture2D(tDepth, vUv + vec2( o.x,  o.y)).x);
  float m = c0;
  if (abs(c1) > abs(m)) m = c1;
  if (abs(c2) > abs(m)) m = c2;
  if (abs(c3) > abs(m)) m = c3;
  gl_FragColor = vec4(c, m);
}
`,
  };
}

function nearShader(taps: number) {
  return {
    uniforms: {
      tPrep: { value: null as THREE.Texture | null },
      uInvSize: { value: new THREE.Vector2() },
      uRadius: { value: LENS.maxCocPx },
      uSqueeze: { value: LENS.squeeze },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
precision highp float;
uniform sampler2D tPrep;
uniform vec2 uInvSize;   // 1 / full-frame size, so offsets stay in frame pixels
uniform float uRadius, uSqueeze;
varying vec2 vUv;
#define TAPS ${taps}
void main(){
  // How far the near field spills, per pixel. A foreground blur circle of radius r
  // reaches r pixels outward, so the reach at this pixel is max(r - distance) over the
  // neighbourhood — a dilation with a linear falloff, which gives the spill a feathered
  // edge instead of a cut-out one.
  float best = max(0.0, -texture2D(tPrep, vUv).a);
  for (int i = 0; i < TAPS; i++){
    float fi = float(i) + 0.5;
    float rr = sqrt(fi / float(TAPS));
    float a = fi * 2.39996323;
    vec2 dir = vec2(cos(a) / uSqueeze, sin(a));
    float dist = rr * uRadius;
    vec2 off = dir * rr * uRadius * uInvSize;
    float coc = texture2D(tPrep, vUv + off).a;
    best = max(best, max(0.0, -coc) - dist);
  }
  gl_FragColor = vec4(max(best, 0.0));
}
`,
  };
}

function blurShader(taps: number) {
  return {
    uniforms: {
      tPrep: { value: null as THREE.Texture | null },
      tNear: { value: null as THREE.Texture | null },
      uInvSize: { value: new THREE.Vector2() },
      uSqueeze: { value: LENS.squeeze },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
precision highp float;
uniform sampler2D tPrep;
uniform sampler2D tNear;
uniform vec2 uInvSize;
uniform float uSqueeze;
varying vec2 vUv;
#define TAPS ${taps}

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main(){
  vec4 c = texture2D(tPrep, vUv);
  float near = texture2D(tNear, vUv).r;
  float R = max(abs(c.a), near);
  if (R < 1.0){
    gl_FragColor = vec4(c.rgb, R);
    return;
  }
  // Rotating the spiral per pixel turns the undersampling of a sparse kernel from rings
  // into noise, and noise is what the grain is about to sit on anyway.
  float rot = hash12(gl_FragCoord.xy) * 6.2831853;
  vec3 acc = c.rgb;
  float wsum = 1.0;
  for (int i = 0; i < TAPS; i++){
    float fi = float(i) + 0.5;
    float rr = sqrt(fi / float(TAPS));
    float a = fi * 2.39996323 + rot;
    // The iris is round in lens space; the anamorphic squeeze unpacks it into an oval
    // taller than it is wide, which is the format's signature on every soft highlight.
    vec2 dir = vec2(cos(a) / uSqueeze, sin(a));
    vec2 off = dir * rr * R * uInvSize;
    vec4 s = texture2D(tPrep, vUv + off);
    // Scatter as gather: this neighbour only reaches here if its own circle is that wide.
    float w = clamp(abs(s.a) - rr * R + 1.0, 0.0, 1.0);
    acc += s.rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(acc / max(wsum, 0.0001), R);
}
`,
  };
}

function compositeShader() {
  return {
    uniforms: {
      tScene: { value: null as THREE.Texture | null },
      tDepth: { value: null as THREE.Texture | null },
      tBlur: { value: null as THREE.Texture | null },
      tNear: { value: null as THREE.Texture | null },
      uBlurTexel: { value: new THREE.Vector2() },
      uNear: { value: 0.1 },
      uFar: { value: 400 },
      uFocus: { value: 8 },
      uK: { value: 0 },
      uMaxCoc: { value: LENS.maxCocPx },
      uNearKnee: { value: LENS.nearKneePx },
      uNearMax: { value: LENS.nearMaxPx },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tBlur;
uniform sampler2D tNear;
uniform vec2 uBlurTexel;
varying vec2 vUv;
${COC_GLSL}
void main(){
  vec4 sharp = texture2D(tScene, vUv);
  float coc = cocAt(texture2D(tDepth, vUv).x);
  float near = texture2D(tNear, vUv).r;
  // Thirty-six taps over a circle seventeen pixels across is a sparse sampling, and at a
  // hard silhouette — a black helm against a lit rank — the shortfall shows as speckle on
  // the boundary. Four extra taps of the gather's own output cost almost nothing here and
  // smooth it away, and softening something that is already out of focus costs no detail.
  vec2 e = uBlurTexel;
  vec3 blur = texture2D(tBlur, vUv).rgb * 0.4
    + (texture2D(tBlur, vUv + vec2( e.x,  e.y)).rgb
     + texture2D(tBlur, vUv + vec2(-e.x,  e.y)).rgb
     + texture2D(tBlur, vUv + vec2( e.x, -e.y)).rgb
     + texture2D(tBlur, vUv + vec2(-e.x, -e.y)).rgb) * 0.15;
  // Under a pixel of circle there is nothing to see: the plane of focus stays perfectly
  // sharp, which is what makes the soft parts read as soft.
  float far = smoothstep(0.75, 2.4, abs(coc));
  float spill = smoothstep(0.2, 2.2, near);
  gl_FragColor = vec4(mix(sharp.rgb, blur, clamp(max(far, spill), 0.0, 1.0)), sharp.a);
}
`,
  };
}

const COPY = {
  uniforms: { tSrc: { value: null as THREE.Texture | null } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
varying vec2 vUv;
void main(){ gl_FragColor = texture2D(tSrc, vUv); }
`,
};

export interface Bokeh {
  /** Lens state for the next frame. */
  set(focus: number, fstop: number, fovDeg: number): void;
  dispose(): void;
}

export function createBokeh(world: World): Bokeh {
  const high = world.quality === 'high';
  const TAPS = high ? 36 : 12;
  const NEAR_TAPS = high ? 12 : 6;
  const DOWN = 2;

  interface ShaderDef {
    uniforms: Record<string, { value: unknown }>;
    vertexShader: string;
    fragmentShader: string;
  }
  const mk = (s: ShaderDef) =>
    new THREE.ShaderMaterial({
      uniforms: s.uniforms as { [k: string]: THREE.IUniform },
      vertexShader: s.vertexShader,
      fragmentShader: s.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });

  const prepMat = mk(prepShader());
  const nearMat = mk(nearShader(NEAR_TAPS));
  const blurMat = mk(blurShader(TAPS));
  const compMat = mk(compositeShader());
  const copyMat = mk(COPY);

  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(quadGeo, prepMat);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const rtOpts = {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  } as const;

  let width = 0;
  let height = 0;
  let rtPrep: THREE.WebGLRenderTarget | null = null;
  let rtBlur: THREE.WebGLRenderTarget | null = null;
  let rtNear: THREE.WebGLRenderTarget | null = null;
  let rtFull: THREE.WebGLRenderTarget | null = null;

  function resize(w: number, h: number) {
    if (w === width && h === height && rtPrep) return;
    width = w;
    height = h;
    for (const rt of [rtPrep, rtBlur, rtNear, rtFull]) rt?.dispose();
    const hw = Math.max(1, Math.round(w / DOWN));
    const hh = Math.max(1, Math.round(h / DOWN));
    const qw = Math.max(1, Math.round(w / (DOWN * 2)));
    const qh = Math.max(1, Math.round(h / (DOWN * 2)));
    rtPrep = new THREE.WebGLRenderTarget(hw, hh, rtOpts);
    rtBlur = new THREE.WebGLRenderTarget(hw, hh, rtOpts);
    rtNear = new THREE.WebGLRenderTarget(qw, qh, rtOpts);
    rtFull = new THREE.WebGLRenderTarget(w, h, rtOpts);
  }

  // --- lens state, set by the rig each frame -------------------------------------------
  let focus = 8;
  let fstop = 2.8;
  let fov = 40;

  let busy = false;

  const renderer = world.renderer;
  const prevAfter = world.scene.onAfterRender;

  function pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }

  world.scene.onAfterRender = function (this: THREE.Scene, ...args) {
    // Chain, never replace: another piece may have wanted this hook first.
    prevAfter?.apply(this, args);
    const cam = args[2];
    if (busy) return;
    // Only the real frame. The board's reflection pass renders this same scene from a
    // mirrored camera into its own buffer; that one has no depth texture and no lens.
    if (cam !== world.camera) return;
    const target = renderer.getRenderTarget();
    if (!target || !target.depthTexture) return;

    const camera = world.camera;
    const K = cocConstantPx(fov, fstop, focus, target.height);
    // Deep focus: skip the whole chain rather than spend a pass proving it is sharp.
    if (K < 0.6) return;

    resize(target.width, target.height);
    const inv = new THREE.Vector2(1 / target.width, 1 / target.height);

    const setCoc = (u: any) => {
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.uFocus.value = focus;
      u.uK.value = K;
      const px = target.height / 804;
      u.uMaxCoc.value = LENS.maxCocPx * px;
      u.uNearKnee.value = LENS.nearKneePx * px;
      u.uNearMax.value = LENS.nearMaxPx * px;
    };

    const pu = prepMat.uniforms as any;
    pu.tScene.value = target.texture;
    pu.tDepth.value = target.depthTexture;
    pu.uInvSize.value.copy(inv);
    setCoc(pu);

    const nu = nearMat.uniforms as any;
    nu.tPrep.value = rtPrep!.texture;
    nu.uInvSize.value.copy(inv);
    // The dilation only has to find the near field, and the near field is bounded by the
    // roll-off — so this searches six pixels, not fifteen.
    nu.uRadius.value = LENS.nearMaxPx * (target.height / 804);

    const bu = blurMat.uniforms as any;
    bu.tPrep.value = rtPrep!.texture;
    bu.tNear.value = rtNear!.texture;
    bu.uInvSize.value.copy(inv);

    const cu = compMat.uniforms as any;
    cu.tScene.value = target.texture;
    cu.tDepth.value = target.depthTexture;
    cu.tBlur.value = rtBlur!.texture;
    cu.tNear.value = rtNear!.texture;
    cu.uBlurTexel.value.set(1 / rtBlur!.width, 1 / rtBlur!.height);
    setCoc(cu);

    (copyMat.uniforms as any).tSrc.value = rtFull!.texture;

    const prevAutoClear = renderer.autoClear;
    const prevTarget = target;
    const prevCube = renderer.getActiveCubeFace();
    const prevMip = renderer.getActiveMipmapLevel();
    busy = true;
    // Never clear: the last pass writes back into the scene buffer, whose depth texture
    // the lighting piece's atmosphere pass is about to read. Clearing it would take the
    // room's depth with it.
    renderer.autoClear = false;
    try {
      pass(prepMat, rtPrep);
      pass(nearMat, rtNear);
      pass(blurMat, rtBlur);
      // Composite reads the scene buffer, so it cannot also write to it — hence the
      // full-res intermediate and the blit that follows.
      pass(compMat, rtFull);
      pass(copyMat, prevTarget);
    } finally {
      busy = false;
      renderer.autoClear = prevAutoClear;
      renderer.setRenderTarget(prevTarget, prevCube, prevMip);
    }
  };

  return {
    set(f: number, n: number, fovDeg: number) {
      focus = Math.max(0.05, f);
      fstop = n;
      fov = fovDeg;
    },
    dispose() {
      world.scene.onAfterRender = prevAfter;
      for (const rt of [rtPrep, rtBlur, rtNear, rtFull]) rt?.dispose();
      for (const m of [prepMat, nearMat, blurMat, compMat, copyMat]) m.dispose();
      quadGeo.dispose();
    },
  };
}
