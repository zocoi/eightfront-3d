/* Node smoke test for the netcode path — no browser, no WebRTC.
 * Loads the real src modules (roster/fx/protocol/room + sim deps), wires a
 * NetHost and NetGuest over an in-memory link, and asserts:
 *   - hello/slot assignment + lobby shape
 *   - snapshot round-trip (guests rebuild players/enemies/bullets)
 *   - snapshot size budget (~6 KB worst case probe)
 *   - guest input reaches the host sim (remote slot moves)
 *   - visual events replay into guest particles
 *   - squadScale difficulty values (1p = 1.0, 10p ≈ 3.7)
 * Run: node netcheck.mjs */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const src=f=>fs.readFileSync(path.join(root,'src',f),'utf8');
const api=new Function(
 ['roster.js','fx.js','net-protocol.js','i18n.js','stages.js','game.js','net-room.js'].map(src).join('\n')+
 ';return{SQUAD,SQUAD_MAX,CampaignGame,NetHost,NetGuest,encodeSnapshot,packInput,unpackInput,makeStage,WEAPONS};')();
const{SQUAD,SQUAD_MAX,CampaignGame,NetHost,NetGuest,encodeSnapshot,packInput,unpackInput}=api;
let pass=0,fail=0;
const ok=(name,cond,extra='')=>{if(cond){pass++;console.log('  ✓',name);}else{fail++;console.error('  ✗',name,extra);}};

// In-memory transport pair mimicking the LocalTransport/PeerTransport surface.
function linkPair(){
 const q=[];
 const mk=id=>({id,_f:()=>{},send:(to,msg)=>q.push({to,from:id,msg}),broadcast:msg=>q.push({to:'*',from:id,msg}),onmessage(f){this._f=f;},onclose(f){this._c=f;},close(){}});
 const host=mk('host'),guest=mk('g1');
 const pump=()=>{let guard=0;while(q.length&&guard++<1000){const m=q.shift();if(m.from!=='host'&&(m.to==='host'||m.to==='*'))host._f(m.from,m.msg);if(m.from==='host'&&(m.to==='*'||m.to===guest.id))guest._f('host',m.msg);}};
 return{host,guest,pump};
}

console.log('netcheck: protocol');
{const c={move:1,up:true,fire:true,jumpPressed:true,swap:true,grenade:false,aimPoint:[3.5,1.25,0]};
 const u=unpackInput(packInput(c));
 ok('input round-trip',u.move===1&&u.up&&u.fire&&u.jumpPressed&&u.swap&&!u.grenade&&u.aimPoint?.[0]===3.5);
 const p=packInput(c);p.b&=~(128|256|512|1024);const u2=unpackInput(p);
 ok('edge bits clear after consume',!u2.swap&&!u2.jumpPressed&&u2.fire===true);
}

console.log('netcheck: host/guest round-trip');
{
 const{host:ht,guest:gt,pump}=linkPair();
 const hg=new CampaignGame({sound(){},projectile(){},contact(){},observe(){},stage(){}});
 const gg=new CampaignGame({sound(){},projectile(){},contact(){},observe(){},stage(){}});
 const host=new NetHost({game:hg,transport:ht,localSlots:[0]});
 let snapCount=0;
 const guest=new NetGuest({game:gg,transport:gt,onSound(){}});
 guest.join('',1);pump();
 ok('guest assigned slot 1',guest.slots.length===1&&guest.slots[0]===1,JSON.stringify(guest.slots));
 ok('host sees 2 members',host.lobby().length===2);
 const run=host.startRun(0,{difficulty:'arcade',inputMode:'modern'});
 ok('playerCount=2',run.playerCount===2);
 hg.start(0,{playerCount:2,online:true});
 // pushSnap fallback covers guests that never saw 'start' (mid-stage joins).
 hg.update(1/120,[{move:1},{}]);host.postTick(.05);pump();
 ok('guest puppet initialized',gg.playerCount===2&&gg.mode==='playing');
 ok('guest players populated',gg.players[1]&&Number.isFinite(gg.players[1].x));
 // Remote input: guest's slot-1 pack reaches the host's fillInputs.
 gt.send('host',{k:'in',seq:1,packs:{1:packInput({move:1})}});pump();
 const inputs=host.fillInputs([{},{}]);
 ok('remote input arrives',inputs[1].move===1);
 const x0=hg.players[1].x;for(let i=0;i<12;i++){gt.send('host',{k:'in',seq:2+i,packs:{1:packInput({move:1})}});pump();hg.update(1/120,host.fillInputs([{},{}]));}
 ok('remote slot moves on host',hg.players[1].x>x0,`x=${hg.players[1].x} vs ${x0}`);
 const snap=encodeSnapshot(hg,2,0),bytes=JSON.stringify(snap).length;
 ok('snapshot ≤ 6 KB',bytes<=6144,bytes+' B');
 // Event replay: host explosion → event in snap → guest spawns particles.
 gg.particles=[];hg.explosion(5,1,0);host.postTick(.05);pump();
 if(guest.snaps.length){guest.tick(1/60,{});}
 ok('event → guest particles',gg.particles.length>0);
 host.close();guest.close();
}

console.log('netcheck: difficulty scaling');
{
 for(const [n,want]of[[1,1.0],[2,1.3],[10,3.7]]){
  const g=new CampaignGame({sound(){},projectile(){},contact(){},observe(){},stage(){}});
  g.start(0,{playerCount:n,practice:true});
  ok(`squadScale at ${n}p ≈ ${want}`,Math.abs(g.squadScale-want)<1e-9,g.squadScale);
 }
 const g=new CampaignGame({sound(){},projectile(){},contact(){},observe(){},stage(){}});
 g.start(0,{playerCount:10,practice:true});
 const e=g.spawn('runner',0,0);
 ok('runner hp scales 1→4 at 10p',e.hp===4,`hp=${e.hp}`);
}

console.log('netcheck: roster');
ok('10 authored identities',SQUAD.length===10&&SQUAD_MAX===10);
ok('callsigns unique',new Set(SQUAD.map(s=>s.call)).size===10);
ok('accents unique',new Set(SQUAD.map(s=>s.accent)).size===10);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
