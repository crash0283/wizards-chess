import { build } from 'esbuild';
import { resolve } from 'node:path';
const ROOT = '/home/user/wizards-chess';
const out = await build({
  entryPoints: [resolve(ROOT, 'src/chess/index.ts')],
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
  write: false, logLevel: 'silent',
});
const C = await import('data:text/javascript;base64,' +
  Buffer.from(out.outputFiles[0].text, 'utf8').toString('base64'));

let bad = 0;
for (const id of C.DEMO_LINE_IDS) {
  const g = C.buildDemoGame(id);
  // Do NOT trust g.verified — replay every ply through the generator ourselves.
  let pos = C.parseFen(g.startFen), legal = true;
  for (const m of g.moves) {
    if (!C.moveIsLegal(pos, m.uci)) { legal = false; break; }
    pos = C.makeMove(pos, m.uci);
  }
  const replies = C.legalMoves(pos).length;
  const mate = C.isCheckmate(pos);
  const fenMatch = C.toFen(pos).split(' ')[0] === g.finalFen.split(' ')[0];
  const good = legal && mate && replies === 0 && fenMatch;
  if (!good) bad++;
  console.log(
    `${id.padEnd(12)} plies=${String(g.moves.length).padStart(3)} ` +
    `captures=${String(g.moves.filter(m=>m.capture).length).padStart(2)} ` +
    `replayLegal=${legal} fenMatch=${fenMatch} inCheck=${C.inCheck(pos)} ` +
    `legalReplies=${replies} CHECKMATE=${mate} mated=${g.matedSide} king=${g.king.name} ` +
    `checkers=${g.checkers.map(c=>c.piece+'@'+c.name).join('+')}`
  );
}
console.log(bad === 0 ? '\nALL DEMO LINES END IN A VERIFIED REAL CHECKMATE' : `\n${bad} LINE(S) FAILED`);
