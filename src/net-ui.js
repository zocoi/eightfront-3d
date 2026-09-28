/* Online lobby overlay + in-game net status. Built dynamically over the
 * existing .shade/.panel styles so no shell.html surgery is needed.
 * NetUI.net holds the active NetHost/NetGuest for the app frame loop. */
const NetUI={
 net:null,panel:null,deps:null,
 el(tag,cls,text,parent){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;if(parent)parent.append(e);return e;},
 openLobby(deps){
  this.deps=deps;this.closeNet();
  const shade=this.el('section','shade','',document.body);shade.id='lobby';this.panel=shade;
  const panel=this.el('div','panel lobby-panel','',shade);
  this.el('div','kicker','ONLINE CO-OP',panel);this.el('h2','',t('lobbyTitle'),panel);
  this.el('p','',t('lobbyNote'),panel);
  const cf=this.el('label','call-field','',panel);
  this.el('span','',t('netName'),cf);
  const nameIn=this.el('input','','',cf);nameIn.maxLength=12;nameIn.placeholder=defaultName(1);
  try{nameIn.value=localStorage.getItem('ef3-name')||''}catch{}
  const row=this.el('div','lobby-actions','',panel);
  const hostBtn=this.el('button','secondary',t('netHost'),row);
  const jc=this.el('div','join-cluster','',row);
  const codeIn=this.el('input','','',jc);codeIn.placeholder=t('codePlaceholder');codeIn.maxLength=6;
  const joinBtn=this.el('button','secondary',t('netJoin'),jc);
  const p2=this.el('label','p2-row','',panel);
  const p2box=this.el('input','','',p2);p2box.type='checkbox';this.el('span','',t('netP2'),p2);
  const codeRow=this.el('div','room-code','',panel);codeRow.hidden=true;
  this.el('span','',t('codeLabel'),codeRow);
  const codeOut=this.el('b','','',codeRow);
  const copyBtn=this.el('button','quiet',t('netCopy'),codeRow);
  copyBtn.onclick=()=>{const done=()=>{copyBtn.textContent=t('netCopied');setTimeout(()=>{copyBtn.textContent=t('netCopy')},1400);};try{navigator.clipboard.writeText(location.href).then(done,done)}catch{done()}};
  const status=this.el('p','settings-note',t('netWaiting'),panel);
  const rosterHead=this.el('div','roster-label','',panel);
  this.el('span','',t('netRoster'),rosterHead);
  const rosterCount=this.el('b','','0 / 10',rosterHead);
  const roster=this.el('div','roster-grid','',panel);
  const startBtn=this.el('button','primary',t('netStart'),panel);startBtn.hidden=true;
  const leaveBtn=this.el('button','quiet',t('netLeave'),panel);
  // hide dismisses the overlay but keeps the room alive; leave tears it down
  // (and drops the #CODE deep-link).
  const hide=()=>shade.remove();
  const leave=()=>{this.closeNet();shade.remove();try{history.replaceState(null,'',location.pathname+location.search);}catch{}};
  // Full 10-slot board: filled slots carry the member's palette + name,
  // open slots preview the callsign the next joiner would take.
  const renderList=players=>{
   roster.replaceChildren();
   const n=this.net,mine=new Set(n?(n.slots||n.localSlots||[]):[]);
   const owner={};let filled=0;
   for(const m of players)for(const s of m.slots)owner[s]=m;
   for(let s=0;s<10;s++){
    const kit=squadIdentity(s+1),m=owner[s];
    const cell=this.el('div','slot'+(m?'':' open')+(m&&mine.has(s)?' me':''),'',roster);
    cell.style.setProperty('--slot',kit.accent);
    this.el('b','',`P${s+1} · ${m?(m.name||kit.call):kit.call}`,cell);
    const tags=[];
    if(!m)tags.push(t('netOpenSlot'));
    else{filled++;if(m.host)tags.push('HOST');if(mine.has(s))tags.push(t('netYou'));if(m.spec)tags.push(t('netSpectator'));}
    if(tags.length)this.el('small','',tags.join(' / '),cell);
   }
   rosterCount.textContent=`${filled} / 10`;
  };
  renderList([]);
  // Editable callsign: sent on join, live-renames via {k:'name'} after.
  const rename=()=>{const v=nameIn.value.trim();try{localStorage.setItem('ef3-name',v)}catch{}
   const n=this.net;if(!n)return;
   if(n.isHost){n.members[0].name=v||null;n.broadcastLobby();}
   else n.t.send('host',{k:'name',name:v});};
  nameIn.oninput=rename;
  const statusEl=document.getElementById('netStatus');
  const setStatus=v=>{if(statusEl){statusEl.hidden=!v;statusEl.textContent=v||'';}};
  const begin=(stage,n,names,opts={})=>{
   deps.start(stage,{playerCount:n,online:true,...opts});
   for(const p of deps.game.players)p.name=names?.[p.id-1]?.name||defaultName(p.id);
   hide();setStatus('ONLINE · '+n+'P');
  };
  const busy=v=>{hostBtn.disabled=joinBtn.disabled=v;};
  hostBtn.onclick=()=>{
   busy(true);status.textContent=t('netConnecting');let attempts=0;
   const tryHost=()=>{
    const code=netCode();
    const tp=openTransport(code,true,{
     onReady:()=>{codeOut.textContent=code;codeRow.hidden=false;status.textContent=t('netOpen');try{history.replaceState(null,'','#'+code);}catch{}},
     // Someone else claimed this id on the public cloud — draw a fresh code.
     onError:e=>{tp.close();this.net=null;deps.onNet?.(null);
      if(e?.type==='unavailable-id'&&++attempts<5)tryHost();
      else{status.textContent=t('netError');busy(false);}},
    });
    const host=new NetHost({game:deps.game,transport:tp,localSlots:p2box.checked?[0,1]:[0],name:nameIn.value.trim(),onLobby:renderList});
    this.net=host;deps.onNet?.(host);
    renderList(host.lobby());startBtn.hidden=false;
    startBtn.onclick=()=>{const run=host.startRun(0,{difficulty:document.getElementById('difficulty').value,inputMode:deps.game.inputMode});begin(0,run.playerCount,run.players);};
   };
   tryHost();
  };
  joinBtn.onclick=()=>{
   const code=codeIn.value.trim().toUpperCase();if(code.length<4){status.textContent=t('netNoRoom');return;}
   busy(true);status.textContent=t('netConnecting');
   const tp=openTransport(code,false,{
    onReady:()=>{
     const guest=new NetGuest({game:deps.game,transport:tp,onSound:k=>AudioFX.play(k),onLobby:renderList});
     this.net=guest;deps.onNet?.(guest);
     guest.onStart=msg=>{guest.df=msg.difficulty;guest.im=msg.inputMode;begin(msg.stage??0,msg.n,msg.players,{difficulty:msg.difficulty,inputMode:msg.inputMode});};
     guest.onStage=msg=>{deps.start(msg.stage,{playerCount:msg.n,online:true,difficulty:guest.df||document.getElementById('difficulty').value,inputMode:guest.im||deps.game.inputMode});for(const p of deps.game.players)p.name=msg.players[p.id-1]?.name||defaultName(p.id);};
     // Mid-stage joiners never see 'start' — dismiss the lobby on first snapshot.
     const push=guest.pushSnap.bind(guest);guest.pushSnap=s=>{push(s);hide();};
     guest.join(nameIn.value.trim(),p2box.checked?2:1);
     status.textContent=t('netWaiting');setStatus('ONLINE');
    },
    onError:e=>{status.textContent=e?.type==='peer-unavailable'||e?.type==='timeout'?t('netNoRoom'):t('netError');busy(false);},
   });
  };
  leaveBtn.onclick=leave;
  // Deep-link support: openLobby({code,autojoin}) pre-fills and joins.
  if(deps.code){codeIn.value=deps.code;if(deps.autojoin)joinBtn.click();}
  return shade;
 },
 closeNet(){this.net?.close?.();this.net=null;this.deps?.onNet?.(null);},
};
