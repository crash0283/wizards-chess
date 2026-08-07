/**
 * The game readout — what a person sitting in the chamber can actually tell about the game.
 *
 * Before this the whole HUD was one line of monospace text along the bottom of the screen:
 *
 *     white to move   move 7   CHECK
 *
 * which answers roughly a third of what a chess player needs and none of what THIS player
 * asked for. There was no way to see what had been taken, no material score, and the end of
 * the game arrived as the word "CHECKMATE-BLACK" — a variable name, printed at a human.
 * Worse, on a board where every captured piece is blown into rubble that stays on the
 * marble, the wreckage is not a record: you cannot count a knight out of a pile of chips.
 * The tray below is the only place the score of the fight exists.
 *
 * ── why this is DOM and not carved into the scene ────────────────────────────────────
 *
 * `affordances.ts` makes the opposite call and is right to: selection rings, legal-move
 * sigils and the check ring all belong to SQUARES, so they have to live on the board or
 * they lie about where they point. This has no square. It is a scoreboard, it is dense
 * with small type and small silhouettes, and text rendered as a scene texture at this size
 * is mush — it would have to be a canvas texture on a billboard, resampled through the
 * interactive resolution ladder (which renders at 75% of the display and stretches), then
 * through bloom and the grade. DOM text is rendered by the compositor at full device
 * resolution no matter what the render buffer is doing, which on the low rungs is the
 * difference between a legible readout and a smear.
 *
 * So it is DOM, and the whole job is then making DOM not look like DOM: chamfered stone
 * tablets, no rounded rectangles, no pure white, no saturated colour that is not firelight,
 * a stone-grain wash over every panel, and type that is letterspaced and small rather than
 * large and bold. It sits in the margins the board does not use — the play camera is
 * near-top-down at 30 m, so the board is a square in the middle of the frame and the
 * columns either side of it are chamber floor.
 *
 * ── it never eats a click ─────────────────────────────────────────────────────────────
 *
 * `pointer-events: none` on the root and on everything under it, with no exceptions. On a
 * narrow window these tablets overlap the board, and a HUD that swallows a click on a
 * square is a worse bug than a HUD that cannot be scrolled. The move list auto-scrolls
 * instead of being scrollable.
 *
 * ── and it does not exist under capture ───────────────────────────────────────────────
 *
 * `createReadout()` is called from game/index.ts only when `world.capturing` is false, so
 * the film path never constructs it. The capture harness also passes `hud=0`, which is
 * belt and braces: this would be invisible there even if it were built.
 */
import type { PieceType, Side } from '../core/constants';
import type { GameState } from '../core/api';
import { BY_VALUE, glyph } from './glyphs';

export type Tally = Record<PieceType, number>;

export type DrawReason = 'stalemate' | 'fifty-move' | 'threefold' | 'insufficient-material';

export interface ReadoutSnapshot {
  turn: Side;
  thinking: boolean;
  inCheck: boolean;
  result: GameState['result'];
  winner: Side | null;
  drawReason: DrawReason | null;
  moveNumber: number;
  /** Conventional pawn units, from White's point of view. */
  edge: number;
  /** Centipawns from `Engine.materialBalance()`, White's point of view. */
  cp: number;
  /** What each side HAS TAKEN. `taken.white` holds black men. */
  taken: Record<Side, Tally>;
  /** Every move played, in SAN. */
  history: string[];
  /** Absolute ply index of `history[0]`, so a game set up mid-board still numbers right. */
  firstPly: number;
  /** Which side the human is playing, if either. */
  player: Side | null;
}

export interface Readout {
  render(s: ReadoutSnapshot): void;
  dispose(): void;
}

const SIDE_NAME: Record<Side, string> = { white: 'White', black: 'Black' };
const OTHER: Record<Side, Side> = { white: 'black', black: 'white' };

const DRAW_LINE: Record<DrawReason, string> = {
  // Sits under the headline "Stalemate", so it must not open by saying it again.
  'stalemate': 'Drawn — no legal move, and not in check.',
  'fifty-move': 'Fifty moves without a capture or a pawn.',
  'threefold': 'The same position, three times over.',
  'insufficient-material': 'Neither side has enough left to mate.',
};

