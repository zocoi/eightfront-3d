/* Online lobby overlay + in-game net status. Built dynamically over the
 * existing .shade/.panel styles so no shell.html surgery is needed.
 * NetUI.net holds the active NetHost/NetGuest for the app frame loop. */
const NetUI={
 net:null,panel:null,deps:null,
 el(tag,cls,text,parent){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;if(parent)parent.append(e);return e;},
 openLobby(deps){
  this.deps=deps;this.closeNet();
  const shade=this.el('section','shade','',document.body);shade.id='lobby';this.panel=shade;
  const panel=this.el('div','panel','',shade);
  this.el('div','kicker','ONLINE',panel);this.el('h2','',t('lobbyTitle'),panel);
  this.el('p','',t('lobbyNote'),panel);
  const row=this.el('div','panel-row','',panel);
  const hostBtn=this.el('button','secondary',t('netHost'),row);
  const codeIn=this.el('input','','',row);codeIn.placeholder=t('codePlaceholder');codeIn.maxLength=6;codeIn.style.cssText='width:90px;text-transform:uppercase;font:700 15px "Courier New"';
  const joinBtn=this.el('button','secondary',t('netJoin'),row);
  const p2=this.el('label','','',panel);p2.style.cssText='display:flex;gap:8px;align-items:center;margin-top:14px;font-size:12px;color:#b7cbce';
  const p2box=this.el('input','','',p2);p2box.type='checkbox';this.el('span','',t('netP2'),p2);
  const status=this.el('p','settings-note',t('netWaiting'),panel);
  const list=this.el('div','','',panel);list.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin:12px 0';
  const startBtn=this.el('button','primary',t('netStart'),panel);startBtn.hidden=true;
  const codeOut=this.el('p','','',panel);codeOut.style.cssText='font:700 18px "Courier New";letter-spacing:3px;color:var(--gold)';
  const leaveBtn=this.el('button','quiet',t('netLeave'),panel);
  const close=()=>{this.closeNet();shade.remove();};
  const renderList=players=>{
   list.replaceChildren();
   for(const m of players)for(const s of m.slots){
    const kit=squadIdentity(s+1),chip=this.el('div','','',list);
    chip.style.cssText=`border:1px solid #a1bdc33b;border-top:2px solid ${kit.accent};border-radius:5px;padding:6px 10px;font:700 11px "Courier New";color:${kit.accent}`;
    chip.textContent=`P${s+1} ${m.name||kit.call}${m.host?' ◆':''}${m.spec?' · '+t('netSpectator'):''}`;
   }
  };
  const statusEl=document.getElementById('netStatus');
  const setStatus=v=>{if(statusEl){statusEl.hidden=!v;statusEl.textContent=v||'';}};
  const begin=(n,names)=>{
   deps.start(0,{playerCount:n,online:true});
   for(const p of deps.game.players)p.name=names[p.id-1]?.name||defaultName(p.id);
   close();setStatus('ONLINE · '+n+'P');
  };
  hostBtn.onclick=()=>{
   const code=netCode();status.textContent=t('netConnecting');
   const tp=openTransport(code,true,{onReady:()=>{codeOut.textContent=code;status.textContent=t('netOpen');},onError:()=>status.textContent=t('netError')});
   const local=p2box.checked?[0,1]:[0];
   const host=new NetHost({game:deps.game,transport:tp,localSlots:local,onLobby:renderList});
   this.net=host;deps.onNet?.(host);
   renderList(host.lobby());startBtn.hidden=false;
   startBtn.onclick=()=>{const run=host.startRun(0,{difficulty:document.getElementById('difficulty').value,inputMode:deps.game.inputMode});begin(run.playerCount,run.players);};
  };
  joinBtn.onclick=()=>{
   const code=codeIn.value.trim().toUpperCase();if(code.length<4){status.textContent=t('netError');return;}
   status.textContent=t('netConnecting');
   const tp=openTransport(code,false,{onReady:()=>{
    const guest=new NetGuest({game:deps.game,transport:tp,onSound:k=>AudioFX.play(k),onLobby:renderList});
    this.net=guest;deps.onNet?.(guest);
    guest.onStart=msg=>begin(msg.n,msg.players);
    guest.onStage=msg=>{deps.game.start(msg.stage,{playerCount:msg.n,online:true});for(const p of deps.game.players)p.name=msg.players[p.id-1]?.name||defaultName(p.id);};
    guest.join('',p2box.checked?2:1);
    status.textContent=t('netWaiting');setStatus('ONLINE');
   },onError:()=>status.textContent=t('netError')});
  };
  leaveBtn.onclick=close;
  return shade;
 },
 closeNet(){this.net?.close?.();this.net=null;this.deps?.onNet?.(null);},
};
