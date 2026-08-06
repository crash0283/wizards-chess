/**
 * What the player can see about their own turn.
 *
 * Before this existed a person clicked blind: nothing marked the piece they had picked
 * up, nothing showed where it could legally go, an illegal click did nothing at all, and
 * check and checkmate were a word in the HUD. This module is the answer, and it stays in
 * the room's own language — everything here is firelight on stone. Sigils scorched into
 * the marble, embers that breathe, a hot ring under a king in check. No HTML, no floating
 * buttons, nothing that could not be in the chamber.
 *
 * All of it is INTERACTIVE ONLY. The constructor is never called under capture, so the
 * scripted shots (`piece-mid-strike`, `aftermath-rubble`, `king-surrender`) render exactly
 * the pixels they rendered before this file existed.
 *
 * Cost discipline: five materials, four geometries, one canvas texture each. Markers come
 * from a fixed pool that is shown and hidden rather than rebuilt, so picking up a queen
 * with twenty-seven legal moves allocates nothing.
 */
import * as THREE from 'three';
import type { World } from '../core/world';
import { PALETTE, SQUARE, squareCentre } from '../core/constants';

/** Marker plane height above the marble. Clears the slabs' own relief. */
const Y = 0.055;

/** Board squares a king in check / a mated king is marked on. */
export type Mark = { file: number; rank: number };

export interface PromotionOption {
  /** 'q' | 'r' | 'b' | 'n' — what the engine wants back. */
  promo: 'q' | 'r' | 'b' | 'n';
  object: THREE.Object3D;
}

export interface Affordances {
  group: THREE.Object3D;
  /** Ring under the piece the player has picked up. `null` clears it. */
  setSelection(sq: Mark | null): void;
  /** Where that piece may legally go. `capture` squares get the hot, toothed sigil. */
  setDestinations(quiet: Mark[], captures: Mark[]): void;
  /** An illegal click: scorch the square briefly so the click is visibly refused. */
  refuse(sq: Mark, time: number): void;
  /** The square of a king in check, or null. */
  setCheck(sq: Mark | null): void;
  /** Terminal position: mark the losing king (or the stalemated one) and drop the room. */
  setGameOver(kind: 'mate' | 'draw' | null, king: Mark | null, time: number): void;
  /** Raise the promotion tablets over a square. Returns the clickable options. */
  showPromotion(sq: Mark, side: 'white' | 'black'): PromotionOption[];
  hidePromotion(): void;
  /** Objects a pointer ray should be tested against before the board plane. */
  pickables(): THREE.Object3D[];
  update(time: number): void;
  dispose(): void;
}

// --- procedural sigils ---------------------------------------------------------------
//
// Drawn once into a canvas and used as an alpha map. They are meant to read as something
// scorched into the slab by the same fire that lights the room, so every stroke is a
// blurred, uneven glow rather than a clean vector shape.

function canvas(size = 256): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, size, size);
  return g;
}

