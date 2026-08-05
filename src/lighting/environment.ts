/**
 * PIECE: lighting — the cold room itself.
 *
 * No hard key. A soft cool ambient fills a very deep space and models every piece
 * gently; a prefiltered gradient environment supplies the broad specular the polished
 * marble needs; an exponential blue haze turns distance into desaturation and blue
 * lift rather than into darkness.
 */
import * as THREE from 'three';
import type { World } from '../core/world';
import { CHAMBER } from '../core/constants';
import { COLD } from './palette';

export interface Environment {
  group: THREE.Object3D;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  key: THREE.SpotLight;
  /** The soft strip over the empty playing area. No shadows. */
  aisle: THREE.SpotLight[];
  /** Cold light on the two long walls, which frame left and frame right look down. */
  colonnade: THREE.SpotLight[];
  /** The end wall, and only the end wall. */
  wash: THREE.SpotLight[];
  envTexture: THREE.Texture | null;
  /** Re-assert scene-level atmosphere. Cheap; called once a frame from render(). */
  apply(scene: THREE.Scene): void;
  dispose(): void;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uFloor;
uniform vec3 uFire;
varying vec3 vDir;
void main(){
  float y = clamp(vDir.y, -1.0, 1.0);
  vec3 c;
  if (y >= 0.0) {
    // The vault is unresolved dark; the light lives at and just above the arcade.
    c = mix(uHorizon, uTop, pow(y, 0.55));
  } else {
    c = mix(uHorizon, uFloor, pow(-y, 0.75));
    // A whisper of bounced fire low down so undersides are not dead blue.
    c += uFire * smoothstep(0.0, -0.55, y) * 0.6;
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

/** Build the cold gradient env once, through PMREM, so roughness response is correct. */
function buildEnv(renderer: THREE.WebGLRenderer): THREE.Texture | null {
  try {
    const scene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 32, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(COLD.envTop).convertSRGBToLinear() },
        uHorizon: { value: new THREE.Color(COLD.envHorizon).convertSRGBToLinear() },
        uFloor: { value: new THREE.Color(COLD.envFloor).convertSRGBToLinear() },
        uFire: { value: new THREE.Color(COLD.envFireBounce).convertSRGBToLinear() },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    });
    const sphere = new THREE.Mesh(geo, mat);
    scene.add(sphere);

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const rt = pmrem.fromScene(scene, 0.0, 0.1, 100);
    geo.dispose();
    mat.dispose();
    pmrem.dispose();
    return rt.texture;
  } catch {
    // Software GL can be fussy about float cube targets; the scene still lights without it.
    return null;
  }
}

