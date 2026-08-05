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
    uHazeColor: { value: new THREE.Vector3(0.0180, 0.0392, 0.0806) },
    /**
     * Thinned twice now. The veil is a mix TOWARD a fixed lifted blue, so it is a floor as
     * much as a fade: as the room's own light came down, the haze stopped reading as depth
     * and started reading as a flat plate laid over everything past the near kerb, erasing
     * the marble's veining and most of the chequer over the far half of the board — which
     * the reference carries in full contrast right up to the far kerb.
     *
     * Thinner again, and the veil colour above is brighter. The two go together. This is a
     * mix TOWARD a fixed colour, so whether haze reads as depth or as damage depends
     * entirely on whether that colour sits above or below what it is veiling. At 0.0122 /
     * 0.0281 / 0.0605 linear the veil was DARKER than lit marble, so the far half of the
     * board was being mixed downward: measured in boxes, the film's board runs 0.357 near
     * to 0.393 far — it gets brighter as it recedes — while ours ran 0.227 down to 0.184.
     * Half of that collapse was here. A real veil scatters light INTO the ray; it lifts and
     * de-saturates what is behind it and it never darkens it. Brighter colour, less of it.
     */
    uDensity: { value: 0.0138 },
    uStrength: { value: 0.74 },
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