/**
 * Stone grain. One tiny SVG turbulence tile, rasterised once by the compositor and tiled
 * over every tablet at 5% — enough that the panels read as cut rock rather than as flat
 * translucent rectangles, cheap enough to be free.
 */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E" +
  "%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E" +
  "%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E\")";

const CSS = `
#wc-readout, #wc-readout * { pointer-events: none; box-sizing: border-box; }
#wc-readout {
  position: fixed; inset: 0; z-index: 6;
  --ink: #d8c3a2;
  --ink-hi: #f4e6c8;
  --ink-dim: #8b7a63;
  --ember: #ffa551;
  --ember-deep: #c2611f;
  --hot: #ff7a45;
  --serif: "Optima", "Palatino Linotype", "Book Antiqua", "Iowan Old Style", Georgia, serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  color: var(--ink);
  font-family: var(--serif);
  -webkit-font-smoothing: antialiased;
}

/* --- the tablet: cut stone, chamfered corners, lit from the room ------------------- */
.wcr-slab {
  position: absolute;
  background:
    linear-gradient(168deg, rgba(46,36,27,.90) 0%, rgba(22,17,13,.92) 46%, rgba(11,9,7,.94) 100%);
  clip-path: polygon(
    9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 9px);
  box-shadow:
    inset 0 1px 0 rgba(238,214,176,.13),
    inset 1px 0 0 rgba(238,214,176,.07),
    inset 0 -1px 0 rgba(0,0,0,.6),
    inset 0 0 30px -10px rgba(255,150,60,.20);
  filter: drop-shadow(0 8px 16px rgba(0,0,0,.55));
}
.wcr-slab::before {
  content: ""; position: absolute; inset: 0;
  background-image: ${GRAIN};
  background-size: 140px 140px;
  opacity: .055; mix-blend-mode: overlay;
}
.wcr-slab > * { position: relative; }

/* --- army tablets ------------------------------------------------------------------ */
.wcr-army {
  left: 20px; width: 244px; padding: 11px 13px 9px;
  transition: opacity .35s ease, box-shadow .35s ease;
}
.wcr-army--black { top: 20px; }
.wcr-army--white { bottom: 20px; }
.wcr-army.is-idle { opacity: .68; }

/* The firelight rail. Only the side to move carries it, and it is the loudest thing on
   the screen that is not the board. */
.wcr-army::after {
  content: ""; position: absolute; left: 0; top: 9px; bottom: 0; width: 2px;
  background: linear-gradient(180deg, transparent, var(--ember) 22%, var(--ember-deep) 88%, transparent);
  opacity: 0; transition: opacity .3s ease;
}
.wcr-army.is-active::after { opacity: 1; }
.wcr-army.is-active {
  box-shadow:
    inset 0 1px 0 rgba(238,214,176,.16),
    inset 0 -1px 0 rgba(0,0,0,.6),
    inset 0 0 34px -8px rgba(255,150,60,.34);
}

.wcr-head { display: flex; align-items: center; gap: 9px; }
.wcr-crest { display: block; flex: none; opacity: .95; }
.wcr-crest .wcr-man { height: 31px; width: 24.8px; }
.wcr-names { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1 1 auto; }
.wcr-name {
  font-size: 13px; font-weight: 600; letter-spacing: .26em; text-transform: uppercase;
  color: var(--ink-hi); text-shadow: 0 1px 3px #000;
}
.wcr-army.is-idle .wcr-name { color: var(--ink); }
.wcr-role {
  font-family: var(--mono); font-style: normal;
  font-size: 9px; letter-spacing: .18em; text-transform: uppercase; color: var(--ink-dim);
}

/* The +N. Sits with the side that is ahead and is simply absent from the other. */
.wcr-edge {
  font-family: var(--mono); font-size: 16px; letter-spacing: .02em;
  color: var(--ember); text-shadow: 0 0 12px rgba(255,140,50,.45), 0 1px 2px #000;
  flex: none; opacity: 0; transition: opacity .3s ease;
}
.wcr-edge.on { opacity: 1; }
/* Level on material, but the engine's balance still likes one side. Says so quietly. */
.wcr-edge--fine {
  font-size: 8.5px; letter-spacing: .24em; text-transform: uppercase;
  color: var(--ink-dim); text-shadow: none; opacity: .9;
}
.wcr-edge--fine.on { opacity: .8; }

/* --- the tray ---------------------------------------------------------------------- */
.wcr-tray {
  display: flex; align-items: flex-end; flex-wrap: wrap; gap: 2px 8px;
  min-height: 32px; margin-top: 9px;
  padding-top: 8px; border-top: 1px solid rgba(238,214,176,.10);
}
.wcr-grp { display: flex; align-items: flex-end; }
/* Men of the same type overlap slightly, so a group reads as "three of these" at a glance
   rather than as three separate things that happen to be alike. Not so far that two rooks
   become one wide rook. */
.wcr-grp .wcr-man + .wcr-man { margin-left: -6px; }
.wcr-man { height: 30px; width: 24px; display: block; overflow: visible; }
.wcr-man :where(path, circle, rect) {
  stroke-linejoin: round; paint-order: stroke fill;
}
.wcr-man--white :where(path, circle, rect) {
  fill: #ece0c6; stroke: #17100a; stroke-width: 2.8;
}
/* Black stone, on a tablet cut from stone nearly as dark.
   The obvious fill — the near-black the pieces actually are on the board — turns every
   captured black man into a hole with a hairline around it, and at 28 px a hairline is
   the whole silhouette. So the tray lights them the way the room does: a mid stone with a
   warm rim, dark enough that nobody could mistake one for a white man, solid enough to
   have a shape. */
.wcr-man--black :where(path, circle, rect) {
  fill: #4c4239; stroke: #e2caa4; stroke-width: 2.4;
}
.wcr-man--white .c { fill: #17100a; stroke: none; opacity: .8; }
.wcr-man--black .c { fill: #e2caa4; stroke: none; opacity: .75; }
.wcr-tray .wcr-man { filter: drop-shadow(0 1px 2px rgba(0,0,0,.7)); }

.wcr-nil {
  font-family: var(--mono); font-size: 9px; letter-spacing: .18em;
  text-transform: uppercase; color: var(--ink-dim); opacity: .7; align-self: center;
}

/* --- the flag: whose turn, and what is happening to them --------------------------- */
.wcr-flag {
  display: flex; align-items: center; gap: 7px; margin-top: 8px;
  font-family: var(--mono); font-size: 9.5px; letter-spacing: .2em; text-transform: uppercase;
  color: var(--ink-dim);
}
.wcr-army.is-active .wcr-flag { color: var(--ember); }
.wcr-ember {
  width: 6px; height: 6px; flex: none; border-radius: 50%;
  background: #3a2c20; box-shadow: inset 0 0 0 1px rgba(0,0,0,.6);
}
.wcr-army.is-active .wcr-ember {
  background: var(--ember);
  box-shadow: 0 0 9px 1px rgba(255,140,50,.75);
}
.wcr-army.is-thinking .wcr-ember { animation: wcr-breathe 1.5s ease-in-out infinite; }
@keyframes wcr-breathe {
  0%, 100% { opacity: .28; box-shadow: 0 0 4px 0 rgba(255,140,50,.4); }
  50%      { opacity: 1;   box-shadow: 0 0 12px 2px rgba(255,140,50,.85); }
}
.wcr-check {
  margin-left: auto; padding: 2px 7px 1px;
  color: #1a0d07; background: var(--hot);
  font-weight: 700; letter-spacing: .22em;
  box-shadow: 0 0 14px -2px rgba(255,110,60,.8);
  opacity: 0; transition: opacity .2s ease;
}
.wcr-check.on { opacity: 1; }

/* --- the record -------------------------------------------------------------------- */
.wcr-scroll {
  right: 20px; top: 50%; transform: translateY(-50%);
  width: 198px; padding: 10px 0 8px;
  display: flex; flex-direction: column;
  max-height: min(64vh, 540px);
}
.wcr-scroll-head {
  font-size: 10px; letter-spacing: .3em; text-transform: uppercase;
  color: var(--ink-dim); padding: 0 13px 8px;
  border-bottom: 1px solid rgba(238,214,176,.10);
}
.wcr-moves {
  list-style: none; margin: 0; padding: 6px 13px 0;
  /* min-height:0 is load-bearing: a flex item defaults to min-height:auto and will not
     shrink below its content, so without it a long game grows the tablet off the screen
     instead of scrolling inside its own max-height. */
  overflow: hidden; flex: 1 1 auto; min-height: 0;
  font-family: var(--mono); font-size: 11.5px; line-height: 1.65;
  scrollbar-width: none;
}
.wcr-moves::-webkit-scrollbar { display: none; }
.wcr-moves li { display: flex; gap: 6px; white-space: nowrap; }
.wcr-moves .n { color: var(--ink-dim); width: 26px; text-align: right; flex: none; }
.wcr-moves .w, .wcr-moves .b { width: 62px; flex: none; }
.wcr-moves .w { color: var(--ink-hi); }
.wcr-moves .b { color: #b4a084; }
.wcr-moves .last { color: var(--ember); text-shadow: 0 0 10px rgba(255,140,50,.4); }
.wcr-empty { color: var(--ink-dim); font-family: var(--mono); font-size: 10px;
  letter-spacing: .12em; padding: 4px 13px; }

/* --- the verdict ------------------------------------------------------------------- */
.wcr-verdict {
  left: 50%; top: 5.5%; transform: translateX(-50%);
  padding: 13px 30px 14px; text-align: center; min-width: 300px;
  display: none;
}
.wcr-verdict.on { display: block; animation: wcr-rise .8s ease-out both; }
@keyframes wcr-rise {
  from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.wcr-verdict-eyebrow {
  display: block; font-family: var(--mono);
  font-size: 9px; letter-spacing: .34em; text-transform: uppercase; color: var(--ink-dim);
}
.wcr-verdict-title {
  display: block; margin: 6px 0 5px;
  font-size: 21px; letter-spacing: .34em; text-transform: uppercase; color: var(--ink-hi);
  text-shadow: 0 0 26px rgba(255,140,50,.4), 0 2px 4px #000;
}
.wcr-verdict-line { display: block; font-size: 12.5px; letter-spacing: .09em; color: var(--ink); }

/* --- smaller windows: the board takes the margins back ----------------------------- */
@media (max-width: 1180px) {
  .wcr-army { width: 208px; }
  .wcr-man { height: 24px; width: 19.2px; }
  .wcr-scroll { width: 170px; }
}
@media (max-width: 1000px) {
  .wcr-scroll { display: none; }
  .wcr-army { width: 190px; }
}
@media (max-height: 620px) {
  .wcr-army { padding: 8px 11px 7px; }
  .wcr-crest .wcr-man { height: 24px; width: 19.2px; }
  .wcr-man { height: 23px; width: 18.4px; }
  .wcr-tray { min-height: 26px; margin-top: 6px; padding-top: 6px; }
}
`;

