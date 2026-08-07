import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';
const ROOT='/home/user/wizards-chess';
const port=await new Promise((r,j)=>{const s=net.createServer();s.on('error',j);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
const sv=spawn('npx',['vite','--port',String(port),'--strictPort','--host','127.0.0.1'],{cwd:ROOT,stdio:'ignore'});
const open=(p)=>new Promise(r=>{const s=net.connect({port:p,host:'127.0.0.1'},()=>(s.destroy(),r(true)));s.on('error',()=>r(false));s.setTimeout(500,()=>(s.destroy(),r(false)))});
for(let i=0;i<200;i++){if(await open(port))break;await new Promise(r=>setTimeout(r,250));}
const br=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const pg=await br.newPage({viewport:{width:1280,height:720}});
await pg.goto(`http://127.0.0.1:${port}/`,{waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction(()=>!!window.__WC__,null,{timeout:300000});
await pg.waitForTimeout(12000);
const r=await pg.evaluate(()=>{
  const {world,THREE}=window.__WC__; const S=2.35;
  const px=(f,rk)=>{const v=new THREE.Vector3((3.5-f)*S,0.2,(rk-3.5)*S);v.project(world.camera);
    const el=world.renderer.domElement;const b=el.getBoundingClientRect();
    return {x:Math.round(b.left+((v.x+1)/2)*b.width), y:Math.round(b.top+((-v.y+1)/2)*b.height)};};
  return {a1:px(0,0), h1:px(7,0), a8:px(0,7), h8:px(7,7), w:world.renderer.domElement.getBoundingClientRect().width};
});
console.log('canvas width', r.w);
console.log('a1 screen x', r.a1.x, ' y', r.a1.y);
console.log('h1 screen x', r.h1.x, ' y', r.h1.y);
console.log('a8 screen x', r.a8.x, ' y', r.a8.y);
console.log('');
console.log(r.a1.x < r.h1.x ? 'CORRECT: a-file is LEFT of h-file' : 'STILL MIRRORED: a-file is RIGHT of h-file');
console.log(r.a1.y > r.a8.y ? 'CORRECT: rank 1 is BELOW rank 8 (White near)' : 'WRONG: rank 1 above rank 8');
await br.close(); sv.kill();
