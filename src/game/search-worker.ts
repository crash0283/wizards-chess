/**
 * The engine's brain, on its own thread.
 *
 * `Engine.search()` is a synchronous alpha-beta over a 120,000-node budget. That is a
 * tenth of a second of pure JavaScript on a fast machine and well over a second under a
 * software rasteriser sharing the same core — and on the main thread it is a hole in the
 * frame loop the size of the whole search. The renderer tab was dying during interactive
 * play for exactly that reason: rAF stops, the page stops answering, and the harness sees
 * "Execution context was destroyed".
 *
 * So the search runs here instead. The protocol is deliberately tiny — a FEN in, a UCI
 * string out — because structured cloning a Board or a packed move list across the wire
 * costs more than re-deriving it, and because the main thread must re-resolve the reply
 * against its own live engine anyway before trusting it.
 *
 * ── why this thread now says hello and acknowledges ──────────────────────────────────
 *
 * The reply is not the only thing the main thread needs to hear. It also needs to know
 * that this thread EXISTS and that it has been given a scheduling slot, because the two
 * failures look identical from over there — a search still running and a worker that the
 * browser never started both look like silence.
 *
 * Telling them apart used to be done with a wall-clock deadline, and a wall clock on the
 * main thread measures mostly the main thread's own blocked frames: at nine seconds a
 * frame, a worker that answered in 400 ms was declared dead before its first message could
 * be delivered, because delivery can only happen when the main thread yields. So this
 * module now speaks first and speaks early:
 *
 *   hello   posted the instant this module finishes evaluating. Proves the worker was
 *           constructed, fetched, and run at all.
 *   ack     posted the instant a request arrives, BEFORE the search starts. Proves this
 *           thread got a slot and owns the job. Everything after it is bounded work.
 *   result  the answer.
 *
 * There is deliberately no heartbeat DURING the search: `search()` is one synchronous
 * call, so a timer here could not fire mid-search anyway. It does not need one — the
 * search is bounded by an explicit node budget, not by the clock, so once `ack` has gone
 * out the remaining work is finite and small. `ack` is the heartbeat that matters.
 *
 * This module is never loaded under capture: the scripted path replays a frozen game and
 * never searches at all, so determinism does not depend on anything in here.
 */
import { search } from '../chess';

export interface SearchRequest {
  id: number;
  fen: string;
  maxNodes: number;
  maxDepth?: number;
}

export interface SearchReply {
  /** Absent on replies from older builds; treated as 'result'. */
  kind?: 'result';
  id: number;
  /** UCI of the best move, or null if the position is terminal / the search failed. */
  uci: string | null;
  san: string | null;
  score: number;
  depth: number;
  nodes: number;
  error?: string;
}

/** Liveness only. Carries no answer — its whole content is "this thread is running". */
export interface WorkerSignal {
  kind: 'hello' | 'ack';
  /** The request being acknowledged. Absent on 'hello'. */
  id?: number;
}

export type WorkerMessage = SearchReply | WorkerSignal;

// `self` is a DedicatedWorkerGlobalScope, which the DOM lib does not describe. Casting
// once here is cheaper than pulling in a conflicting "webworker" lib for two calls.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(data: unknown): void;
};

ctx.onmessage = (e: MessageEvent) => {
  const req = e.data as SearchRequest;
  if (!req || typeof req.fen !== 'string') return;
  // Before any work at all: this thread has the job. The main thread's watchdog is
  // waiting on exactly this, and it must not be behind a search.
  ctx.postMessage({ kind: 'ack', id: req.id } satisfies WorkerSignal);
  let reply: SearchReply;
  try {
    const r = search(req.fen, { maxNodes: req.maxNodes, maxDepth: req.maxDepth });
    reply = {
      kind: 'result',
      id: req.id,
      uci: r ? r.uci ?? null : null,
      san: r ? r.san ?? null : null,
      score: r ? r.score : 0,
      depth: r ? r.depth : 0,
      nodes: r ? r.nodes : 0,
    };
  } catch (err) {
    reply = {
      kind: 'result', id: req.id, uci: null, san: null, score: 0, depth: 0, nodes: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  ctx.postMessage(reply);
};

// Evaluated: the module fetched, the chess engine imported, the handler installed.
ctx.postMessage({ kind: 'hello' } satisfies WorkerSignal);
