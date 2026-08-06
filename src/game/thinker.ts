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
 * Two paths, and — this is the change — they are no longer exclusive:
 *
 *   worker  the real answer. `src/game/search-worker.ts` is a module worker; Vite bundles
 *           it through the `new Worker(new URL(...), { type: 'module' })` form. The main
 *           thread does nothing at all while it runs.
 *   inline  the backstop, for environments with no Worker, where constructing one throws,
 *           or where the worker has gone quiet. The search is not resumable, so instead
 *           of one 60k-node call it runs a short iterative-deepening ladder, keeping the
 *           best move found so far, and can be abandoned at any rung and still hand back
 *           a legal, sensible move.
 *
 * Never constructed under capture — the scripted path never searches.
 *
 * ── the watchdog, and why the old one killed a healthy worker ────────────────────────
 *
 * The previous watchdog stamped the job with `world.realTime` — the timestamp of the
 * frame that was IN PROGRESS when the click arrived — and compared it against the next
 * frame's timestamp, tripping at eight seconds. On the low tier that comparison is almost
 * entirely the main thread's own blocked frame: at nine seconds a frame the difference is
 * nine seconds before the worker has been given a single scheduling slot. Measured on the
 * software rasteriser with a nine-second frame, the worker was constructed, sent exactly
 * one job, and terminated in the same millisecond, having never received a message —
 * and `demote()` set `worker = null` with no path back, so every reply for the rest of the
 * session fell to the inline ladder and took 90-110 real seconds instead of one.
 *
 * Three things are different now.
 *
 * 1. THE CLOCK STARTS WHEN THE WORKER HAS ACTUALLY HAD A TURN, NOT WHEN THE JOB WAS
 *    POSTED. `tick()` is called once per frame, and a frame boundary is the only moment
 *    at which a message from the worker can be delivered. So the unit of "time the worker
 *    actually had" is frame boundaries, and the baseline is the FIRST boundary after the
 *    post — not a timestamp that may already be a whole frame stale.
 *
 * 2. IT WAITS FOR A MISSED HEARTBEAT, NOT A DEADLINE. The worker says `hello` when its
 *    module has evaluated and `ack` the instant it receives a job, both before any search
 *    work. Silence across several delivery opportunities is the signal — not elapsed wall
 *    time, which on this tier is a measure of the renderer, not of the worker.
 *
 * 3. GIVING UP IS PER-JOB AND REVERSIBLE. A watchdog trip no longer terminates anything.
 *    It starts the inline ladder ALONGSIDE the worker, and whichever answers first wins
 *    (`finish` nulls the job; the loser's reply no longer matches an id). Any message from
 *    the worker — even a late one for a job already answered inline — clears its strikes
 *    and it is used again for the next move. Only a hard `onerror`, or several consecutive
 *    jobs it never even acknowledged, retires it for good.
 */
import { search } from '../chess';
import type { SearchReply, SearchRequest, WorkerMessage } from './search-worker';

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

/** Nodes per fallback rung. Small enough that one rung is never held for long. */
const SLICE_NODES = 6_000;
/**
 * Nodes one MACROTASK of the fallback ladder may spend before yielding.
 *
 * The ladder used to yield after every rung, and seven rungs meant seven `setTimeout(0)`
 * re-arms — except a timer cannot fire while a frame is rendering, so on this tier each
 * one cost a whole frame, and those seven frames were most of the 90-110 second replies.
 * The whole 60k-node budget is ~230 ms of JavaScript, a tenth of one frame here, so rungs
 * now run back to back up to this budget and the ladder costs two macrotasks, not seven.
 * It is still a ladder: `best` is legal and playable after every rung, and it can be
 * abandoned at any of them.
 */
const BURST_NODES = 30_000;
/** Deepest ladder rung the fallback will attempt. */
const MAX_SLICE_DEPTH = 7;
/**
 * Frame boundaries the worker may stay silent for before the job is ALSO run inline.
 *
 * A boundary, not a second: this counts the chances the main thread has given the browser
 * to deliver a message from the worker. On a phone holding 30 fps that is 0.13 s; on the
 * software rasteriser at nine seconds a frame it is most of a minute — which is correct,
 * because a worker that has not been heard from across four separate yields of the main
 * thread is not merely slow.
 */
const WORKER_SILENT_FRAMES = 4;
/**
 * ...and this much real time as well, so a burst of cheap frames cannot condemn a worker
 * that is simply mid-search. Both conditions must hold.
 */
const WORKER_SILENT_SECONDS = 2.5;
/** Consecutive jobs the worker never acknowledged before it is retired for good. */
const MAX_STRIKES = 3;

interface Job {
  id: number;
  fen: string;
  maxNodes: number;
  /** Frame counter and real time at the FIRST tick after posting. -1 until then. */
  baseTick: number;
  baseReal: number;
  /** True once the worker has acknowledged this job. */
  acked: boolean;
  /** True once the inline ladder has been started for this job as well. */
  inline: boolean;
  onReady: (t: Thought) => void;
  /** Fallback ladder state. */
  depth: number;
  spent: number;
  best: Thought | null;
}

export function createThinker(): Thinker {
  let worker: Worker | null = null;
  let nextId = 1;
  let job: Job | null = null;
  let sliceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Frame boundaries seen, and the real time of the most recent one. */
  let ticks = 0;
  let lastRealTime = 0;
  /** The frame boundary and real time at which the worker last said anything at all. */
  let heardTick = -1;
  let heardReal = -1;
  /** Consecutive jobs the worker failed to acknowledge. Any message resets it. */
  let strikes = 0;

  function finish(t: Thought) {
    const j = job;
    if (!j) return;                        // the other path already answered this one
    job = null;
    if (sliceTimer !== null) { clearTimeout(sliceTimer); sliceTimer = null; }
    j.onReady(t);
  }

  /**
   * The worker said something — anything. That is the only proof of life that matters,
   * and it counts even when the message is a late answer to a job the ladder already
   * finished: it still means the thread exists, was scheduled, and is doing the work.
   */
  function heard() {
    heardTick = ticks;
    heardReal = lastRealTime;
    strikes = 0;
  }

  /** Run the current job on the main thread as well. Does NOT touch the worker. */
  function alsoRunInline() {
    const j = job;
    if (!j || j.inline) return;
    j.inline = true;
    if (sliceTimer === null) sliceTimer = setTimeout(step, 0);
  }

  /** The worker is genuinely broken (it threw, or it has struck out). Let it go. */
  function retireWorker() {
    if (worker) {
      try { worker.terminate(); } catch { /* already gone */ }
      worker = null;
    }
    alsoRunInline();
  }

  try {
    if (typeof Worker !== 'undefined') {
      worker = new Worker(new URL('./search-worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent) => {
        // Liveness first, and unconditionally — before any check that could discard the
        // message. A reply that arrives for a job the ladder already answered is still
        // proof the worker works, and the next move should go back to it.
        heard();
        const m = e.data as WorkerMessage;
        if (!m) return;
        if (m.kind === 'hello') return;
        if (m.kind === 'ack') {
          if (job && m.id === job.id) job.acked = true;
          return;
        }
        const r = m as SearchReply;
        if (!job || r.id !== job.id) return;
        finish({
          uci: r.uci, san: r.san, score: r.score, depth: r.depth, nodes: r.nodes, via: 'worker',
        });
      };
      worker.onerror = () => retireWorker();
      worker.onmessageerror = () => retireWorker();
    }
  } catch {
    worker = null;
  }

  /**
   * The fallback ladder: deepen until this macrotask's node budget is spent, then either
   * yield or deliver. Every rung leaves `best` legal and playable.
   */
  function step() {
    sliceTimer = null;
    const j = job;
    if (!j) return;
    const startSpent = j.spent;
    let done = false;
    for (;;) {
      j.depth += 1;
      const budget = Math.min(SLICE_NODES, Math.max(2048, j.maxNodes - j.spent));
      try {
        const r = search(j.fen, { maxNodes: budget, maxDepth: j.depth });
        j.spent += r ? r.nodes : budget;
        if (!r) {
          done = true;                     // terminal position, nothing to play
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
      if (done || j.depth >= MAX_SLICE_DEPTH || j.spent >= j.maxNodes) break;
      if (j.spent - startSpent >= BURST_NODES) {
        sliceTimer = setTimeout(step, 0);
        return;
      }
    }
    finish(j.best ?? { uci: null, san: null, score: 0, depth: j.depth, nodes: j.spent, via: 'main' });
  }

  return {
    // What the NEXT job will be handed to. A worker that has been bypassed for one job is
    // still the worker, so this stays truthful across a recoverable stumble.
    get mode(): 'worker' | 'main' { return worker ? 'worker' : 'main'; },

    busy() { return job !== null; },

    start(fen, maxNodes, _realTime, onReady) {
      if (sliceTimer !== null) { clearTimeout(sliceTimer); sliceTimer = null; }
      job = {
        id: nextId++, fen, maxNodes,
        baseTick: -1, baseReal: -1, acked: false, inline: false,
        onReady, depth: 0, spent: 0, best: null,
      };
      // `realTime` is deliberately unused as a watchdog baseline: the caller can only pass
      // the timestamp of the frame that was in progress when the click landed, which on
      // this tier is already up to a whole frame stale. That staleness IS the regression
      // this file was rewritten for. The baseline is taken at the first tick instead.
      if (worker) {
        try {
          const req: SearchRequest = { id: job.id, fen, maxNodes };
          worker.postMessage(req);
          return;
        } catch {
          retireWorker();
          return;
        }
      }
      sliceTimer = setTimeout(step, 0);
    },

    tick(realTime) {
      ticks++;
      lastRealTime = realTime;
      const j = job;
      if (!j || !worker || j.inline) return;

      // The first tick after the post is the first moment at which a message from the
      // worker COULD have been delivered. That, not the post, is when its clock starts.
      if (j.baseTick < 0) { j.baseTick = ticks; j.baseReal = realTime; return; }

      const silentFrames = ticks - Math.max(j.baseTick, heardTick);
      const silentSeconds = realTime - Math.max(j.baseReal, heardReal);
      if (silentFrames < WORKER_SILENT_FRAMES || silentSeconds < WORKER_SILENT_SECONDS) return;

      // Never acknowledged: the browser has not run this worker at all. That is the one
      // failure worth counting against it.
      if (!j.acked && ++strikes >= MAX_STRIKES) { retireWorker(); return; }
      // Either way the player gets an answer now, from whichever path lands first.
      alsoRunInline();
    },

    dispose() {
      if (sliceTimer !== null) { clearTimeout(sliceTimer); sliceTimer = null; }
      if (worker) { try { worker.terminate(); } catch { /* already gone */ } }
      worker = null;
      job = null;
    },
  };
}