/** Everything the render needs to reach, resolved once. */
interface Parts {
  root: HTMLElement;
  style: HTMLStyleElement;
  army: Record<Side, HTMLElement>;
  edge: Record<Side, HTMLElement>;
  tray: Record<Side, HTMLElement>;
  flagText: Record<Side, HTMLElement>;
  check: Record<Side, HTMLElement>;
  moves: HTMLElement;
  verdict: HTMLElement;
  verdictTitle: HTMLElement;
  verdictLine: HTMLElement;
}

function armyMarkup(side: Side, role: string): string {
  return (
    `<header class="wcr-head">` +
      `<span class="wcr-crest">${glyph('king', side)}</span>` +
      `<span class="wcr-names">` +
        `<span class="wcr-name">${SIDE_NAME[side]}</span>` +
        `<span class="wcr-role" data-role>${role}</span>` +
      `</span>` +
      `<span class="wcr-edge" data-edge></span>` +
    `</header>` +
    `<div class="wcr-tray" data-tray><span class="wcr-nil">nothing taken</span></div>` +
    `<footer class="wcr-flag">` +
      `<span class="wcr-ember"></span>` +
      `<span data-flag>waiting</span>` +
      `<span class="wcr-check" data-check>check</span>` +
    `</footer>`
  );
}

