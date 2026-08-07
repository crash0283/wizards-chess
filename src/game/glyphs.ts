/**
 * Carved piece silhouettes for the readout, as inline SVG.
 *
 * The readout has to say "White has taken two pawns and a knight" without using the words
 * "two pawns and a knight", which means drawing the men themselves. Three ways to do that
 * and only one of them survives contact with a real machine:
 *
 *   unicode ♟♞♝♜♛♚   the obvious answer, and wrong. U+265F carries an emoji presentation
 *                    in several system fonts, so a tray of captured pawns renders as a row
 *                    of glossy full-colour cartoon chess pieces on top of a firelit stone
 *                    chamber. The outline series (U+2654..2659) is worse: hairline strokes
 *                    that vanish at 20 px and are a different weight in every font.
 *   a sprite sheet   a PNG to fetch, a scale to pick, and a second asset pipeline for six
 *                    shapes that are each a dozen line segments.
 *   inline SVG       fixed geometry, no fetch, colour and stroke driven from CSS, sharp on
 *                    any display, and the same on every machine. This.
 *
 * The silhouettes are deliberately blocky — chamfered plinths, heavy collars, flat
 * crenellations — because they are meant to read as the same carved stone the board is
 * fighting on, at 20 px, over a moving picture. Detail below about a millimetre on screen
 * is not drawn at all; the shape has to survive being small.
 *
 * Every piece is a stack of separate shapes rather than one path, and each of them is
 * stroked. The seams where they overlap are the point: they read as the joints between
 * carved sections, and they are what stops the small sizes collapsing into a blob.
 *
 * Nothing here runs under capture. The readout that uses it is only ever constructed when
 * `world.capturing` is false.
 */
import type { PieceType, Side } from '../core/constants';

/**
 * Shared plinth and collar. Every man on this board stands on the same two mouldings, and
 * drawing them once is what makes a tray of mixed pieces line up along one baseline.
 */
const PLINTH =
  '<path d="M11 75 H53 V71 Q53 67.5 49 66.5 H15 Q11 67.5 11 71 Z"/>' +
  '<path d="M16 66.5 H48 L45.5 61 H18.5 Z"/>';

/** viewBox is 0 0 64 80. The baseline is y=75; crowns run up to about y=6. */
const SHAPES: Record<PieceType, string> = {
  pawn:
    PLINTH +
    '<path d="M20.5 61 C24.5 57.5 25.5 53.5 25.5 49.5 H38.5 C38.5 53.5 39.5 57.5 43.5 61 Z"/>' +
    '<rect x="22" y="44.5" width="20" height="5.5" rx="2"/>' +
    '<circle cx="32" cy="34" r="9"/>',

  knight:
    PLINTH +
    // Head in profile, facing frame-left, the way a knight stands on a board.
    '<path d="M22.5 61 C22 54 24 49 28.5 45.2 ' +
    'C22.5 44 18.5 40 19.5 34 L23.5 26.2 C25.5 21 30.5 16.5 37 14.4 ' +
    'L35 20.2 L42 18 C48 22.8 49.4 31.6 47.4 41 C46.2 49 44.4 55.4 44 61 Z"/>' +
    '<path d="M36.6 15.2 L34.2 8.6 L41 13 Z"/>' +
    '<circle class="c" cx="28.4" cy="30.5" r="1.9"/>',

  bishop:
    PLINTH +
    '<path d="M22 61 C22.5 53 25.5 47 29.5 43 H34.5 C38.5 47 41.5 53 42 61 Z"/>' +
    '<rect x="21" y="37.5" width="22" height="5.5" rx="2"/>' +
    '<path d="M32 12 C41 22 43.4 31 39.2 36.6 C36.2 40.6 27.8 40.6 24.8 36.6 ' +
    'C20.6 31 23 22 32 12 Z"/>' +
    '<circle cx="32" cy="9.6" r="3.3"/>' +
    '<rect class="c" x="32.6" y="19" width="2.6" height="9.5" rx="1.3" ' +
    'transform="rotate(26 33.9 23.8)"/>',

  rook:
    PLINTH +
    '<path d="M21 61 C22 54.5 23 48.5 23 44 H41 C41 48.5 42 54.5 43 61 Z"/>' +
    '<rect x="19" y="37.5" width="26" height="6.5" rx="1.5"/>' +
    '<path d="M19 38 V25 h5 v5 h5 v-5 h6 v5 h5 v-5 h5 v13 Z"/>',

  queen:
    PLINTH +
    '<path d="M21 61 C22 53.5 24 47.5 25 43 H39 C40 47.5 42 53.5 43 61 Z"/>' +
    '<rect x="20" y="37.5" width="24" height="5.5" rx="2"/>' +
    '<path d="M20.5 38 L17.5 18 L25 29.5 L32 13.5 L39 29.5 L46.5 18 L43.5 38 Z"/>' +
    '<circle cx="17" cy="15.5" r="3"/>' +
    '<circle cx="32" cy="11" r="3.4"/>' +
    '<circle cx="47" cy="15.5" r="3"/>',

  king:
    PLINTH +
    '<path d="M21 61 C22 53.5 24 47.5 25 43 H39 C40 47.5 42 53.5 43 61 Z"/>' +
    '<rect x="20" y="37.5" width="24" height="5.5" rx="2"/>' +
    '<path d="M20.5 38 L18.5 22 Q32 30.5 45.5 22 L43.5 38 Z"/>' +
    '<path d="M28.8 23 V16 H23 V10 H28.8 V3.5 H35.2 V10 H41 V16 H35.2 V23 Z"/>',
};

/** Conventional order for a captured tray: strongest first. */
export const BY_VALUE: PieceType[] = ['queen', 'rook', 'bishop', 'knight', 'pawn'];

/** Conventional pawn-unit worth, for the +N badge a chess player expects to read. */
export const PAWN_VALUE: Record<PieceType, number> = {
  pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0,
};

/**
 * One carved man, at whatever size the CSS asks for.
 *
 * `side` is the side the piece BELONGS to, not the side that took it — a pawn in White's
 * tray is a black pawn and is drawn in black stone, which is the whole reason the tray
 * answers "which side has which pieces" rather than just "how many".
 */
export function glyph(type: PieceType, side: Side, cls = ''): string {
  return `<svg class="wcr-man wcr-man--${side}${cls ? ' ' + cls : ''}" ` +
    `viewBox="0 0 64 80" aria-hidden="true">${SHAPES[type]}</svg>`;
}
