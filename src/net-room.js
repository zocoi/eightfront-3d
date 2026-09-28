/* Host/guest room logic. Transport-agnostic: any object with
 * send(connId,msg) / broadcast(msg) / onmessage(fn) / close() works
 * (PeerTransport, LocalTransport, or netcheck's in-memory link).
 * Slots are 0-based player indices; displayed as P{slot+1}. */

class NetHost{
 constructor({game,transport,localSlots=[0],name='',onLobby=()=>{}}={}){
  this.g=game;this.t=transport;this.localSlots=localSlots;this.onLobby=onLobby;
  this.isHost=true;this.isGuest=false;this.tick=0;this.acc=0;this.evSince=0;
  this.remote={};this.guests=new Map();this.closed=false;
  // Lobby roster: host occupies its local slots immediately.
  this.members=[{conn:'local',slots:localSlots,name:name||defaultName(localSlots[0]+1),host:true,spec:false}];
  transport.onmessage((id,msg)=>this.onMsg(id,msg));
  transport.onclose?.(id=>this.drop(id));
 }
 lobby(){return this.members.map(m=>({slots:m.slots,name:m.name,host:m.host,spec:m.spec}));}
 broadcastLobby(){const l={k:'lobby',players:this.lobby()};this.t.broadcast(l);this.onLobby(this.lobby());}
 onMsg(id,msg){
  if(!msg||typeof msg!=='object')return;
  if(msg.k==='hi'&&msg.v===NET_VERSION){
   const want=clamp(Math.round(msg.local)||1,1,2);
   const used=new Set(this.members.flatMap(m=>m.slots));
   const slots=[];for(let s=0;s<SQUAD_MAX&&slots.length<want;s++)if(!used.has(s))slots.push(s);
   const playing=this.g.mode!=='menu';
   const m={conn:id,slots,name:(msg.name||'').slice(0,12)||null,host:false,spec:playing};
   this.members.push(m);this.guests.set(id,m);
   this.t.send(id,{k:'hello',slots,you:id,spec:playing,lobby:this.lobby()});
   this.broadcastLobby();
  }else if(msg.k==='in'){
   const m=this.guests.get(id);if(!m)return;
   m.lastSeq=msg.seq||0;
   for(const [s,pack] of Object.entries(msg.packs||{}))if(m.slots.includes(+s))this.remote[s]=pack;
  }else if(msg.k==='bye')this.drop(id);
 }
 drop(id){
  const m=this.guests.get(id);if(!m)return;this.guests.delete(id);
  this.members=this.members.filter(x=>x!==m);for(const s of m.slots)delete this.remote[s];
  this.t.broadcast({k:'left',slots:m.slots});this.broadcastLobby();
 }
 // Full input array for G.update: local slots are filled by the app's controls()
 // beforehand; this only supplies remote slots (idempotent, consumes edge bits).
 fillInputs(inputs){
  for(const [s,pack] of Object.entries(this.remote)){
   if(this.localSlots.includes(+s))continue;
   inputs[+s]=unpackInput(pack);consumeEdges(pack);
  }
  return inputs;
 }
 localIndex(slot){const i=this.localSlots.indexOf(slot);return i<0?null:i;}
 // Call once per rendered frame after the sim steps.
 postTick(dt){
  this.acc+=dt;
  if(this.acc<1/NET_HZ)return;
  this.acc=0;this.tick++;
  const snap=encodeSnapshot(this.g,this.tick,this.evSince);
  this.evSince=snap.vs;
  this.t.broadcast(snap);
 }
 // Host starts (or advances) the run; spectators activate, count rescales.
 roster(){const players=[];for(const m of this.members)for(const s of m.slots)players[s]={name:m.name||defaultName(s+1)};return players;}
 startRun(stageIndex,opts){
  for(const m of this.members)m.spec=false;
  const players=this.roster(),n=players.length;
  this.t.broadcast({k:'start',stage:stageIndex,n,players,difficulty:opts.difficulty,inputMode:opts.inputMode});
  return {playerCount:n,players};
 }
 // Stage advance/retry while playing: guests rebuild the stage puppet-side.
 broadcastStage(stageIndex){
  for(const m of this.members)m.spec=false;
  this.t.broadcast({k:'stage',stage:stageIndex,n:this.roster().length,players:this.roster()});
 }
 playerNames(){const o={};for(const m of this.members)for(const s of m.slots)o[s+1]=m.name||defaultName(s+1);return o;}
 close(){if(this.closed)return;this.closed=true;try{this.t.broadcast({k:'bye'});this.t.close();}catch{}}
}

