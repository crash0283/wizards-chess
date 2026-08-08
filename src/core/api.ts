/**
 * Shared interfaces between pieces. FROZEN CORE — do not edit in a piece build.
 * Import these types; never redeclare them locally, or the modules stop composing.
 */
import type * as THREE from 'three';
import type { PieceType, Side } from './constants';
import type { World } from './world';

export interface Disposable {
  dispose(): void;
}

export interface Chamber extends Disposable {
  group: THREE.Object3D;
  /** Surfaces the lighting piece may use as shadow receivers / bounce probes. */
  surfaces: THREE.Object3D[];
}

export interface Board extends Disposable {
  group: THREE.Object3D;
  squareMesh(file: number, rank: number): THREE.Object3D | null;
  /** Called when rubble lands, so the board can accumulate dust and scoring. */
  markImpact(x: number, z: number, radius: number, strength: number): void;
}

export interface Lighting extends Disposable {
  group: THREE.Object3D;
  /** Renders the frame — post chain included. Main loop calls this, not renderer.render. */
  render(): void;
  /** Resize the post chain. */
  setSize(w: number, h: number): void;
  /** A brief bright event (an impact). Decays over `decay` seconds. */
  flare(pos: THREE.Vector3, intensity: number, decay: number): void;
}

export interface PieceInstance {
  id: string;
  type: PieceType;
  side: Side;
  /** Origin at base centre, +Y up, facing +Z for white / -Z for black. */
  group: THREE.Object3D;
  height: number;
  destroyed: boolean;
  setSquare(file: number, rank: number): void;
  /** Animated traverse. Resolves when the piece has come to rest. */
  walkTo(file: number, rank: number, seconds: number): Promise<void>;
  /** Full attack animation. Resolves at the instant of weapon contact. */
  strike(target: PieceInstance): Promise<void>;
  /** Checkmated king only: release the blade, let it fall. */
  surrender?(): Promise<void>;
  update(t: number, dt: number): void;
}

export interface PieceFactory extends Disposable {
  make(type: PieceType, side: Side, id: string): PieceInstance;
  /** Every live instance, for the main loop. */
  all(): PieceInstance[];
  /** Take a man off the board permanently: out of `all()`, out of the scene. */
  retire(inst: PieceInstance): void;
}

export interface Destruction extends Disposable {
  group: THREE.Object3D;
  /** Break `target` apart. `impact` is the world-space blow direction and magnitude. */
  shatter(target: PieceInstance, impact: THREE.Vector3, force: number): void;
  /** True once every fragment has come to rest. */
  settled(): boolean;
}

export interface CameraRig {
  /** Aim the camera per a frozen shot definition at scene time t. */
  applyShot(shotId: string, t: number): void;
  /** "x,y,z,tx,ty,tz,fov" free override. */
  free(spec: string): void;
  /** Add impulse to the handheld rig (an impact happened). */
  shake(amount: number): void;
  /**
   * PLAY ONLY: tighten and recentre the frame on a world point for one capture, then
   * release. A frustum move, not a camera move — see the note in camera/index.ts. Ignored
   * for the six film shots, whose framings are frozen.
   */
  closeOn(x: number, z: number, fightSeconds: number): void;
  /**
   * PLAY ONLY: swing the view by a relative amount in degrees, clamped to a measured
   * envelope. Ignored for the six film shots, whose framings are frozen.
   */
  orbit(dAzDeg: number, dDeclDeg: number): void;
  /** PLAY ONLY: return the view to its default bearing. */
  recentre(): void;
  update(t: number, dt: number): void;
}

export interface GameDeps {
  board: Board;
  pieces: PieceFactory;
  destruction: Destruction;
  lighting: Lighting;
  camera: CameraRig;
}

export interface GameState {
  fen: string;
  turn: Side;
  inCheck: boolean;
  result: 'playing' | 'checkmate-white' | 'checkmate-black' | 'stalemate' | 'draw';
  lastMove: string | null;
  moveNumber: number;
  thinking: boolean;
}

export interface Game {
  start(): void;
  update(t: number, dt: number): void;
  state(): GameState;
  /** Force a position — used by capture shots that need a specific board. */
  setPosition(fen: string): void;
  /**
   * Put the scene into the state a given shot needs before t=0.
   * `king-surrender` needs the final mated position and a board strewn with the
   * wreckage of every capture; `piece-mid-strike` needs a capture landing at t=0.62.
   * Called once by main.ts after start().
   */
  stage(shotId: string): void;
}

export type Factory<T> = (world: World, deps?: any) => T;
