/* Wire protocol for host-authoritative co-op.
 * Guests send held-state inputs + edge flags; the host broadcasts compact
 * snapshots at ~20 Hz. Everything here is plain JSON — no binary packing —
 * sized to stay around 4-6 KB in heavy combat. DOM-free so netcheck.mjs
 * can drive it from Node. */
const NET_VERSION=1;
const NET_HZ=20,NET_INTERP_DELAY=.11;

// Player input bitfield. Held bits ride every packet; edge bits latch until
// the host consumes one sim step from that packet.
const IN={right:1,left:2,up:4,down:8,fire:16,jump:32,lock:64,swap:128,grenade:256,fireP:512,jumpP:1024};
const IN_EDGE=IN.swap|IN.grenade|IN.fireP|IN.jumpP;
function packInput(c){
 let b=0;
 if(c.move>0)b|=IN.right;if(c.move<0)b|=IN.left;
 if(c.up)b|=IN.up;if(c.down)b|=IN.down;if(c.fire)b|=IN.fire;if(c.jump)b|=IN.jump;
 if(c.lock)b|=IN.lock;if(c.swap)b|=IN.swap;if(c.grenade)b|=IN.grenade;
 if(c.firePressed)b|=IN.fireP;if(c.jumpPressed)b|=IN.jumpP;
 const p={b};if(c.aimPoint)p.a=c.aimPoint.map(v=>+v.toFixed(2));
 return p;
}
function unpackInput(p){
 const b=p.b||0;
 return{move:(b&IN.right?1:0)-(b&IN.left?1:0),up:!!(b&IN.up),down:!!(b&IN.down),fire:!!(b&IN.fire),jump:!!(b&IN.jump),lock:!!(b&IN.lock),swap:!!(b&IN.swap),grenade:!!(b&IN.grenade),firePressed:!!(b&IN.fireP),jumpPressed:!!(b&IN.jumpP),aimPoint:p.a||null};
}
// Clear only the edge bits the sim consumed; held bits persist.
function consumeEdges(p){p.b&=~IN_EDGE;return p;}

const WIRE_WEAPONS=['R','M','S','L','F'];
const WIRE_ENEMIES=['runner','rifle','turret','heavy','drone','tank','cart','alien','crawler','pod','alienHead'];
const q=v=>+v.toFixed(2);

// Flags: grounded|duck|dead|shooting|retro handled implicitly.
function encodePlayer(p){
 return[p.id,q(p.x),q(p.y),q(p.z),q(p.vx),q(p.vy),q(p.aim||0),p.face||1,
  (p.grounded?1:0)|(p.duck?2:0)|(p.dead?4:0)|(p.shooting?8:0),
  p.hp,p.lives,WIRE_WEAPONS.indexOf(p.weapon),p.reserve?WIRE_WEAPONS.indexOf(p.reserve):-1,
  p.grenades|0,q(p.inv||0)];
}
function decodePlayer(a){
 return{id:a[0],x:a[1],y:a[2],z:a[3],vx:a[4],vy:a[5],aim:a[6],face:a[7],
  grounded:!!(a[8]&1),duck:!!(a[8]&2),dead:!!(a[8]&4),shooting:!!(a[8]&8),
  hp:a[9],lives:a[10],weapon:WIRE_WEAPONS[a[11]]||'R',reserve:a[12]>=0?WIRE_WEAPONS[a[12]]:null,
  grenades:a[13],inv:a[14]};
}
function encodeEnemy(e){
 return[e.id,WIRE_ENEMIES.indexOf(e.type),q(e.x),q(e.y),q(e.z),e.hp,q(e.vx||0),q(e.vy||0),e.face||1,e.wind>0?1:0,q(e.aim||0),e.dead?1:0];
}
function decodeEnemy(a){
 return{id:a[0],type:WIRE_ENEMIES[a[1]]||'runner',x:a[2],y:a[3],z:a[4],hp:a[5],vx:a[6],vy:a[7],face:a[8],wind:a[9]?.5:0,aim:a[10],dead:!!a[11]};
}
function encodeBullet(b){
 return[b.id,q(b.x),q(b.y),q(b.z),q(b.vx),q(b.vy),q(b.vz),WIRE_WEAPONS.indexOf(b.type)>=0?WIRE_WEAPONS.indexOf(b.type):9,b.enemy?1:0,q(b.r||.09)];
}
function decodeBullet(a){
 return{id:a[0],x:a[1],y:a[2],z:a[3],vx:a[4],vy:a[5],vz:a[6],type:WIRE_WEAPONS[a[7]]||'orb',enemy:!!a[8],r:a[9]};
}

// The event list only carries what guests haven't seen: host tracks each peer's
// acked visualSerial and ships the tail since it.
function encodeEvents(g,since=0){
 return(g.visualEvents||[]).filter(e=>e.seed>since).map(e=>{const{born,life,seed,...rest}=e;return{...rest,born:q(born),life,s:seed};});
}
function decodeEvents(list){return list.map(({s,...e})=>({seed:s,born:e.born,life:e.life,...e}));}

function encodeSnapshot(g,tick,eventSince=0){
 return{v:NET_VERSION,k:'snap',tick,t:q(g.t),stage:g.stageIndex,mode:g.mode,
  room:g.room,cam:q(g.cam),camY:q(g.camY),fur:q(g.furthest),
  score:g.score,kills:g.kills,deaths:g.deaths,msg:g.note>0?g.message:'',
  squad:g.squadScale||1,n:g.playerCount,im:g.inputMode==='retro'?1:0,df:g.difficulty==='classic'?1:0,
  pl:g.players.map(encodePlayer),
  en:g.enemies.filter(e=>!e.dead).map(encodeEnemy),
  bl:g.bullets.filter(b=>!b.remove).map(encodeBullet),
  sen:(g.sensors||[]).map(s=>[s.id,s.hp,q(s.x),q(s.y),s.armor||0]),
  cap:(g.capsules||[]).map(c=>[c.id,c.hp>0?1:0]),
  pk:(g.pickups||[]).map(c=>[c.id,c.type,q(c.x),q(c.y),q(c.z)]),
  cor:(g.corpses||[]).map(c=>[c.id,c.hero?1:0,q(c.x),q(c.y),q(c.z),c.face||1]),
  bos:g.boss?{ty:g.boss.type,act:g.boss.active?1:0,dead:g.boss.dead?1:0,ph:g.boss.phase,nm:g.boss.name,
   tg:g.boss.targets.map(t=>[t.id,t.hp,q(t.x),q(t.y),q(t.z),q(t.rx||1),q(t.ry||1),t.kind==='core'?1:0,q(t.baseX??t.x),q(t.baseY??t.y),q(t.baseZ??t.z)])}:null,
  ev:encodeEvents(g,eventSince),
  vs:g.visualSerial||0,
  snd:(g.outSnd||[]).splice(0),
 };
}
