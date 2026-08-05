/**
 * PIECE: game — orchestration. Turn loop, piece movement, capture -> destruction,
 * engine reply, checkmate ending. Round 0 placeholder; owner rewrites src/game/.
 */
import * as THREE from 'three';
import type { Game, GameDeps, GameState } from '../core/api';
import type { World } from '../core/world';
import type { PieceType, Side } from '../core/constants';
import { START_FEN } from '../chess';

const BACK: PieceType[] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

export function createGame(world: World, deps: GameDeps): Game {
  const state: GameState = {
    fen: START_FEN,
    turn: 'white',
    inCheck: false,
    result: 'playing',
    lastMove: null,
    moveNumber: 1,
    thinking: false,
  };

  function place(side: Side) {
    const backRank = side === 'white' ? 0 : 7;
    const pawnRank = side === 'white' ? 1 : 6;
    for (let f = 0; f < 8; f++) {
      const bp = deps.pieces.make(BACK[f], side, `${side}-${BACK[f]}-${f}`);
      bp.setSquare(f, backRank);
      const pp = deps.pieces.make('pawn', side, `${side}-pawn-${f}`);
      pp.setSquare(f, pawnRank);
    }
  }

  return {
    start() {
      place('white');
      place('black');
    },
    update() {
      /* placeholder: turn loop lands here */
    },
    state: () => state,
    setPosition(fen) {
      state.fen = fen;
    },
  };
}

/** Kept so the placeholder imports resolve; real flow uses THREE for impact vectors. */
void THREE;