export function createEnvironment(world: World): Environment {
  const group = new THREE.Group();
  group.name = 'lighting-environment';

  // The soft cool ambient, and it is meant to be the room's dominant light — the brief is
  // explicit that there is "no hard key" and that this is what models every piece.
  //
  // It had been cut to 0.15 chasing a deep-shadow target that turns out to be an artefact
  // of how the two images are measured. `tools/metrics.mjs` reads whole files: our render
  // is 1920x804 of pure picture, while the reference frame is 1920x1080 with 274 rows of
  // letterbox. Those bars are 25.4% of the reference's pixels and every one of them is
  // literal black, so they alone account for 0.254 of its 0.331 "fracDeepShadow" and drag
  // its "meanSaturation" from 0.323 down to 0.242. Cropped to picture on both sides the
  // real comparison inverts: the film is at 0.104 deep shadow and we were at 0.190. The
  // room was already twice as black as the film and being pushed blacker.
  const hemi = new THREE.HemisphereLight(
    new THREE.Color(COLD.sky),
    new THREE.Color(COLD.ground),
    0.48,
  );
  hemi.position.set(0, 18, 0);
  group.add(hemi);

  // A real floor under the blacks, which is the one thing a hemisphere light cannot give.
  // The shot fires down the room from OUTSIDE the west wall, so the two vertical masses
  // that bound frame left and frame right are the near piers of that wall, seen from the
  // wrong side: their visible faces point at the lens and away from every source in the
  // room, and no amount of light hung over the board will ever touch them. They came back
  // at RGB 6,7,8 — literally the void colour — and took the outer grid columns to 0.45 and
  // 0.76 deep shadow where the film has 0.19 and 0.20. In the film those same near piers
  // are dim but modelled: you can read the fluting on them. A flat term is the honest way
  // to say "this room has been burning for a thousand years and the soot on the walls
  // still returns something", and at this level it lands them just clear of the floor.
  const ambient = new THREE.AmbientLight(new THREE.Color(COLD.ambient), 0.045);
  group.add(ambient);

  // Not a key in the dramatic sense — an enormous soft pool of cold light hanging over
  // the board, wide enough that nothing in the ranks is modelled by a visible source,
  // with a long penumbra so the room falls away into the dark at the edges. A
  // DirectionalLight would light the far corners of the chamber exactly as brightly as
  // the board; the reference frames put the light on the marble and let everything
  // outside it go. It is also the only shadow-caster in the scene.
  // Narrower and stronger than it was. The reference's bright field is tightly confined
  // to the middle of the frame — the two centre cells of the grid sit at luminance 0.359
  // and 0.353 while the cells either side of them, holding the ranked armies, drop to
  // 0.110 and 0.147. Ours spread 0.25-0.35 across four cells: the pool was wide enough
  // to cover the armies and the aisles behind them, so the lateral falloff that separates
  // board from room never happened. Tightening the cone and lengthening the penumbra puts
  // the light on the marble and lets the ranks sit on the shoulder of it.
  const key = new THREE.SpotLight(new THREE.Color(COLD.key), 320, 0, 0.45, 0.6, 1.0);
  key.position.set(-2.5, 27, 1.5);
  key.target.position.set(0, 0, 0);
  group.add(key);
  group.add(key.target);

  // The aisle. A round pool cannot produce the reference's distribution, and that is why
  // widening or narrowing the key never fixed it: an overhead spot puts the ranked armies
  // (z = +-8.2) and the near kerb (x = -10.2) at almost exactly the same angle off its
  // axis — 14.8 and 16.2 degrees — so any cone that lights the near kerb lights the armies
  // just as hard. The reference separates them completely: the two centre columns of the
  // frame run 0.174/0.229 (top), 0.359/0.353 (middle) and 0.363/0.368 (bottom) while the
  // columns holding the armies sit at 0.110 and 0.147.
  //
  // What that distribution describes is not a pool but a STRIP — a soft running the length
  // of the empty playing area, narrow across it. Three overlapping narrow spots on the
  // centre line make one: each covers about six metres of radius on the marble, so
  // together they light x = -13..13 at z = 0 and fall to nothing well before z = +-8.2.
  // They cast no shadows; the key remains the only shadow-caster.
  const aisle: THREE.SpotLight[] = [];
  for (const ax of [-7.5, 0, 7.5]) {
    const s = new THREE.SpotLight(new THREE.Color(COLD.key), 185, 0, 0.28, 0.85, 1.0);
    s.position.set(ax, 20, 0);
    s.target.position.set(ax, 0, 0);
    s.castShadow = false;
    group.add(s);
    group.add(s.target);
    aisle.push(s);
  }

  // The colonnade. `wide-establishing` puts the camera outside the west wall at x = -23.5
  // looking down +x, so frame left and frame right are the two LONG walls (z = -19 and
  // z = +19) seen in steep perspective — and only their far halves, from about x = 0 to
  // the east wall at x = 15.5, are inside the 79-degree horizontal field at all.
  //
  // In the reference those piers are the content of the top band: cold, modelled, clearly
  // readable fluting running the full height of frame, with the odd flame at their feet.
  // Ours were void. Nothing in the rig reached them — every source above was aimed at the
  // board, and a flame's two-and-a-half-metre pool cannot cross ten metres of floor. So
  // the whole upper third of the picture had no light in it at all, which is why our top
  // corners came back 69% and 79% deep black against the film's 19% and 20%, and why we
  // read 12 points short on the fraction of frame that is cool: the film's cool pixels are
  // largely THIS, lit stone, and ours were below the threshold where a pixel counts as
  // any colour at all.
  //
  // Two per wall, and they are deliberately different lights.
  //
  // The first hangs out in the room at the far end and aims back into the masonry: it is
  // what puts tone on the wall at all. The second is a long raking throw from the camera's
  // end, almost parallel to the wall. That one matters because the piers stand a metre and
  // a half proud of it and the camera, sitting off to one side, sees their -x faces: a
  // light coming from the room's far end lights the faces we CANNOT see and leaves every
  // visible one flat black. The rake lights the faces we can, and — because it skims —
  // leaves the bays between piers unlit. That alternation of lit shaft and black bay is
  // what the film's frame edges are made of, and it is where the film keeps its shadow:
  // its outer grid columns hold 0.19/0.16/0.07 and 0.20/0.18/0.15 deep shadow top to
  // bottom, spread through the whole height, not dumped in a ring at the top.
  const colonnade: THREE.SpotLight[] = [];
  for (const sz of [-1, 1] as const) {
    const fill = new THREE.SpotLight(new THREE.Color(COLD.sky), 780, 21.0, 0.80, 0.92, 2.0);
    fill.position.set(10.2, 10.6, sz * 11.8);
    fill.target.position.set(7.4, 5.2, sz * 19.6);
    fill.castShadow = false;
    group.add(fill);
    group.add(fill.target);
    colonnade.push(fill);

    const rake = new THREE.SpotLight(new THREE.Color(COLD.sky), 1350, 34.0, 0.40, 0.80, 2.0);
    rake.position.set(-11.5, 10.4, sz * 16.2);
    rake.target.position.set(9.0, 4.4, sz * 19.0);
    rake.castShadow = false;
    group.add(rake);
    group.add(rake.target);
    colonnade.push(rake);
  }

  if (world.quality === 'high') {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 4;
    key.shadow.camera.far = 60;
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = -0.0009;
    key.shadow.normalBias = 0.05;
    key.shadow.radius = 5;
  }

  // The far wall, and ONLY the far wall. What used to sit here was a 72-degree cone from
  // 24 m up with no distance clamp — geometrically a second sky, and the thing that made
  // the whole back colonnade uniformly washed and readable floor to top of frame. It has
  // been re-hung low and deep, aimed down the long axis at the end wall, and given a hard
  // cutoff distance so its contribution is already gone by the time it reaches the ranks.
  //
  // It has to exist: measured on the reference's picture area the top-centre of frame is
  // the BRIGHTEST part of the upper band (luminance 0.229, with only 0.012 of it in deep
  // shadow) because the end wall above the rubble heap is genuinely lit. Ours was 0.089.
  // The note that "the ceiling is a total void" is true of the vault, which is above this
  // frame line; what is actually at the top of this frame is lit masonry.
  //
  // One cone could not do it. The end wall is 38 m wide and the camera, sitting out at
  // x = -23.5, sees the whole of it: it projects across the middle 1160 pixels of frame
  // and — because the top of frame at that distance is only 9 m off the floor — it fills
  // the entire top of the picture there. A single 40-degree cone hung 15 m off it lit a
  // 550-pixel strip of that and left the rest of the end of the room black, which is most
  // of why our top band measured 0.087/0.092 mean luminance against the film's
  // 0.155/0.218. Three overlapping cones cover the wall corner to corner.
  const wash: THREE.SpotLight[] = [];
  for (const wz of [-11.5, 0, 11.5]) {
    const s = new THREE.SpotLight(new THREE.Color(COLD.sky), 1780, 24, 0.62, 0.68, 2.0);
    s.position.set(2.6, 9.4, wz * 0.55);
    s.target.position.set(CHAMBER.halfWidth, 5.4, wz);
    s.castShadow = false;
    group.add(s);
    group.add(s.target);
    wash.push(s);
  }

  const background = new THREE.Color(COLD.voidColor);
  const envTexture = buildEnv(world.renderer);

  return {
    group,
    hemi,
    ambient,
    key,
    aisle,
    colonnade,
    wash,
    envTexture,
    apply(scene: THREE.Scene) {
      // Atmosphere is lighting's to own, and it is the single biggest lever on the
      // "cold room" read. The veil is done in post off the depth buffer (see
      // atmosphere.ts) so it can thin with height; three's uniform fog would light the
      // vault as brightly as the far wall, which is exactly backwards.
      if (scene.fog !== null) scene.fog = null;
      if (scene.background !== background) scene.background = background;
      if (envTexture && scene.environment !== envTexture) {
        scene.environment = envTexture;
        // Third of what it was. An IBL is another light with no falloff — it was
        // contributing diffuse to the far piers at full strength and helping hold the
        // whole frame off the floor. Kept only for the broad specular the polished marble
        // needs, which is what it is actually here for.
        scene.environmentIntensity = 0.16;
      }
    },
    dispose() {
      hemi.dispose();
      ambient.dispose();
      key.dispose();
      for (const s of aisle) s.dispose();
      for (const s of colonnade) s.dispose();
      for (const s of wash) s.dispose();
      envTexture?.dispose();
    },
  };
}
