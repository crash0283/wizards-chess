/**
 * PIECE: lighting — atmospheric depth, done in post off the depth buffer.
 *
 * three's built-in fog would veil the unresolved vault as strongly as it veils the far
 * wall, and the reference frames do the opposite: the ceiling is dead black while the
 * far wall is heavily blue-veiled. Haze is a *volume* — it sits low, around the board
 * and the flames, and thins with height. So the veil is reconstructed per pixel from
 * depth, weighted by world height, and distance ends up reading as desaturation and
 * blue lift rather than as darkness.
 */
import * as THREE from 'three';

export const AtmosphereShader = {
  name: 'ChamberAtmosphere',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uProjInv: { value: new THREE.Matrix4() },
    uViewInv: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    /** Linear-space colour of the veil. Blue, lifted, low chroma. */
    uHazeColor: { value: new THREE.Vector3(0.0122, 0.0281, 0.0605) },
    uDensity: { value: 0.026 },
    uStrength: { value: 0.92 },
    /** Height (metres) over which the haze thins out toward the vault. */
    uHazeScale: { value: 4.5 },
    uHazeFloor: { value: 4.5 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
  fragmentShader: /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uCamPos;
uniform vec3 uHazeColor;
uniform float uDensity, uStrength, uHazeScale, uHazeFloor;
varying vec2 vUv;

void main(){
  vec4 src = texture2D(tDiffuse, vUv);
  float d = texture2D(tDepth, vUv).x;

  // Nothing was drawn here: this is the void beyond the architecture. Leave it black —
  // veiling it is what turns a vaulted ceiling into fog soup.
  if (d >= 0.99995) {
    gl_FragColor = src;
    return;
  }

  vec4 clip = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 view = uProjInv * clip;
  view /= view.w;
  vec3 world = (uViewInv * view).xyz;

  float dist = length(world - uCamPos);
  float base = 1.0 - exp(-dist * dist * uDensity * uDensity);
  float height = exp(-max(0.0, world.y - uHazeFloor) / uHazeScale);
  float veil = clamp(base * height * uStrength, 0.0, 0.94);

  gl_FragColor = vec4(mix(src.rgb, uHazeColor, veil), src.a);
}
`,
};
