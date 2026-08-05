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
import { COLD } from './palette';

export interface Environment {
  group: THREE.Object3D;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  key: THREE.SpotLight;
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

  // Deliberately weaker than it wants to be. A hemisphere bright enough to model the far
  // corners is also bright enough to swamp every flame, and the result is the failure
  // mode the frames make obvious: one uniform cold wash doing all the work, with the
  // fires reduced to self-luminous decals. The fires carry the near field; this only has
  // to keep the deep room from going to solid black.
  const hemi = new THREE.HemisphereLight(
    new THREE.Color(COLD.sky),
    new THREE.Color(COLD.ground),
    0.86,
  );
  hemi.position.set(0, 18, 0);
  group.add(hemi);

  const ambient = new THREE.AmbientLight(new THREE.Color(COLD.ambient), 0.062);
  group.add(ambient);

  // Not a key in the dramatic sense — an enormous soft pool of cold light hanging over
  // the board, wide enough that nothing in the ranks is modelled by a visible source,
  // with a long penumbra so the room falls away into the dark at the edges. A
  // DirectionalLight would light the far corners of the chamber exactly as brightly as
  // the board; the reference frames put the light on the marble and let everything
  // outside it go. It is also the only shadow-caster in the scene.
  const key = new THREE.SpotLight(new THREE.Color(COLD.key), 470, 0, 0.56, 0.31, 1.0);
  key.position.set(-2.5, 27, 1.5);
  key.target.position.set(0, 0, 0);
  group.add(key);
  group.add(key.target);

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

  // The wash. Same colour, an order of magnitude softer and wide enough to take in the
  // piers, the arcade and the portal at the far end. Without it the key's penumbra ends
  // just past the kerb and the architecture drops out of the frame entirely — the
  // reference has a readable, gently modelled wall behind the ranks, and losing it costs
  // both the depth cue and most of the frame's upper-band detail. It casts no shadows,
  // so it stays a wash rather than becoming a second key.
  const wash = new THREE.SpotLight(new THREE.Color(COLD.sky), 340, 0, 1.25, 0.45, 2.0);
  wash.position.set(0, 24, 2);
  wash.target.position.set(0, 2, -6);
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
        scene.environmentIntensity = 0.20;
      }
    },
    dispose() {
      hemi.dispose();
      ambient.dispose();
      key.dispose();
      wash.dispose();
      envTexture?.dispose();
    },
  };
}
