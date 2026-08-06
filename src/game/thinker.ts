/**
 * "The engine is thinking" — asynchronously, so the frame loop keeps breathing.
 *
 * Two modes, chosen at construction and demoted at runtime if the first one fails:
 *
 *   worker  the real answer. `src/game/search-worker.ts` is a module worker; Vite
 *           bundles it through the `new Worker(new URL(...), { type: 'module' })` form.
 *           The main thread does nothing at all while it runs.
 *   main    the fallback for environments with no Worker, or where constructing one
 *           throws. The search is not resumable, so instead of one 120k-node call the
 *           fallback runs a short iterative-deepening ladder — one bounded slice per
 *           frame, keeping the best move found so far. Each slice is small enough
 *           (SLICE_NODES) that a frame is never held for long, and the ladder can be
 *           abandoned at any depth and still hand back a legal, sensible move.
 *
 * Either way `busy()` stays true across many frames, which is the whole point: the HUD's
 * "thinking…" is observable because there really is a period of time during which the
 * engine is thinking and the scene is still rendering.
 *
 * Never constructed under capture — the scripted path never searches.
 */
import { search } from '../chess';
import type { SearchReply, SearchRequest } from './search-worker';

export interface Thought {
  uci: string | null;
  san: string | null;
  score: number;
  depth: number;
  nodes: number;
  /** Which path produced it — surfaced for the play-test probe and for debugging. */
  via: 'worker' | 'main';
  /** Real seconds spent. */
  seconds: number;
}

export interface Thinker {
  readonly mode: 'worker' | 'main';
  /** True from `start()` until the thought is ready to be taken. */
  busy(): boolean;
  start(fen: string, maxNodes: number, realTime: number): void;
  /** Once per frame. Advances a fallback slice and enforces the worker watchdog. */
  tick(realTime: number): void;
  /** Hand back the finished thought exactly once. */
  take(): Thought | null;
  dispose(): void;
}

/** Nodes per main-thread slice. Small enough that one frame is never held for long. */
const SLICE_NODES = 6_000;
/** Deepest ladder rung the fallback will attempt. */
const MAX_SLICE_DEPTH = 7;
/** Real seconds to wait for a worker before giving up on it and searching inline. */
const WORKER_WATCHDOG = 8;

interface Job {
  fen: string;
  maxNodes: number;
  startedAt: number;
  /** Fallback state. */
  depth: number;
  spent: number;
  best: Thought | null;
}

export function createThinker(): Thinker {
  let worker: Worker | null = null;
  let mode: 'worker' | 'main' = 'main';
  let nextId = 1;
  let job: Job | null = null;
  let done: Thought | null = null;

  try {
    if (typeof Worker !== 'undefined') {
      worker = new Worker(new URL('./search-worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent) => {
        const r = e.data as SearchReply;
        if (!job || !r || r.id !== nextId - 1) return;
        finish({
          uci: r.uci, san: r.san, score: r.score, depth: r.depth, nodes: r.nodes,
          via: 'worker', seconds: 0,
        });
      };
      worker.onerror = () => demote();
      worker.onmessageerror = () => demote();
      mode = 'worker';
    }
  } catch {
    worker = null;
    mode = 'main';
  }

  function finish(t: Thought) {
    if (job) t.seconds = Math.max(0, lastTick - job.startedAt);
    done = t;
    job = null;
  }

  /** The worker let us down. Kill it and finish the current job inline, in slices. */
  function demote() {
    if (worker) {
      try { worker.terminate(); } catch { /* already gone */ }
      worker = null;
    }
    mode = 'main';
    // The in-flight job simply continues on the fallback ladder from depth 0.
  }

  let lastTick = 0;

  /** One bounded slice of the fallback ladder. Returns true when the ladder is done. */
  function slice(j: Job): boolean {
    j.depth += 1;
    const budget = Math.min(SLICE_NODES, Math.max(2048, j.maxNodes - j.spent));
    const r = search(j.fen, { maxNodes: budget, maxDepth: j.depth });
    j.spent += r ? r.nodes : budget;
    if (r) {
      j.best = {
        uci: r.uci ?? null, san: r.san ?? null, score: r.score,
        depth: r.depth, nodes: j.spent, via: 'main', seconds: 0,
      };
      // A forced mate is the end of the conversation; deeper rungs cannot improve on it.
      if (r.mate !== null) return true;
    } else {
      // No legal move — the position is terminal.
      return true;
    }
    return j.depth >= MAX_SLICE_DEPTH || j.spent >= j.maxNodes;
  }

  return {
    get mode() { return mode; },

    busy() { return job !== null; },

    start(fen, maxNodes, realTime) {
      done = null;
      lastTick = realTime;
      job = { fen, maxNodes, startedAt: realTime, depth: 0, spent: 0, best: null };
      if (worker) {
        const req: SearchRequest = { id: nextId++, fen, maxNodes };
        try {
          worker.postMessage(req);
          return;
        } catch {
          demote();
        }
      }
      // Fallback: nothing to do now; `tick` advances one slice per frame.
    },

    tick(realTime) {
      lastTick = realTime;
      const j = job;
      if (!j) return;
      if (worker) {
        if (realTime - j.startedAt > WORKER_WATCHDOG) demote();
        return;
      }
      if (slice(j)) {
        finish(j.best ?? {
          uci: null, san: null, score: 0, depth: j.depth, nodes: j.spent,
          via: 'main', seconds: 0,
        });
      }
    },

    take() {
      const t = done;
      done = null;
      return t;
    },

    dispose() {
      if (worker) { try { worker.terminate(); } catch { /* already gone */ } }
      worker = null;
      job = null;
      done = null;
    },
  };
}