class NetGuest{
 constructor({game,transport,onSound=()=>{},onLobby=()=>{}}={}){
  this.g=game;this.t=transport;this.onSound=onSound;this.onLobby=onLobby;
  this.isHost=false;this.isGuest=true;this.closed=false;
  this.slots=[];this.spec=false;this.snaps=[];this.lastSerial=0;this.seq=0;
  this.you=null;this.lobbyList=[];
  transport.onmessage((id,msg)=>this.onMsg(msg));
  transport.onclose?.(id=>{if(id==='host')this.goneHost();});
 }
 onMsg(msg){
  if(!msg||typeof msg!=='object')return;
  if(msg.k==='hello'){this.slots=msg.slots;this.you=msg.you;this.spec=msg.spec;this.lobbyList=msg.lobby||[];this.onLobby(this.lobbyList);}
  else if(msg.k==='lobby'){this.lobbyList=msg.players;this.onLobby(this.lobbyList);}
  else if(msg.k==='start')this.onStart?.(msg);
  else if(msg.k==='stage')this.onStage?.(msg);
  else if(msg.k==='snap')this.pushSnap(msg);
  else if(msg.k==='bye'||msg.k==='hostBye')this.goneHost();
  else if(msg.k==='left'){/* roster refresh arrives via lobby */}
 }
 goneHost(){if(this.hostGone)return;this.hostGone=true;this.onHostGone?.();}
 join(name='',local=1){this.t.send('host',{k:'hi',v:NET_VERSION,name,local});}
 // Remote-input path is empty for guests: non-owned slots get {}.
 localIndex(slot){const i=this.slots.indexOf(slot);return i<0?null:i;}
 owns(slot){return this.slots.includes(slot);}
 pushSnap(snap){
  snap.at=performance.now();this.snaps.push(snap);if(this.snaps.length>4)this.snaps.shift();
  this.onSnap?.(snap);
  const g=this.g;
  // Mid-stage joiners never saw 'start': build the puppet stage on first snap.
  if(g.mode==='menu'||g.stageIndex!==snap.stage||g.playerCount!==snap.n){
   g.start(snap.stage,{playerCount:snap.n,online:true,inputMode:snap.im?'retro':'modern',difficulty:snap.df?'classic':'arcade'});
   for(const m of this.lobbyList)for(const s of m.slots)if(g.players[s])g.players[s].name=m.name;
  }
  // Scalar state is authoritative immediately; positions interpolate in tick().
  g.mode=snap.mode==='playing'?'playing':snap.mode;g.t=snap.t;g.room=snap.room;
  g.cam=snap.cam;g.camY=snap.camY;g.furthest=snap.fur;g.score=snap.score;
  g.kills=snap.kills;g.deaths=snap.deaths;g.squadScale=snap.squad;
  if(snap.msg){g.message=snap.msg;g.note=2;}
  g.sensors=(snap.sen||[]).map(([id,hp,x,y,armor])=>{const old=(g.sensors||[]).find(s=>s.id===id);if(old){old.hp=hp;return old;}return{id,hp,maxHp:hp,x,y,z:-14,armor,maxArmor:armor,r:.62,kind:'sensor',hit:0};});
  for(const [id,alive] of snap.cap||[]){const c=(g.capsules||[]).find(c=>c.id===id);if(c)c.hp=alive?1:0;}
  g.pickups=(snap.pk||[]).map(([id,type,x,y,z])=>{const old=(g.pickups||[]).find(c=>c.id===id);return old?(Object.assign(old,{x,y,z}),old):{id,type,x,y,z,age:0};});
  g.corpses=(snap.cor||[]).map(([id,hero,x,y,z,face])=>{const old=(g.corpses||[]).find(c=>c.id===id);return old?(Object.assign(old,{x,y,z,face}),old):{id,hero:!!hero,x,y,z,face,deathAge:0};});
  if(snap.bos){
   const b=snap.bos;
   if(!g.boss)g.boss={targets:[]};
   Object.assign(g.boss,{active:!!b.act,dead:!!b.dead,type:b.ty,phase:b.ph,name:b.nm});
   for(const [id,hp,x,y,z,rx,ry,core,bx,by,bz] of b.tg){
    const q=g.boss.targets.find(t=>t.id===id);
    if(q){q.hp=hp;q.x=x;q.y=y;q.z=z;}
    else g.boss.targets.push({id,hp,maxHp:hp,x,y,z,rx,ry,rz:.7,kind:core?'core':'part',baseX:bx,baseY:by,baseZ:bz,wind:0});
   }
  }
  // Players: keep locally-predicted x/y for owned slots; snap everything else.
  for(const a of snap.pl){
   const d=decodePlayer(a),p=g.players[d.id-1];
   if(!p)continue;
   const mine=this.owns(d.id-1);
   Object.assign(p,mine?{aim:d.aim,hp:d.hp,lives:d.lives,weapon:d.weapon,reserve:d.reserve,grenades:d.grenades,dead:d.dead,duck:d.duck,shooting:d.shooting}:d);
   if(mine&&p.dead)Object.assign(p,{x:d.x,y:d.y,z:d.z,vx:0,vy:0});
  }
 }
 // Per rendered frame: interpolate remote state, predict owned slots,
 // replay FX/sound events. Replaces G.update entirely on guests.
 tick(dt,localCtrls){
  const g=this.g,prev=this.snaps.at(-2),next=this.snaps.at(-1);
  if(!next)return;
  const rt=next.t-NET_INTERP_DELAY;
  const alpha=prev&&next.t>prev.t?clamp((rt-prev.t)/(next.t-prev.t),0,1):1;
  const lerpPos=(ent,findPrev,nextFields)=>{const po=prev&&findPrev(prev);if(po&&alpha<1){ent.x=po.x+(nextFields.x-po.x)*alpha;ent.y=po.y+(nextFields.y-po.y)*alpha;ent.z=(po.z??0)+((nextFields.z??0)-(po.z??0))*alpha;}else{ent.x=nextFields.x;ent.y=nextFields.y;ent.z=nextFields.z||0;}};
  const prevPl=prev?new Map(prev.pl.map(a=>[a[0],{x:a[1],y:a[2],z:a[3]}])):null;
  for(const a of next.pl){const p=g.players[a[0]-1];if(!p||this.owns(a[0]-1))continue;lerpPos(p,s=>prevPl?.get(a[0]),{x:a[1],y:a[2],z:a[3]});}
  // Enemies: rebuild live list keyed by id so renderer fields persist.
  const seen=new Set();
  for(const a of next.en){
   const d=decodeEnemy(a);seen.add(d.id);
   let e=g.enemies.find(e=>e.id===d.id);if(!e){e={id:d.id,type:d.type};g.enemies.push(e);}
   Object.assign(e,{type:d.type,hp:d.hp,vx:d.vx,vy:d.vy,face:d.face,wind:d.wind,aim:d.aim,dead:false});
   const po=prev?.en.find(q=>q[0]===d.id);
   if(po&&alpha<1){e.x=po[2]+(d.x-po[2])*alpha;e.y=po[3]+(d.y-po[3])*alpha;e.z=po[4]+(d.z-po[4])*alpha;}else{e.x=d.x;e.y=d.y;e.z=d.z;}
  }
  g.enemies=g.enemies.filter(e=>seen.has(e.id));
  g.bullets=next.bl.map(a=>{const b=decodeBullet(a);const po=prev?.bl.find(q=>q[0]===b.id);if(po&&alpha<1){b.x=po[1]+(b.x-po[1])*alpha;b.y=po[2]+(b.y-po[2])*alpha;b.z=po[3]+(b.z-po[3])*alpha;}b.hitIds=new Set();return b;});
  // FX + sound replay — drain every buffered snap so skipped frames never drop events.
  for(const snap of this.snaps)for(const e of decodeEvents(snap.ev||[]))if(e.seed>this.lastSerial){this.lastSerial=e.seed;e.born=g.t;spawnEventFx(g,e);}
  for(const s of next.snd||[])this.onSound(s);
  // Prediction: run the shared locomotion step on owned slots at render dt.
  for(const s of this.slots){
   const p=g.players[s];if(!p||p.dead)continue;
   const c=localCtrls[s]||{};
   g.stepLocomotion(p,c,dt,true);
   // Gentle reconcile toward the latest authoritative pose.
   const a=next.pl.find(q=>q[0]===s+1);
   if(a){const err=Math.hypot(p.x-a[1],p.y-a[2]);if(err>1.6){p.x=a[1];p.y=a[2];p.vx=a[4];p.vy=a[5];}else if(err>.02){p.x+=(a[1]-p.x)*.2;p.y+=(a[2]-p.y)*.2;}}
  }
  stepParticles(g,dt); // g.t follows snapshots; particles age locally.
 }
 sendInputs(localCtrls){
  const packs={};
  for(const [i,s] of this.slots.entries())packs[s]=packInput(localCtrls[s]||{});
  this.t.send('host',{k:'in',seq:++this.seq,packs});
 }
 close(){if(this.closed)return;this.closed=true;try{this.t.send('host',{k:'bye'});this.t.close();}catch{}}
}