export function createReadout(): Readout {
  const style = document.createElement('style');
  style.id = 'wc-readout-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'wc-readout';
  root.innerHTML =
    `<section class="wcr-slab wcr-army wcr-army--black" data-army="black">` +
      armyMarkup('black', 'the engine') +
    `</section>` +
    `<section class="wcr-slab wcr-army wcr-army--white" data-army="white">` +
      armyMarkup('white', 'you') +
    `</section>` +
    `<section class="wcr-slab wcr-scroll">` +
      `<div class="wcr-scroll-head">Record</div>` +
      `<ol class="wcr-moves" data-moves></ol>` +
    `</section>` +
    `<div class="wcr-slab wcr-verdict" data-verdict>` +
      `<span class="wcr-verdict-eyebrow">the game is over</span>` +
      `<span class="wcr-verdict-title" data-verdict-title></span>` +
      `<span class="wcr-verdict-line" data-verdict-line></span>` +
    `</div>`;
  document.body.appendChild(root);

  const q = (sel: string) => root.querySelector(sel) as HTMLElement;
  const inArmy = (side: Side, sel: string) =>
    root.querySelector(`[data-army="${side}"] ${sel}`) as HTMLElement;

  const p: Parts = {
    root,
    style,
    army: { white: q('[data-army="white"]'), black: q('[data-army="black"]') },
    edge: { white: inArmy('white', '[data-edge]'), black: inArmy('black', '[data-edge]') },
    tray: { white: inArmy('white', '[data-tray]'), black: inArmy('black', '[data-tray]') },
    flagText: { white: inArmy('white', '[data-flag]'), black: inArmy('black', '[data-flag]') },
    check: { white: inArmy('white', '[data-check]'), black: inArmy('black', '[data-check]') },
    moves: q('[data-moves]'),
    verdict: q('[data-verdict]'),
    verdictTitle: q('[data-verdict-title]'),
    verdictLine: q('[data-verdict-line]'),
  };

  /**
   * The single line of text `main.ts` writes into `#hud` every frame is the thing this
   * replaces, and main.ts is frozen core — it will keep writing it forever. Hiding the
   * element it writes into is the only way to not have two HUDs, and it is done from here
   * rather than from a stylesheet so it is unmistakably this module's doing and is put
   * back on dispose.
   */
  const legacy = document.getElementById('hud');
  const legacyDisplay = legacy ? legacy.style.display : '';
  if (legacy) legacy.style.display = 'none';

  /** Sub-signatures, so a frame that changed nothing rewrites no DOM at all. */
  const trayKey: Record<Side, string> = { white: '', black: '' };
  let movesKey = '';

  function renderTray(side: Side, tally: Tally) {
    const key = BY_VALUE.map((t) => tally[t] | 0).join(',');
    if (key === trayKey[side]) return;
    trayKey[side] = key;
    const enemy = OTHER[side];
    let html = '';
    for (const type of BY_VALUE) {
      const n = tally[type] | 0;
      if (n <= 0) continue;
      html += '<span class="wcr-grp">' + glyph(type, enemy).repeat(n) + '</span>';
    }
    p.tray[side].innerHTML = html || '<span class="wcr-nil">nothing taken</span>';
  }

  function renderMoves(history: string[], firstPly: number) {
    const key = `${firstPly}:${history.length}:${history[history.length - 1] ?? ''}`;
    if (key === movesKey) return;
    movesKey = key;
    if (!history.length) {
      p.moves.innerHTML = '<li class="wcr-empty">no moves yet</li>';
      return;
    }
    const last = history.length - 1;
    const rows: string[] = [];
    let i = 0;
    while (i < history.length) {
      const ply = firstPly + i;
      const num = (ply >> 1) + 1;
      let white = '';
      let black = '';
      if (ply % 2 === 0) {
        white = cell('w', history[i], i === last);
        i++;
        if (i < history.length) { black = cell('b', history[i], i === last); i++; }
      } else {
        // A position set up with Black to move: the row opens with an ellipsis, the way a
        // score sheet writes it.
        white = '<span class="w">…</span>';
        black = cell('b', history[i], i === last);
        i++;
      }
      rows.push(`<li><span class="n">${num}.</span>${white}${black}</li>`);
    }
    p.moves.innerHTML = rows.join('');
    // Keep the tail in view without ever being scrollable by hand — see the note at the
    // top about never eating a pointer event.
    p.moves.scrollTop = p.moves.scrollHeight;
  }

  function cell(col: 'w' | 'b', san: string, isLast: boolean): string {
    return `<span class="${col}${isLast ? ' last' : ''}">${esc(san)}</span>`;
  }

  function esc(s: string): string {
    return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
  }

  /**
   * How the game ended, in words a person uses.
   *
   * `GameState.result` is named for the side that was MATED — 'checkmate-white' means
   * White lost — which is a sensible internal convention and a terrible thing to print at
   * a player, and printing it is exactly what the old one-line HUD did.
   */
  function verdictOf(s: ReadoutSnapshot):
    { kind: 'mate' | 'draw'; title: string; line: string } | null {
    if (s.result === 'playing') return null;
    if (s.result === 'checkmate-white' || s.result === 'checkmate-black') {
      const loser: Side = s.result === 'checkmate-white' ? 'white' : 'black';
      const winner = s.winner ?? OTHER[loser];
      return {
        kind: 'mate',
        title: 'Checkmate',
        line: `${SIDE_NAME[winner]} wins — ${SIDE_NAME[loser]}'s king has nowhere to stand.`,
      };
    }
    if (s.result === 'stalemate') {
      return { kind: 'draw', title: 'Stalemate', line: DRAW_LINE.stalemate };
    }
    return {
      kind: 'draw',
      title: 'Draw',
      line: s.drawReason ? DRAW_LINE[s.drawReason] : 'Neither side can force a win.',
    };
  }

  return {
    render(s) {
      const over = s.result !== 'playing';
      const verdict = verdictOf(s);

      for (const side of ['white', 'black'] as Side[]) {
        const el = p.army[side];
        const active = !over && s.turn === side;
        el.classList.toggle('is-active', active);
        el.classList.toggle('is-idle', !active && !over);
        el.classList.toggle('is-thinking', active && s.thinking);

        renderTray(side, s.taken[side]);

        // The badge belongs to whoever is ahead, and to nobody when it is level.
        //
        // Two different numbers say "ahead" and they do not always agree. The piece count
        // is what a player reads — a won rook is "+5", not "+5.0" and certainly not
        // "+500". The engine's `materialBalance()` is centipawns on the search's own
        // scale, where a bishop is worth 330 and a knight 320, so it can call a position
        // for one side that the piece count says is level. That difference is real but it
        // is a tenth of a pawn, and a tenth of a pawn printed as a number is a lie about
        // its own precision. So: the count carries the badge, and the engine's balance
        // gets to speak only when the count has nothing to say, as the word "edge".
        const mine = side === 'white' ? s.edge : -s.edge;
        const cpMine = side === 'white' ? s.cp : -s.cp;
        const fine = mine === 0 && cpMine >= 20;
        const badge = p.edge[side];
        badge.classList.toggle('on', mine > 0 || fine);
        badge.classList.toggle('wcr-edge--fine', fine);
        const text = mine > 0 ? `+${mine}` : fine ? 'edge' : '';
        if (text && badge.textContent !== text) badge.textContent = text;

        // The flag. Under three words, and never a variable name.
        let flag: string;
        if (over) {
          if (verdict && verdict.kind === 'mate') {
            flag = s.winner === side ? 'victorious' : 'checkmated';
          } else {
            flag = 'drawn';
          }
        } else if (active) {
          // No trailing ellipsis: at .2em of letter-spacing the three dots detach from the
          // word and read as an underscore. The breathing ember says "working" better.
          flag = s.thinking ? 'thinking' : 'to move';
        } else {
          flag = 'waiting';
        }
        p.flagText[side].textContent = flag;
        p.check[side].classList.toggle('on', !over && active && s.inCheck);

        const role = el.querySelector('[data-role]') as HTMLElement;
        const wanted = s.player === side ? 'you' : s.player === null ? 'replay' : 'the engine';
        if (role.textContent !== wanted) role.textContent = wanted;
      }

      renderMoves(s.history, s.firstPly);

      p.verdict.classList.toggle('on', !!verdict);
      if (verdict) {
        if (p.verdictTitle.textContent !== verdict.title) p.verdictTitle.textContent = verdict.title;
        if (p.verdictLine.textContent !== verdict.line) p.verdictLine.textContent = verdict.line;
      }
    },

    dispose() {
      if (legacy) legacy.style.display = legacyDisplay;
      p.root.remove();
      p.style.remove();
    },
  };
}
