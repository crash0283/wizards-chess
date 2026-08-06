/**
 * "The engine is thinking" — asynchronously, and independently of the frame loop.
 *
 * Two things matter here and they are easy to conflate. One is that the search must not
 * block rendering. The other is that the ANSWER must not have to wait for a frame: on a
 * software rasteriser a frame can take tens of seconds, so a reply that is only ever
 * applied inside `update()` is a reply the player waits a frame for however fast the
 * search was. So the result is delivered by callback, from the worker's message event or
 * from a timer — both of which run between frames, not on them.
 *
 * Two modes, chosen at construction and demoted at runtime if the first one fails:
 *
 *   worker  the real answer. `src/game/search-worker.ts` is a module worker; Vite bundles
 *           it through the `new Worker(new URL(...), { type: 'module' })` form. The main
 *           thread does nothing at all while it runs.
 *   main    the fallback for environments with no Worker, or where constructing one
 *           throws. The search is not resumable, so instead of one 120k-node call the
 *           fallback runs a short iterative-deepening ladder — one bounded slice per
 *           macrotask, keeping the best move found so far. Each slice is small enough
 *           (SLICE_NODES) that the loop is never held for long, and the ladder can be
 *           abandoned at any rung and still hand back a legal, sensible move.
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
  /** Which path produced it. */
  via: 'worker' | 'main';
}

export interface Thinker {
  readonly mode: 'worker' | 'main';
  /** True from `start()` until the reply callback has fired. */
  busy(): boolean;
  /** Begin a search. `onReady` fires exactly once, off the frame loop. */
  start(fen: string, maxNodes: number, realTime: number, onReady: (t: Thought) => void): void;
  /** Once per frame, only to enforce the worker watchdog. */
  tick(realTime: number): void;
  dispose(): void;
}

/** Nodes per fallback slice. Small enough that one macrotask is never held for long. */
const SLICE_NODES = 6_000;
/** Deepest ladder rung the fallback will attempt. */
const MAX_SLICE_DEPTH = 7;
/** Real seconds to wait for a worker before giving up on it and searching inline. */
const WORKER_WATCHDOG = 8;

interface Job {
  id: number;
  fen: string;
  maxNodes: number;
  startedAt: number;
  onReady: (t: Thought) => void;
  /** Fallback ladder state. */
  depth: number;
  spent: number;
  best: Thought | null;
}

export function createThinker(): Thinker {
  let worker: Worker | null = null;
  let mode: 'worker' | 'main' = 'main';
  let nextId = 1;
  let job: Job | null = null;
  let sliceTimer: ReturnType<typeof setTimeout> | null = null;

  function finish(t: Thought) {
    const j = job;
    job = null;
    if (sliceTimer !== null) { clearTimeout(sliceTimer); sliceTimer = null; }
    j?.onReady(t);
  }

  /** The worker let us down. Kill it and finish the current job inline, in slices. */
  function demote() {
    if (worker) {
      try { worker.terminate(); } catch { /* already gone */ }
      worker = null;
    }
    mode = 'main';
    if (job && sliceTimer === null) sliceTimer = setTimeout(step, 0);
  }

  try {
    if (typeof Worker !== 'undefined') {
      worker = new Worker(new URL('./search-worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent) => {
        const r = e.data as SearchReply;
        if (!job || !r || r.id !== job.id) return;
        finish({
          uci: r.uci, san: r.san, score: r.score, depth: r.depth, nodes: r.nodes, via: 'worker',
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

  /** One bounded rung of the fallback ladder, then reschedule or deliver. */
  function step() {
    sliceTimer = null;
    const j = job;
    if (!j) return;
    j.depth += 1;
    const budget = Math.min(SLICE_NODES, Math.max(2048, j.maxNodes - j.spent));
    let done = false;
    try {
      const r = search(j.fen, { maxNodes: budget, maxDepth: j.depth });
      j.spent += r ? r.nodes : budget;
      if (!r) {
        done = true;                       // terminal position, nothing to play
      } else {
        j.best = {
          uci: r.uci ?? null, san: r.san ?? null, score: r.score,
          depth: r.depth, nodes: j.spent, via: 'main',
        };
        // A forced mate ends the conversation; deeper rungs cannot improve on it.
        if (r.mate !== null) done = true;
      }
    } catch {
      done = true;
    }
    if (!done && j.depth < MAX_SLICE_DEPTH && j.spent < j.maxNodes) {
      sliceTimer = setTimeout(step, 0);
      return;
    }
    finish(j.best ?? { uci: null, san: null, score: 0, depth: j.depth, nodes: j.spent, via: 'main' });
  }

  return {
    get mode() { return mode; },

    busy() { return job !== null; },

    start(fen, maxNodes, realTime, onReady) {
      if (sliceTimer !== null) { clearTimeout(sliceTimer); sliceTimer = null; }
      job = {
        id: nextId++, fen, maxNodes, startedAt: realTime, onReady,
        depth: 0, spent: 0, best: null,
      };
      if (worker) {
        try {
          const req: SearchRequest = { id: job.id, fen, maxNodes };
          worker.postMessage(req);
          return;
        } catch {
          demote();
          return;
        }
      }
      sliceTimer = setTimeout(step, 0);
    },

    tick(realTime) {
      if (job && worker && realTime - job.startedAt > WORKER_WATCHDOG) demote();
    },

    dispose() {
      if (sliceTimer !== null) { clearTimeout(sliceTimer); sliceTimer = null; }
      if (worker) { try { worker.terminate(); } catch { /* already gone */ } }
      worker = null;
      job = null;
    },
  };
}
