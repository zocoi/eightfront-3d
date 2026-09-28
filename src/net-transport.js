/* Transports for room connections. Both expose the same surface:
 *   send(connId,msg) — 'host' is the reserved connId on guests
 *   broadcast(msg)   — host only
 *   onmessage(fn(connId,msg)) / onclose(fn(connId)) / close()
 * cbs.onReady() fires once the transport can carry traffic: for the host that's
 * when the room id is registered, for a guest when the data channel to the host
 * is open — so sends made inside onReady are always safe.
 * LocalTransport (BroadcastChannel) is the zero-network dev/test path; ?local
 * forces it. PeerTransport wraps the vendored PeerJS DataConnection API. */

function netCode(){const a='ABCDEFGHJKMNPQRSTUVWXYZ23456789';return Array.from({length:5},()=>a[Math.floor(Math.random()*a.length)]).join('');}

class LocalTransport{
 // BroadcastChannel can't address peers, so every post carries to/from and
 // receivers filter. Guests discover the host by posting {t:'ping'}.
 constructor(code,host,{onReady=()=>{}}={}){
  this.host=host;this.id=host?'host':'g'+Math.random().toString(36).slice(2,9);
  this.ch=new BroadcastChannel('ef3-room-'+code);this.peers=new Set();
  this.msgFn=()=>{};this.closeFn=()=>{};this.closed=false;
  this.ch.onmessage=e=>{const m=e.data;if(!m||m.to!==this.id&&m.to!=='*')return;
   if(m.msg?.t==='ping'&&this.host){this.peers.add(m.from);this.send(m.from,{t:'pong'});this.msgFn(m.from,{k:'ping'});return;}
   if(m.msg?.t==='pong'&&!this.host)return;
   this.msgFn(m.from,m.msg);};
  // Always ready — defer so callers can bind onmessage first.
  queueMicrotask(()=>{if(!this.closed)onReady();});
 }
 send(to,msg){if(!this.closed)this.ch.postMessage({to,from:this.id,msg});}
 broadcast(msg){this.send('*',msg);}
 onmessage(fn){this.msgFn=fn;}
 onclose(fn){this.closeFn=fn;}
 close(){if(this.closed)return;this.closed=true;try{this.ch.close();}catch{}}
}

class PeerTransport{
 // Room id on the public PeerJS cloud is ef3-<CODE>. Guests connect to it
 // directly; the host accepts connections. ?peer=host:port overrides the
 // signaling server for local development (e.g. peer=localhost:9000).
 constructor(code,host,{onReady=()=>{},onError=()=>{},timeout=15000}={}){
  this.host=host;this.id=host?'host':null;this.conns=new Map();this.closed=false;
  this.msgFn=()=>{};this.closeFn=()=>{};this.ready=false;
  const opt={debug:0};
  const ov=new URLSearchParams(location.search).get('peer');
  if(ov){const[h,p]=ov.split(':');Object.assign(opt,{host:h,port:+p||9000,secure:false,path:'/'});}
  let peer;
  try{peer=this.peer=new Peer(host?'ef3-'+code:undefined,opt);}
  catch(e){onError(e);return;}
  // Default 15 s to claim/register an id (host) or open the data channel
  // (guest), matching the pacing pac-hunt uses before declaring the room
  // unreachable. Override via the timeout option if needed.
  this.timer=setTimeout(()=>{if(!this.ready){this.ready=true;onError({type:'timeout'});this.close();}},timeout);
  const ready=()=>{if(this.ready||this.closed)return;this.ready=true;clearTimeout(this.timer);onReady();};
  // Signaling hiccups shouldn't kill an established game — reconnect like
  // pac-hunt does instead of tearing the room down.
  peer.on('disconnected',()=>{if(!this.closed&&!peer.destroyed)try{peer.reconnect();}catch{}});
  peer.on('error',e=>{
   if(this.closed)return;
   if(!this.ready){clearTimeout(this.timer);onError(e);return;}
   if(host)return; // host tolerates post-open signaling errors
   if(e.type==='network'||e.type==='server-error'||e.type==='socket-error'){this.conns.clear();this.closeFn('host');}
  });
  if(host){
   peer.on('open',ready);
   peer.on('connection',c=>{
    c.on('open',()=>{this.conns.set(c.peer,c);this.msgFn(c.peer,{k:'ping'});});
    c.on('data',d=>this.msgFn(c.peer,d));
    c.on('close',()=>{this.conns.delete(c.peer);this.closeFn(c.peer);});
    c.on('error',()=>{this.conns.delete(c.peer);this.closeFn(c.peer);});
   });
  }else{
   peer.on('open',id=>{
    this.id=id;
    const c=this.conn=peer.connect('ef3-'+code,{reliable:true});
    // onReady waits for the channel to open — PeerJS drops sends made earlier.
    c.on('open',ready);
    c.on('data',d=>this.msgFn('host',d));
    c.on('close',()=>{this.conns.delete('host');this.closeFn('host');});
    c.on('error',e=>{if(!this.ready){clearTimeout(this.timer);onError(e);}else{this.conns.delete('host');this.closeFn('host');}});
   });
  }
 }
 send(to,msg){const c=this.conns.get(to);if(c&&c.open)try{c.send(msg);}catch{}}
 broadcast(msg){for(const c of this.conns.values())if(c.open)try{c.send(msg);}catch{}}
 onmessage(fn){this.msgFn=fn;}
 onclose(fn){this.closeFn=fn;}
 close(){if(this.closed)return;this.closed=true;clearTimeout(this.timer);try{this.peer?.destroy();}catch{}}
}

// ?local forces BroadcastChannel; PeerTransport needs the vendored Peer global
// and http(s) (file:// can't reach signaling anyway — BroadcastChannel still
// works on file:// tabs in the same browser).
function openTransport(code,host,cbs){
 const forceLocal=new URLSearchParams(location.search).has('local');
 const canPeer=typeof Peer==='function'&&!forceLocal&&/^https?:/.test(location.protocol);
 return canPeer?new PeerTransport(code,host,cbs):new LocalTransport(code,host,cbs);
}
