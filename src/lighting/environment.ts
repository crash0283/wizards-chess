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
  /** The grazing sheen sources that put a specular sweep across the marble. */
  sheen: THREE.SpotLight[];
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
  //
  // Eased down again now that the board carries its own exposure. A hemisphere light is
  // the most democratic source there is — it lifts the armies, the piers, the far wall and
  // the marble by the same amount — so every point of it works against the one thing this
  // frame needs, which is a bright board in a dark room. The armies were measuring 0.177
  // against the film's 0.119 and this is most of the reason. The room does not go darker
  // overall: what it loses here the marble more than makes back from the aisle and sheen.
  const hemi = new THREE.HemisphereLight(
    new THREE.Color(COLD.sky),
    new THREE.Color(COLD.ground),
    0.42,
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
  //
  // Doubled and then some, and it buys four metrics at once. An ambient term is multiplied
  // by albedo, so on the board it is invisible — the dark marble's albedo is 0.005 linear
  // and this cannot lift it — while on mid-grey stone at albedo ~0.25 it is the difference
  // between a surface and a silhouette. That matters because of where we still sit against
  // the film: too much of the frame is BELOW the floor rather than merely dark. Deep shadow
  // 0.129 against 0.106, shadow 0.547 against 0.510, and — the one that has been stuck for
  // three rounds — only 0.357 of the frame reading cool against 0.434, because a pixel
  // under luminance 0.06 counts as neither warm nor cool however blue it is. Lifting the
  // black stone to where its own colour is visible converts all four.
  const ambient = new THREE.AmbientLight(new THREE.Color(COLD.ambient), 0.16);
  group.add(ambient);

  // Not a key in the dramatic sense — an enormous soft pool of cold light hanging over
  // the board, wide enough that nothing in the ranks is modelled by a visible source,
  // with a long penumbra so the room falls away into the dark at the edges. A
  // DirectionalLight would light the far corners of the chamber exactly as brightly as
  // the board; the reference frames put the light on the marble and let everything
  // outside it go. It is also the only shadow-caster in the scene.
  // Cut hard, and deliberately. This cone is wide enough (radius ~12 m at the floor from
  // 27 m up) to cover the ranked armies as well as the marble, so every watt in it lights
  // board and army alike and can never open the gap between them. Measured box by box
  // against the film, the armies were already a third too bright — ours 0.177 against the
  // film's 0.119 down the left-hand rank — while the board sat at 0.227 against 0.357.
  // The energy that used to be here has moved into the aisle strip and the sheen rig
  // below, which land on the marble and nothing else. What is left is a contact-shadow
  // source: it is still the only shadow-caster in the scene and pieces still sit down on
  // their own shadows, but it no longer sets the level of anything.
  const key = new THREE.SpotLight(new THREE.Color(COLD.key), 190, 0, 0.42, 0.62, 1.0);
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
  // of the empty playing area, narrow across it. A row of overlapping narrow spots on the
  // centre line makes one: each covers about six metres of radius on the marble, so
  // together they light x = -13..13 at z = 0 and fall to nothing well before z = +-8.2.
  // They cast no shadows; the key remains the only shadow-caster.
  //
  // Up between two and four times, and biased hard down the room — 461 / 299 / 302 / 811
  // against a flat 200 before. This is the light that has to make the board
  // the luminous object in a black room, and it is the one place in the rig where extra
  // exposure lands on marble and on nothing else. The two marbles differ by roughly 100:1
  // in albedo (light 0xb9bcc3 against dark 0x0e1528), so DIFFUSE light on the board is the
  // only lever that separates the chequer: it multiplies the cream squares a hundred times
  // harder than the navy ones. Everything that was lifting the board before — the
  // environment's specular lobe, the depth haze, the ambient floor — is additive and lands
  // on both squares equally, which is exactly why the board read as one flat slab at a
  // single dark navy value. Box-measured against the film the light squares had to come up
  // from 0.416 to 0.662 while the dark ones stayed put at ~0.09; that is a diffuse-only
  // move and this is where it is made.
  //
  // Four now rather than three, and the far pair burn hotter than the near pair. In the
  // film the board gets BRIGHTER as it recedes — its far third measures 0.393 against 0.357
  // near — because the room's light hangs over the far end and grazes back toward the lens.
  // Ours fell from 0.227 to 0.184 across the same span, which reads as a lit foreground on
  // a dark floor rather than as a luminous field running away to a vanishing point.
  const aisle: THREE.SpotLight[] = [];
  for (const [ax, mul] of [
    [-9.2, 1.45],
    [-3.1, 0.94],
    [3.1, 0.95],
    [9.2, 2.55],
  ] as const) {
    const s = new THREE.SpotLight(new THREE.Color(COLD.key), 318 * mul, 0, 0.30, 0.86, 1.0);
    s.position.set(ax, 19, 0);
    s.target.position.set(ax, 0, 0);
    s.castShadow = false;
    group.add(s);
    group.add(s.target);
    aisle.push(s);
  }

  // --- the sheen ------------------------------------------------------------------------
  // The specular sweep across the marble, and it is a geometry problem before it is an
  // intensity one. A highlight appears where the half-vector between the light and the eye
  // lines up with the surface normal, so for a flat mirror the light has to sit on the ray
  // that runs from the camera's REFLECTION through the point you want lit. This camera sits
  // at (-23.5, 10.6, 0.4); mirrored in the board plane that is (-23.5, -10.6, 0.4), and the
  // ray from there through the middle of the board leaves the floor climbing away toward
  // +x. Hang a source anywhere along it and the marble throws it straight down the lens.
  //
  // Three of them, staggered across z and back along x, so the sweep is a broad soft band
  // rather than one hot spot — and because they graze in at 20-25 degrees they also give
  // the board a long, low diffuse rake that builds toward the far end, which is the
  // brightness gradient the film has and we did not. Cones are kept narrow across z so the
  // ranked armies at z = +-8.2 stay on the outside of them.
  //
  // Kept SMALL, and that is the whole discipline of it. A light this low is grazing, and a
  // grazing lobe is Fresnel-boosted specular — which is added on top of the albedo and is
  // therefore identical on a cream square and on a navy one. Run hot, it does not make the
  // board read: it erases the chequer faster than anything else in the rig, because it
  // lifts the dark squares by the same absolute amount as the light ones. First pass at
  // this had it at five times the level below and the near half of the board came back a
  // single blown white sheet with no squares in it at all. It is a highlight, not a key:
  // the diffuse level is the aisle's job, and the sheen only has to put a soft bright
  // sweep where the marble is throwing the room at the lens.
  const sheen: THREE.SpotLight[] = [];
  for (const [sx, sy, sz, si] of [
    [12.4, 7.6, -3.4, 1.0],
    [14.2, 8.8, 0.6, 1.25],
    [12.4, 7.6, 3.9, 1.0],
  ] as const) {
    // The cutoff distance is doing real work: a cone aimed at the middle of the board does
    // not stop there, and left unclamped these rake straight on across the near kerb and
    // blow its whole length out into one continuous white band. The film's near kerb is
    // dark stone with discrete fires standing on it. 30 m puts the sheen's last useful
    // light around the middle of the board and nothing on the kerb.
    const s = new THREE.SpotLight(new THREE.Color(COLD.sheen), 132 * si, 30, 0.30, 0.92, 1.0);
    s.position.set(sx, sy, sz);
    s.target.position.set(-5.0, 0, sz * 0.35);
    s.castShadow = false;
    group.add(s);
    group.add(s.target);
    sheen.push(s);
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
    const fill = new THREE.SpotLight(new THREE.Color(COLD.sky), 980, 21.0, 0.80, 0.92, 2.0);
    fill.position.set(10.2, 10.6, sz * 11.8);
    fill.target.position.set(7.4, 5.2, sz * 19.6);
    fill.castShadow = false;
    group.add(fill);
    group.add(fill.target);
    colonnade.push(fill);

    const rake = new THREE.SpotLight(new THREE.Color(COLD.sky), 1950, 34.0, 0.40, 0.80, 2.0);
    rake.position.set(-11.5, 10.4, sz * 16.2);
    rake.target.position.set(9.0, 4.4, sz * 19.0);
    rake.castShadow = false;
    group.add(rake);
    group.add(rake.target);
    colonnade.push(rake);

    // A second rake, hung high and thrown along the top of the wall. The top third of the
    // frame is where we are furthest from the film and it is a DETAIL gap, not a level one:
    // measured band by band the reference carries 0.0201 of high-frequency energy up there
    // against our 0.0086, while the two frames' mean luminance in the same band agree to
    // within a hundredth. There is nothing wrong with how bright our upper background is;
    // there is nothing in it. Detail up there is pier edges, capitals and the shadowed bays
    // between them, and none of that exists as an image unless something skims across it.
    // This one is aimed high and nearly along the wall, so it catches the arrises and
    // leaves the recesses black — modelling, not more wash.
    const crown = new THREE.SpotLight(new THREE.Color(COLD.sky), 1450, 30.0, 0.34, 0.72, 2.0);
    crown.position.set(-9.0, 13.6, sz * 15.0);
    crown.target.position.set(11.0, 9.6, sz * 18.4);
    crown.castShadow = false;
    group.add(crown);
    group.add(crown.target);
    colonnade.push(crown);

    // The near end of the leaning side screen. This is the black wedge that eats frame
    // left from the top of the picture down to the ranks: the screen begins at x = -17,
    // only six metres in front of a lens at x = -23.5, so it fills the frame edge — and
    // its visible face is turned back toward the camera, away from every source in the
    // room. Nothing reached it and it came back at the void colour. The reference has dim
    // but fully modelled masonry there, top to bottom of frame, and that stone is a large
    // slice of both the top band's missing structure and the frame's missing cool pixels:
    // a pixel below the black floor cannot count as any colour at all.
    //
    // Short range and aimed outward and back, so it lands on the screen's near end and
    // dies before it can reach the ranks standing behind it.
    //
    // HONEST RESULT: it did not move the frame corners at all — those boxes measured 0.089
    // and 0.038 before it went in and 0.089 and 0.038 after, and doubling the flat ambient
    // did not move them either. What is standing there is `voidStone` from the chamber
    // piece, albedo 0x0b0c11, which multiplied by any irradiance this room can supply is
    // still black. It is not a lighting problem and I do not own the material; the note in
    // the report is that the frame edges cannot come up until that material does. This
    // light stays because it does model the parts of the near screen that are NOT void
    // stone, and it is cheap.
    const nearEnd = new THREE.SpotLight(new THREE.Color(COLD.sky), 880, 15.0, 0.52, 0.82, 2.0);
    nearEnd.position.set(-12.6, 9.4, sz * 5.6);
    nearEnd.target.position.set(-16.4, 5.6, sz * 13.4);
    nearEnd.castShadow = false;
    group.add(nearEnd);
    group.add(nearEnd.target);
    colonnade.push(nearEnd);
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
  //
  // Re-hung as RAKES rather than as a frontal wash, and that is the whole point of this
  // revision. The end of the room is a screen of vertical shafts standing proud of a
  // plane. Light it head-on from out in the room and every shaft is lit identically all
  // the way round — you get a smooth vertical gradient with no edges in it, which is
  // precisely what the top of our frame was: the same mean luminance as the film's
  // (0.130 against 0.138, box for box) carrying less than half its structure
  // (high-frequency energy 0.0089 in the top band against 0.0201). The gap up there was
  // never a level, it was an absence of modelling.
  //
  // Two of these now sit close in against the screen, off to one side, and throw almost
  // ALONG it. Each shaft catches the light on the face turned toward the source and keeps
  // the other in shadow, so the screen resolves into alternating lit and dark verticals —
  // real edges, at the spatial frequency the film has them. They come from opposite ends
  // at different strengths, so the modelling does not cancel out down the middle. The
  // third is what is left of the old frontal, and it turned out to be load-bearing: with
  // the rakes alone the top band lost 0.03 of mean luminance and the whole frame's median
  // fell 0.02, because two narrow cones simply do not cover the area three wide ones did.
  // It went back in at roughly its old strength. The rakes buy the modelling, the frontal
  // buys the level; the top band's high-frequency energy came up from 0.0084 to 0.0102 on
  // the pair of them.
  const wash: THREE.SpotLight[] = [];
  for (const [wx, wy, wz, tx, ty, tz, wi, wa] of [
    [12.8, 6.2, -13.8, CHAMBER.halfWidth - 0.3, 5.0, -2.5, 2050, 0.42],
    [12.8, 7.9, 13.8, CHAMBER.halfWidth - 0.3, 6.4, 1.5, 1720, 0.42],
    [7.2, 10.4, 0.0, CHAMBER.halfWidth, 6.4, 0.0, 1400, 0.64],
  ] as const) {
    const s = new THREE.SpotLight(new THREE.Color(COLD.sky), wi, 24, wa, 0.62, 2.0);
    s.position.set(wx, wy, wz);
    s.target.position.set(tx, ty, tz);
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
    sheen,
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
      for (const s of sheen) s.dispose();
      for (const s of colonnade) s.dispose();
      for (const s of wash) s.dispose();
      envTexture?.dispose();
    },
  };
}
