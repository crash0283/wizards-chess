/**
 * Capture bridge. FROZEN CORE — do not edit in a piece build.
 *
 * The critic harness drives the app entirely through the URL and this bridge:
 *
 *   ?shot=<id>&t=<seconds>&seed=<int>&w=<px>&h=<px>&quality=high&hud=0
 *
 * In capture mode the app steps a FIXED timestep from 0 to t, renders one frame, and
 * sets window.__CAPTURE_READY__. Nothing may depend on wall-clock time, so the same
 * URL always yields the same pixels — that is what makes a critic's A/B meaningful.
 */
import { RENDER } from './constants';

export interface CaptureRequest {
  shot: string;
  /** Scene time to render at, seconds. */
  t: number;
  seed: number;
  width: number;
  height: number;
  quality: 'low' | 'high';
  capturing: boolean;
  showHud: boolean;
  /** Fixed timestep used to march to `t`. Small enough for stable physics. */
  step: number;
  /** Optional FEN to force a board position (used by chess + surrender shots). */
  fen?: string;
  /** Optional free-camera override, "x,y,z,tx,ty,tz,fovDeg". */
  cam?: string;
}

export function readCaptureRequest(): CaptureRequest {
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number) => {
    const v = q.get(k);
    if (v === null) return d;
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const shot = q.get('shot') ?? '';
  const capturing = q.has('shot') && q.has('t');
  return {
    shot,
    t: num('t', 0),
    seed: num('seed', 20250811),
    width: num('w', RENDER.width),
    height: num('h', RENDER.height),
    quality: (q.get('quality') as 'low' | 'high') ?? (capturing ? 'high' : 'high'),
    capturing,
    showHud: q.get('hud') !== '0' && !capturing,
    step: num('step', 1 / 60),
    fen: q.get('fen') ?? undefined,
    cam: q.get('cam') ?? undefined,
  };
}

declare global {
  interface Window {
    __CAPTURE_READY__?: boolean;
    __CAPTURE_ERROR__?: string;
    __WC__?: unknown;
  }
}

export function signalReady() {
  window.__CAPTURE_READY__ = true;
}

export function signalError(err: unknown) {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  window.__CAPTURE_ERROR__ = msg;
  window.__CAPTURE_READY__ = true;
  console.error(err);
}
