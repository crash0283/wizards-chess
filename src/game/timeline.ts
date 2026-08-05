/**
 * The fight, precomputed as a schedule.
 *
 * Determinism is the whole reason this file exists. The capture harness marches a fixed
 * timestep from 0 to t and expects identical pixels every run, so nothing in the game may
 * depend on when a promise happened to resolve or how many frames elapsed. Instead the
 * entire game is turned into a list of timestamped events up front, and `update(t)` just
 * fires everything whose time has passed. Replaying to the same t always fires the same
 * events in the same order.
 */
import type { DemoGame, DemoMove } from '../chess';

/** Seconds a piece takes to grind from one square to the next, per square of distance. */
export const WALK_PER_SQUARE = 0.42;
export const WALK_MIN = 0.85;

/** Time from the start of an attack animation to the instant of weapon contact. */
export const STRIKE_CONTACT = 0.62;

/** Time after contact before the victor moves onto the square. */
export const STRIKE_RECOVER = 0.75;

/** Dead air between one move finishing and the next beginning. */
export const MOVE_GAP = 0.55;

/** How long the mated king takes to release its blade once the game is over. */
export const SURRENDER_DELAY = 0.4;

export type EventKind =
  | 'walk-start'
  | 'strike-start'
  | 'contact'
  | 'arrive'
  | 'surrender'
  | 'game-over';

export interface TimedEvent {
  t: number;
  kind: EventKind;
  ply: number;
  move: DemoMove | null;
}

export interface Timeline {
  events: TimedEvent[];
  /** Total running time of the scripted game. */
  duration: number;
  /** Scene time at which the first capture makes contact. */
  firstContact: number | null;
}

function squareDistance(m: DemoMove): number {
  return Math.max(Math.abs(m.toFile - m.fromFile), Math.abs(m.toRank - m.fromRank));
}

/**
 * Turn a verified demo game into a schedule.
 *
 * `offset` shifts the whole game in time. The `piece-mid-strike` shot is captured at
 * t=0.62 and wants a blade landing exactly then, so the staging code offsets the timeline
 * to put a chosen capture's contact on that number rather than animating the whole opening
 * first.
 */
export function buildTimeline(game: DemoGame, offset = 0): Timeline {
  const events: TimedEvent[] = [];
  let cursor = offset;
  let firstContact: number | null = null;

  for (const m of game.moves) {
    const walk = Math.max(WALK_MIN, squareDistance(m) * WALK_PER_SQUARE);

    if (m.capture) {
      events.push({ t: cursor, kind: 'strike-start', ply: m.ply, move: m });
      const contact = cursor + STRIKE_CONTACT;
      events.push({ t: contact, kind: 'contact', ply: m.ply, move: m });
      if (firstContact === null) firstContact = contact;
      const arrive = contact + STRIKE_RECOVER + walk * 0.5;
      events.push({ t: arrive, kind: 'arrive', ply: m.ply, move: m });
      cursor = arrive + MOVE_GAP;
    } else {
      events.push({ t: cursor, kind: 'walk-start', ply: m.ply, move: m });
      const arrive = cursor + walk;
      events.push({ t: arrive, kind: 'arrive', ply: m.ply, move: m });
      cursor = arrive + MOVE_GAP;
    }

    if (m.mate) {
      events.push({ t: cursor, kind: 'game-over', ply: m.ply, move: m });
      events.push({ t: cursor + SURRENDER_DELAY, kind: 'surrender', ply: m.ply, move: m });
      cursor += SURRENDER_DELAY + 1.6;
      break;
    }
  }

  events.sort((a, b) => (a.t === b.t ? a.ply - b.ply : a.t - b.t));
  return { events, duration: cursor, firstContact };
}

/** Index of the last capture in the game — the one that leaves the freshest rubble. */
export function lastCaptureIndex(game: DemoGame): number {
  for (let i = game.moves.length - 1; i >= 0; i--) if (game.moves[i].capture) return i;
  return -1;
}
