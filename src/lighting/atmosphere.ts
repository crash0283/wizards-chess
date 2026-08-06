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
    /**
     * Linear-space colour of the veil. Blue, lifted, low chroma.
     *
     * These three numbers are not a taste call any more, they are measured. Sampling the
     * reference's near board and ours in the same box, the dark navy squares come back at
     * RGB 30,39,58 in the film and 21,23,32 in ours. The DIFFERENCE — what has to be added
     * to our marble to make it the film's marble — is 8,16,26, a ratio of 0.22 : 0.48 : 1.
     * That is this colour, to two figures. The film's dark squares are not a darker blue
     * than ours, they are ours with air in front of them.
     */
    uHazeColor: { value: new THREE.Vector3(0.0180, 0.0392, 0.0806) },
    /**
     * How much of the veil acts as EXTINCTION rather than as inscatter, 0..1.
     *
     * This is the fix for the thing that has made haze read as damage in every previous
     * round. A `mix` toward a fixed colour does two things at once: it adds the airlight,
     * and it removes the same fraction of what is behind it. Those are one number in a mix
     * and they are not one number in physics. Over the 20-40 m of a room, with air this
     * clean, transmittance is very close to 1 while the scattered path radiance builds up
     * steadily — the airlight is real and the extinction is almost not there. Tying them
     * together is why every attempt to lift the dark squares with haze also crushed the
     * cream ones and flattened the far architecture, and why the veil kept having to be
     * thinned back down again.
     *
     * Split apart, the veil can be run three times as thick as before and it now does what
     * the brief says distance should do: the navy squares and the far piers come up and go
     * blue, the lit marble and the flames pass through almost untouched.
     */
    uExtinct: { value: 0.42 },
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
    /**
     * Set from a measured overshoot. At 0.0255 the split-out airlight did lift the navy
     * squares to the film's value, but it lifted the whole room with them: deep shadow
     * collapsed from 0.106 to 0.036 against the film's 0.106, and seven pixels in ten came
     * back reading cool against its four in ten. Airlight is a GLOBAL term — every metre of
     * air in front of every surface — and the board's missing brightness is not global, it
     * is a property of one polished floor. That part of the lift has moved to
     * `scene.environmentIntensity`, which is the room reflected in the marble and lands
     * nowhere else. What is left here is the veil the brief actually calls for: the far
     * wall visibly blue, the near board barely touched.
     */
    uDensity: { value: 0.0205 },
    uStrength: { value: 1.0 },
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
uniform float uDensity, uStrength, uHazeScale, uHazeFloor, uExtinct;
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

  // Airlight, not a wipe: the scattered term is ADDED, and only uExtinct of the veil is
  // taken back out of the transmitted image. See the uniform's note.
  gl_FragColor = vec4(src.rgb * (1.0 - veil * uExtinct) + uHazeColor * veil, src.a);
}
`,
};
