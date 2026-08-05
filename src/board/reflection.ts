/**
 * PIECE: board — planar reflection of the room in the polished marble.
 *
 * In the reference frames the board is genuinely reflective: the ranks, the plinths, the
 * children and every flame sit in it, softly and broadly. An environment map cannot do
 * that — it has no idea where the pieces are — so this renders the scene once from the
 * mirrored camera into a small target, which the marble shader then samples projectively
 * and blurs through the mip chain according to its local roughness.
 *
 * Cost: exactly one extra scene render per rendered frame, at roughly a fifth of the
 * pixels. Under capture the app renders two frames in total, so this is cheap; the
 * marching loop that precedes them never renders at all.
 *
 * The mirrored camera is built the way three's Reflector does it — a real camera at the
 * mirrored eye point with a mirrored up vector, plus an oblique near plane on the mirror
 * so nothing below the floor leaks into the reflection. Nothing here reads a clock.
 */
import * as THREE from 'three';
import type { World } from '../core/world';

export interface PlanarReflection {
  texture: THREE.Texture;
  /** Projection matrix from world space to reflection-texture space. */
  textureMatrix: THREE.Matrix4;
  /** Highest usable mip, for roughness-driven blur. */
  maxLod: number;
  /** Object whose onBeforeRender drives the reflection pass. Add it to the scene. */
  driver: THREE.Object3D;
  /** Meshes hidden while the reflection renders (the board itself). */
  exclude: THREE.Object3D[];
  dispose(): void;
}

const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();
const _normal = new THREE.Vector3(0, 1, 0);
const _point = new THREE.Vector3();
const _view = new THREE.Vector3();
const _target = new THREE.Vector3();
const _look = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _rot = new THREE.Matrix4();

export function createPlanarReflection(world: World, planeY: number): PlanarReflection {
  const high = world.quality === 'high';
  const width = high ? 1536 : 512;
  const height = Math.max(1, Math.round(width / 2.388));

  const rt = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  rt.texture.name = 'board-reflection';
  rt.texture.colorSpace = THREE.NoColorSpace;

  const virtualCamera = new THREE.PerspectiveCamera();
  const textureMatrix = new THREE.Matrix4();
  const exclude: THREE.Object3D[] = [];
  let rendering = false;

  // A zero-area, colour-less mesh that draws before everything else. Object3D.onBeforeRender
  // only fires for renderable objects, and this is the one hook that runs after the camera
  // is final for the frame and before any board pixel is shaded.
  const driverGeo = new THREE.BufferGeometry();
  driverGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  const driverMat = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
  });
  const driver = new THREE.Mesh(driverGeo, driverMat);
  driver.name = 'board-reflection-driver';
  driver.frustumCulled = false;
  driver.renderOrder = -100000;

  driver.onBeforeRender = (renderer, scene, camera) => {
    if (rendering) return;
    if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return;

    _point.set(0, planeY, 0);
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    _view.subVectors(_point, _camPos);
    // Camera under the floor: nothing to reflect.
    if (_view.dot(_normal) > 0) return;

    _view.reflect(_normal).negate().add(_point);

    _rot.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_camPos);
    _target.subVectors(_point, _look).reflect(_normal).negate().add(_point);

    virtualCamera.position.copy(_view);
    virtualCamera.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_normal);
    virtualCamera.lookAt(_target);
    virtualCamera.near = (camera as THREE.PerspectiveCamera).near;
    virtualCamera.far = (camera as THREE.PerspectiveCamera).far;
    virtualCamera.updateMatrixWorld();
    virtualCamera.projectionMatrix.copy((camera as THREE.PerspectiveCamera).projectionMatrix);

    // World -> [0,1]^2 texture space, applied to the world position in the vertex shader.
    textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0,
    );
    textureMatrix.multiply(virtualCamera.projectionMatrix);
    textureMatrix.multiply(virtualCamera.matrixWorldInverse);

    // Oblique near plane, so the underside of the floor never appears in the mirror.
    _plane.setFromNormalAndCoplanarPoint(_normal, _point);
    _plane.applyMatrix4(virtualCamera.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const p = virtualCamera.projectionMatrix.elements;
    _q.x = (Math.sign(_clip.x) + p[8]) / p[0];
    _q.y = (Math.sign(_clip.y) + p[9]) / p[5];
    _q.z = -1.0;
    _q.w = (1.0 + p[10]) / p[14];
    _clip.multiplyScalar(2.0 / _clip.dot(_q));
    p[2] = _clip.x;
    p[6] = _clip.y;
    p[10] = _clip.z + 1.0 - 0.004;
    p[14] = _clip.w;

    const prevTarget = renderer.getRenderTarget();
    const prevActiveCube = renderer.getActiveCubeFace();
    const prevActiveMip = renderer.getActiveMipmapLevel();
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const prevAutoClear = renderer.autoClear;
    const prevXr = renderer.xr.enabled;

    const hidden: THREE.Object3D[] = [];
    for (const o of exclude) {
      if (o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    }
    driver.visible = false;

    rendering = true;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = true;
    try {
      renderer.setRenderTarget(rt);
      renderer.state.buffers.depth.setMask(true);
      renderer.clear(true, true, true);
      renderer.render(scene, virtualCamera);
    } finally {
      rendering = false;
      renderer.xr.enabled = prevXr;
      renderer.shadowMap.autoUpdate = prevShadowAuto;
      renderer.autoClear = prevAutoClear;
      renderer.setRenderTarget(prevTarget, prevActiveCube, prevActiveMip);
      for (const o of hidden) o.visible = true;
      driver.visible = true;
    }
  };

  return {
    texture: rt.texture,
    textureMatrix,
    // Cap the blur: the reference reflections are broad but still legible as pieces,
    // and the top of a mip chain is a flat colour, not a reflection.
    maxLod: 4.0,
    driver,
    exclude,
    dispose() {
      rt.dispose();
      driverGeo.dispose();
      driverMat.dispose();
    },
  };
}
