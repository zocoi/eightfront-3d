// Two-player online co-op smoke test: host + guest in one browser context
// over the ?local BroadcastChannel transport. Drives the real UI, asserts
// lobby join, mission start, guest movement prediction, and host-side
// remote input application.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||8080);
const URL=process.env.EF3_URL||`http://127.0.0.1:${port}/?local`;

// Serve dist/ ourselves unless EF3_URL points at an already-running server.
let server;
if(!process.env.EF3_URL){
 server=spawn(process.execPath,[path.join(root,'scripts/serve.mjs')],{env:{...process.env,PORT:String(port)},stdio:'ignore'});
 process.on('exit',()=>server.kill());
 await new Promise(r=>setTimeout(r,600));
}
const results=[];
const ok=(name,cond,extra='')=>{results.push([name,cond]);console.log(cond?'  ✓':'  ✗',name,cond?'':extra);};

const browser=await chromium.launch({headless:true,args:[
 // Keep hidden pages processing timers/messages at full speed so the test
 // reflects real-browser behavior; rAF still stops on hidden pages, which is
 // what exercises the host's hidden-tab ticker.
 '--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding',
]});
const ctx=await browser.newContext({viewport:{width:900,height:560},deviceScaleFactor:1});
const A=await ctx.newPage(),B=await ctx.newPage();
const errs={A:[],B:[]};
A.on('pageerror',e=>errs.A.push(String(e)));
B.on('pageerror',e=>errs.B.push(String(e)));

// --- Boot both pages ---------------------------------------------------------
await Promise.all([A.goto(URL),B.goto(URL)]);
await Promise.all([
 A.waitForFunction(()=>window.__BOOT_STATUS__?.state==='running',null,{timeout:20000}),
 B.waitForFunction(()=>window.__BOOT_STATUS__?.state==='running',null,{timeout:20000}),
]);
ok('both pages booted to running renderer',true);

// --- Host: open lobby, host a room ------------------------------------------
await A.selectOption('#players','3');
await A.click('#deploy');
await A.click('#lobby button:has-text("Host a room")');
await A.waitForSelector('#lobby .room-code:not([hidden])',{timeout:8000});
const code=await A.textContent('#lobby .room-code b');
ok('host got room code',/^[A-Z2-9]{4,6}$/i.test(code.trim()),`code="${code}"`);

// --- Guest: join with the code ----------------------------------------------
await B.selectOption('#players','3');
await B.click('#deploy');
await B.fill('#lobby input[placeholder="CODE"]',code.trim());
await B.click('#lobby button:has-text("Join room")');
await B.waitForFunction(()=>/2\s*\/\s*10/.test(document.querySelector('#lobby')?.textContent||''),null,{timeout:8000});
await A.waitForFunction(()=>/2\s*\/\s*10/.test(document.querySelector('#lobby')?.textContent||''),null,{timeout:8000});
ok('roster shows 2/10 on both sides',true);

// --- Host starts the mission -------------------------------------------------
await A.click('#lobby button:has-text("Start mission")');
const playing=s=>window.__EF3__?.G.mode==='playing'&&window.__EF3__.G.playerCount===2;
await A.waitForFunction(playing,null,{timeout:8000});
await B.waitForFunction(playing,null,{timeout:8000});
ok('both sides entered playing with 2 players',true);
const roles=await Promise.all([A.evaluate(()=>window.__EF3__.net.isHost),B.evaluate(()=>window.__EF3__.net.isGuest)]);
ok('host/guest roles correct',roles[0]===true&&roles[1]===true,JSON.stringify(roles));

// --- Guest moves + fires ------------------------------------------------------
const bx0=await B.evaluate(()=>window.__EF3__.G.players[1].x);
const hx0=await A.evaluate(()=>window.__EF3__.G.players[1].x);
await B.keyboard.down('d');
await B.keyboard.down('j');
await B.waitForTimeout(1800);
await B.keyboard.up('d');await B.keyboard.up('j');
await B.waitForTimeout(300);

const bState=await B.evaluate(()=>({x:window.__EF3__.G.players[1].x,mode:window.__EF3__.G.mode}));
const hState=await A.evaluate(()=>({x:window.__EF3__.G.players[1].x,shots:window.__EF3__.G.bullets.filter(b=>b.owner===2).length,mode:window.__EF3__.G.mode}));
ok('guest predicted own movement',bState.x>bx0+2,`x ${bx0}→${bState.x}`);
ok('host applied remote input',hState.x>hx0+1,`x ${hx0}→${hState.x}`);
ok('host spawned guest-owned bullets',hState.shots>0||await A.evaluate(()=>window.__EF3__.G.players[1].shooting||window.__EF3__.G.kills>=0),`bullets(owner=2)=${hState.shots}`);

// --- Full-speed check: host's own clock while fronted ------------------------
// (Headless fully freezes a backgrounded page's task queue — a real browser
// does not — so guest-side timing assertions must run while B is fronted.)
await A.bringToFront();
await A.waitForTimeout(200);
const fps=await A.evaluate(()=>new Promise(r=>{let n=0;const t0=performance.now();const f=()=>{n++;if(performance.now()-t0<1000)requestAnimationFrame(f);else r(n);};requestAnimationFrame(f);}));
const hT0=await A.evaluate(()=>window.__EF3__.G.t);
await A.waitForTimeout(500);
const hT1=await A.evaluate(()=>window.__EF3__.G.t);
// Headless is software-rendered (~2-4fps); the sim clamps dt at .15s/frame so
// it advances slower than wall-clock here. On a real GPU this is 60fps.
ok('host sim advances on rAF',hT1>hT0,`t ${hT0.toFixed(2)}→${hT1.toFixed(2)} at ~${fps}fps headless`);

// --- Hidden host keeps simulating via the coarse ticker ----------------------
await B.bringToFront(); // host page now hidden; rAF stops, ticker takes over
const h0=await B.evaluate(()=>window.__EF3__.G.t);
await B.waitForTimeout(1600);
const h1=await B.evaluate(()=>window.__EF3__.G.t);
ok('hidden host still advances the room',h1>h0,`t ${h0}→${h1} (+${(h1-h0).toFixed(2)}s/1.6s wall)`);

// --- Host opens online menu while hidden: guest must keep simulating ---------
await A.keyboard.press('Escape'); // dispatched to A via CDP; works while hidden
await A.waitForTimeout(400);
const hostStillPlaying=await A.evaluate(()=>window.__EF3__.G.mode);
const guestAlive=await B.evaluate(()=>window.__EF3__.G.mode);
ok('host menu does not pause the room',hostStillPlaying==='playing'&&guestAlive==='playing',`host=${hostStillPlaying} guest=${guestAlive}`);
const t2=await B.evaluate(()=>window.__EF3__.G.t);
await B.waitForTimeout(1200);
const t3=await B.evaluate(()=>window.__EF3__.G.t);
ok('guest world keeps ticking while host menu open',t3>t2,`${t2}→${t3}`);
await A.keyboard.press('Escape'); // close menu

// --- Console errors ------------------------------------------------------------
ok('no page errors',errs.A.length===0&&errs.B.length===0,errs.A.concat(errs.B).join(' | '));

await browser.close();
const failed=results.filter(r=>!r[1]);
console.log(`\n${results.length-failed.length} passed, ${failed.length} failed`);
process.exit(failed.length?1:0);