function toTexture(g: CanvasRenderingContext2D): THREE.Texture {
  const t = new THREE.CanvasTexture(g.canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Selection: a heavy scorched ring with radial chisel ticks, like a socket cut for it. */
function selectionSigil(): THREE.Texture {
  const g = canvas(256);
  const c = 128;
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.shadowColor = '#fff';
  g.shadowBlur = 10;
  g.lineWidth = 7;
  g.beginPath(); g.arc(c, c, 96, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2.5;
  g.globalAlpha = 0.55;
  g.beginPath(); g.arc(c, c, 78, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 1;
  g.lineWidth = 6;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r0 = i % 4 === 0 ? 100 : 104;
    const r1 = i % 4 === 0 ? 122 : 114;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    g.stroke();
  }
  return toTexture(g);
}

/** A quiet destination: a small ember pooled in the middle of the slab. */
function moveSigil(): THREE.Texture {
  const g = canvas(128);
  const c = 64;
  const grad = g.createRadialGradient(c, c, 0, c, c, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(c, c, 30, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 2.5;
  g.beginPath(); g.arc(c, c, 44, 0, Math.PI * 2); g.stroke();
  return toTexture(g);
}

/** A capture: a ring of teeth, open at the middle so the victim still reads through it. */
function captureSigil(): THREE.Texture {
  const g = canvas(256);
  const c = 128;
  g.strokeStyle = '#fff';
  g.shadowColor = '#fff';
  g.shadowBlur = 12;
  g.lineWidth = 9;
  g.lineCap = 'butt';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.beginPath();
    g.arc(c, c, 94, a + 0.10, a + 0.60);
    g.stroke();
  }
  g.lineWidth = 7;
  g.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * 58, c + Math.sin(a) * 58);
    g.lineTo(c + Math.cos(a) * 80, c + Math.sin(a) * 80);
    g.stroke();
  }
  return toTexture(g);
}

/** Check / refusal / mate all share one jagged starburst, tinted and scaled differently. */
function burstSigil(): THREE.Texture {
  const g = canvas(256);
  const c = 128;
  g.fillStyle = '#fff';
  g.shadowColor = '#fff';
  g.shadowBlur = 18;
  g.beginPath();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = i % 2 === 0 ? 118 : 62;
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.globalAlpha = 0.5;
  g.fill();
  g.globalAlpha = 1;
  g.lineWidth = 5;
  g.strokeStyle = '#fff';
  g.stroke();
  return toTexture(g);
}

/**
 * The promotion tablets carry the piece's own rune. Unicode chess figurines are the one
 * place a glyph is honest: they are pictures of the pieces, not letters.
 */
function runeTexture(glyph: string): THREE.Texture {
  const g = canvas(256);
  g.font = '190px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.shadowColor = '#fff';
  g.shadowBlur = 14;
  g.fillText(glyph, 128, 140);
  return toTexture(g);
}

// --- the module ------------------------------------------------------------------------

interface Marker {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  born: number;
}

export function createAffordances(world: World): Affordances {
  const group = new THREE.Group();
  group.name = 'game-affordances';
  group.matrixAutoUpdate = false;

  const quad = new THREE.PlaneGeometry(1, 1);
  const textures = {
    select: selectionSigil(),
    move: moveSigil(),
    capture: captureSigil(),
    burst: burstSigil(),
  };

  const flat = (tex: THREE.Texture, colour: number, opacity: number) =>
    new THREE.MeshBasicMaterial({
      map: tex,
      color: colour,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: true,
      side: THREE.DoubleSide,
    });

  const mats = {
    select: flat(textures.select, PALETTE.fireCore, 0.9),
    move: flat(textures.move, PALETTE.fireMid, 0.75),
    capture: flat(textures.capture, 0xff5a22, 0.85),
    refuse: flat(textures.burst, 0x8e2412, 0.0),
    check: flat(textures.burst, 0xd8452a, 0.7),
    mate: flat(textures.burst, 0xff7a2e, 0.85),
  };

  /** A flat sigil lying on the marble. */
  function plate(mat: THREE.MeshBasicMaterial, size: number): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    const m = new THREE.Mesh(quad, mat);
    m.rotation.x = -Math.PI / 2;
    m.scale.setScalar(size);
    m.visible = false;
    m.renderOrder = 3;
    m.frustumCulled = false;
    group.add(m);
    return m;
  }

  const selection = plate(mats.select, SQUARE * 0.94);
  const check = plate(mats.check, SQUARE * 1.02);
  const mate = plate(mats.mate, SQUARE * 1.55);
  // Drawn AFTER the dimming quad below, so the fire withdrawing from the room does not
  // take the mark under the fallen king with it. Still depth-tested, so it stays on the
  // floor rather than floating over the pieces.
  mate.renderOrder = 950;

  // Destination pool. 28 covers a queen on an open board (27) with room to spare; the
  // rare overflow simply is not drawn rather than allocating mid-turn.
  const dests: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  for (let i = 0; i < 28; i++) dests.push(plate(mats.move, SQUARE * 0.5));

  // Refusals: a couple in flight is plenty, they last under half a second.
  const refusals: Marker[] = [];
  for (let i = 0; i < 3; i++) refusals.push({ mesh: plate(mats.refuse, SQUARE * 0.8), born: -1 });

  function place(m: THREE.Object3D, sq: Mark, y = Y) {
    const { x, z } = squareCentre(sq.file, sq.rank);
    m.position.set(x, y, z);
  }

  // --- the room going out ----------------------------------------------------------
  // A game that has ended must be unmistakable, and the strongest statement available in
  // a firelit room is the fire withdrawing from everything except the fallen king. This
  // is a dark quad held in front of the camera, oversized so a frame of handheld drift
  // cannot show its edge. It is positioned from the camera's CURRENT transform each
  // frame; game.update runs before the camera rig, so it trails by one frame, which the
  // oversize absorbs.
  const dimMat = new THREE.MeshBasicMaterial({
    color: 0x05070b, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
    toneMapped: false, side: THREE.DoubleSide,
  });
  const dim = new THREE.Mesh(quad, dimMat);
  dim.renderOrder = 900;
  dim.frustumCulled = false;
  dim.visible = false;
  group.add(dim);

  // --- promotion tablets -------------------------------------------------------------
  const GLYPHS: Array<{ promo: 'q' | 'r' | 'b' | 'n'; white: string; black: string }> = [
    { promo: 'q', white: '♕', black: '♛' },
    { promo: 'r', white: '♖', black: '♜' },
    { promo: 'b', white: '♗', black: '♝' },
    { promo: 'n', white: '♘', black: '♞' },
  ];
  const runes = {
    white: GLYPHS.map((g) => runeTexture(g.white)),
    black: GLYPHS.map((g) => runeTexture(g.black)),
  };
  const slab = new THREE.BoxGeometry(1.5, 0.18, 1.5);
  const slabMat = new THREE.MeshStandardMaterial({
    color: PALETTE.stoneDark, roughness: 0.92, metalness: 0.0,
    emissive: new THREE.Color(PALETTE.fireDeep), emissiveIntensity: 0.35,
  });
  const promoGroup = new THREE.Group();
  promoGroup.visible = false;
  group.add(promoGroup);

  const tablets = GLYPHS.map((g, i) => {
    const holder = new THREE.Group();
    const stone = new THREE.Mesh(slab, slabMat);
    stone.castShadow = false;
    stone.receiveShadow = false;
    holder.add(stone);
    const faceMat = new THREE.MeshBasicMaterial({
      map: runes.white[i], color: PALETTE.fireCore, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.95,
    });
    const face = new THREE.Mesh(quad, faceMat);
    face.rotation.x = -Math.PI / 2;
    face.scale.setScalar(1.35);
    face.position.y = 0.1;
    face.renderOrder = 4;
    holder.add(face);
    holder.userData.promo = g.promo;
    // The pointer test hits the stone, which is a solid box — far more forgiving than a
    // transparent glyph plane.
    stone.userData.promo = g.promo;
    promoGroup.add(holder);
    return { holder, stone, face, faceMat, i };
  });

  let promoActive = false;
  let promoBorn = 0;

  // --- state driven by update() ------------------------------------------------------
  let checkSq: Mark | null = null;
  let overKind: 'mate' | 'draw' | null = null;
  let overBorn = 0;

  const fwd = new THREE.Vector3();

  return {
    group,

    setSelection(sq) {
      selection.visible = !!sq;
      if (sq) place(selection, sq);
    },

    setDestinations(quiet, captures) {
      let i = 0;
      for (const sq of quiet) {
        if (i >= dests.length) break;
        const m = dests[i++];
        m.material = mats.move;
        m.scale.setScalar(SQUARE * 0.5);
        m.visible = true;
        place(m, sq);
      }
      for (const sq of captures) {
        if (i >= dests.length) break;
        const m = dests[i++];
        m.material = mats.capture;
        m.scale.setScalar(SQUARE * 0.92);
        m.visible = true;
        place(m, sq, Y + 0.004);
      }
      for (; i < dests.length; i++) dests[i].visible = false;
    },

    refuse(sq, time) {
      // Reuse the oldest slot so a fast clicker never runs out.
      let slot = refusals[0];
      for (const r of refusals) if (r.born < slot.born) slot = r;
      slot.born = time;
      slot.mesh.visible = true;
      place(slot.mesh, sq, Y + 0.008);
    },

    setCheck(sq) {
      checkSq = sq;
      check.visible = !!sq;
      if (sq) place(check, sq, Y + 0.002);
    },

    setGameOver(kind, king, time) {
      if (kind === overKind) return;
      overKind = kind;
      overBorn = time;
      mate.visible = !!(kind && king);
      dim.visible = !!kind;
      if (kind && king) {
        place(mate, king, Y + 0.006);
        mate.material = kind === 'mate' ? mats.mate : mats.check;
      }
      if (!kind) dimMat.opacity = 0;
    },

    showPromotion(sq, side) {
      const { x, z } = squareCentre(sq.file, sq.rank);
      // Lay the four tablets out along the rank starting over the promotion square and
      // running INWARD, so they are always above the board however near the edge it is.
      // 5.2 m clears the tallest crown (a king is 4.55 m) with room to read under them.
      const dir = sq.file > 3.5 ? -1 : 1;
      const set = side === 'white' ? runes.white : runes.black;
      tablets.forEach((t, i) => {
        t.holder.position.set(x + dir * i * SQUARE * 0.95, 5.2, z);
        t.faceMat.map = set[i];
        t.faceMat.needsUpdate = true;
      });
      promoGroup.visible = true;
      promoActive = true;
      promoBorn = world.time;
      return tablets.map((t) => ({ promo: t.holder.userData.promo as 'q' | 'r' | 'b' | 'n', object: t.stone }));
    },

    hidePromotion() {
      promoGroup.visible = false;
      promoActive = false;
    },

    pickables() {
      return promoActive ? tablets.map((t) => t.stone) : [];
    },

    update(time) {
      // Everything breathes on the same slow fire so the markers feel lit rather than
      // drawn. Two beats: a 1.1 Hz flicker and a 0.37 Hz swell.
      const breath = 0.72 + 0.28 * Math.sin(time * 2.3) * Math.sin(time * 0.9 + 1.1);
      mats.select.opacity = 0.55 + 0.45 * breath;
      selection.rotation.z = time * 0.22;
      mats.move.opacity = 0.34 + 0.22 * breath;
      mats.capture.opacity = 0.5 + 0.4 * breath;

      if (checkSq) {
        const hot = 0.45 + 0.55 * Math.abs(Math.sin(time * 3.1));
        mats.check.opacity = hot;
        check.scale.setScalar(SQUARE * (0.98 + 0.06 * hot));
        check.rotation.z = -time * 0.5;
      }

      for (const r of refusals) {
        if (!r.mesh.visible) continue;
        const age = time - r.born;
        if (age < 0 || age > 0.45) { r.mesh.visible = false; continue; }
        const k = 1 - age / 0.45;
        // Own material per refusal would be tidier; instead the shared material is set
        // from whichever refusal is youngest, which is the one the eye is on anyway.
        mats.refuse.opacity = 0.85 * k * k;
        r.mesh.scale.setScalar(SQUARE * (0.6 + 0.45 * (1 - k)));
        r.mesh.rotation.z = age * 2.0;
      }

      if (overKind) {
        const age = Math.max(0, time - overBorn);
        const k = Math.min(1, age / 2.2);
        dimMat.opacity = 0.62 * k * k;
        mate.rotation.z = -time * 0.12;
        mate.scale.setScalar(SQUARE * (1.35 + 0.35 * Math.sin(time * 1.3) * 0.4 + 0.5 * k));
        mats.mate.opacity = 0.45 + 0.5 * Math.abs(Math.sin(time * 1.15));

        // Hold the dim quad in front of the camera. Oversized by 1.6 so one frame of
        // camera lag cannot uncover an edge.
        const cam = world.camera;
        const d = Math.max(0.4, cam.near * 4);
        const h = 2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5)) * 1.6;
        cam.getWorldDirection(fwd);
        dim.position.copy(cam.position).addScaledVector(fwd, d);
        dim.quaternion.copy(cam.quaternion);
        dim.scale.set(h * cam.aspect, h, 1);
      }

      if (promoActive) {
        const age = Math.max(0, time - promoBorn);
        const rise = Math.min(1, age / 0.5);
        tablets.forEach((t, i) => {
          t.holder.position.y = 5.2 - (1 - rise) * 1.4;
          t.holder.rotation.y = Math.sin(time * 0.8 + i) * 0.06;
          t.faceMat.opacity = 0.65 + 0.35 * Math.abs(Math.sin(time * 2.0 + i * 0.7));
        });
        slabMat.emissiveIntensity = 0.28 + 0.16 * breath;
      }
    },

    dispose() {
      group.removeFromParent();
      quad.dispose();
      slab.dispose();
      slabMat.dispose();
      dimMat.dispose();
      for (const m of Object.values(mats)) m.dispose();
      for (const t of Object.values(textures)) t.dispose();
      for (const t of [...runes.white, ...runes.black]) t.dispose();
      for (const t of tablets) t.faceMat.dispose();
    },
  };
}
