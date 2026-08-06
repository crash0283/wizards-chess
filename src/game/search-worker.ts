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
  id: number;
  /** UCI of the best move, or null if the position is terminal / the search failed. */
  uci: string | null;
  san: string | null;
  score: number;
  depth: number;
  nodes: number;
  error?: string;
}

// `self` is a DedicatedWorkerGlobalScope, which the DOM lib does not describe. Casting
// once here is cheaper than pulling in a conflicting "webworker" lib for two calls.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(data: unknown): void;
};

ctx.onmessage = (e: MessageEvent) => {
  const req = e.data as SearchRequest;
  if (!req || typeof req.fen !== 'string') return;
  let reply: SearchReply;
  try {
    const r = search(req.fen, { maxNodes: req.maxNodes, maxDepth: req.maxDepth });
    reply = {
      id: req.id,
      uci: r ? r.uci ?? null : null,
      san: r ? r.san ?? null : null,
      score: r ? r.score : 0,
      depth: r ? r.depth : 0,
      nodes: r ? r.nodes : 0,
    };
  } catch (err) {
    reply = {
      id: req.id, uci: null, san: null, score: 0, depth: 0, nodes: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  ctx.postMessage(reply);
};
