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
  wash: THREE.SpotLight;
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

  // A hemisphere light has no falloff: it grazes the far colonnade exactly as hard as it
  // grazes the near kerb, so every metre of stone in frame comes back legible and
  // nothing is ever allowed to be unlit. Measured against the reference's picture area
  // that showed up as deep shadow living almost entirely in the vignette ring (0.284 of
  // the top third) and nowhere at all in the mid band (0.000 across all six cells, where
  // the film runs 0.121/0.168/0.001/0.000/0.054/0.237). The blacks were in the lens
  // instead of in the room. This is now a floor, not a fill — enough to keep material
  // response alive, far too little to describe anything on its own.
  const hemi = new THREE.HemisphereLight(
    new THREE.Color(COLD.sky),
    new THREE.Color(COLD.ground),
    0.15,
  );
  hemi.position.set(0, 18, 0);
  group.add(hemi);

  // Effectively off. A flat ambient term is the one light in the rig that cannot cast a
  // shadow or fall off, so every unit of it is a unit of "nothing in frame reaches black".
  const ambient = new THREE.AmbientLight(new THREE.Color(COLD.ambient), 0.008);
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
  const key = new THREE.SpotLight(new THREE.Color(COLD.key), 470, 0, 0.45, 0.6, 1.0);
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
    const s = new THREE.SpotLight(new THREE.Color(COLD.key), 300, 0, 0.28, 0.85, 1.0);
    s.position.set(ax, 20, 0);
    s.target.position.set(ax, 0, 0);
    s.castShadow = false;
    group.add(s);
    group.add(s.target);
    aisle.push(s);
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
  const wash = new THREE.SpotLight(new THREE.Color(COLD.sky), 2200, 26, 0.70, 0.65, 2.0);
  wash.position.set(2.0, 12.5, 0);
  wash.target.position.set(CHAMBER.halfWidth, 6.5, 0);
  wash.castShadow = false;
  group.add(wash);
  group.add(wash.target);

  const background = new THREE.Color(COLD.voidColor);
  const envTexture = buildEnv(world.renderer);

  return {
    group,
    hemi,
    ambient,
    key,
    aisle,
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
        scene.environmentIntensity = 0.10;
      }
    },
    dispose() {
      hemi.dispose();
      ambient.dispose();
      key.dispose();
      for (const s of aisle) s.dispose();
      wash.dispose();
      envTexture?.dispose();
    },
  };
}
