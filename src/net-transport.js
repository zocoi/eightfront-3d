/* Transports for room connections. Both expose the same surface:
 *   send(connId,msg) — 'host' is the reserved connId on guests
 *   broadcast(msg)   — host only
 *   onmessage(fn(connId,msg)) / onclose(fn(connId)) / close()
 * LocalTransport (BroadcastChannel) is the zero-network dev/test path; ?local
 * forces it. PeerTransport wraps the vendored PeerJS DataConnection API. */

function netCode(){const a='ABCDEFGHJKMNPQRSTUVWXYZ23456789';return Array.from({length:5},()=>a[Math.floor(Math.random()*a.length)]).join('');}

class LocalTransport{
 // BroadcastChannel can't address peers, so every post carries to/from and
 // receivers filter. Guests discover the host by posting {t:'ping'}.
 constructor(code,host){
  this.host=host;this.id=host?'host':'g'+Math.random().toString(36).slice(2,9);
  this.ch=new BroadcastChannel('ef3-room-'+code);this.peers=new Set();
  this.msgFn=()=>{};this.closeFn=()=>{};this.closed=false;
  this.ch.onmessage=e=>{const m=e.data;if(!m||m.to!==this.id&&m.to!=='*')return;
   if(m.msg?.t==='ping'&&this.host){this.peers.add(m.from);this.send(m.from,{t:'pong'});this.msgFn(m.from,{k:'ping'});return;}
   if(m.msg?.t==='pong'&&!this.host)return;
   this.msgFn(m.from,m.msg);};
 }
 send(to,msg){if(!this.closed)this.ch.postMessage({to,from:this.id,msg});}
 broadcast(msg){this.send('*',msg);}
 onmessage(fn){this.msgFn=fn;}
 onclose(fn){this.closeFn=fn;}
 close(){if(this.closed)return;this.closed=true;try{this.broadcast({t:'bye-now'})}catch{}this.ch.close();}
}

class PeerTransport{
 // Room id on the public PeerJS cloud is ef3-<CODE>. Guests connect to it
 // directly; the host accepts connections. ?peer=host:port overrides the
 // signaling server for local development (e.g. peer=localhost:9000).
 constructor(code,host,{onReady=()=>{},onError=()=>{}}={}){
  this.host=host;this.id=host?'host':null;this.conns=new Map();this.closed=false;
  this.msgFn=()=>{};this.closeFn=()=>{};this.ready=false;
  const opt={debug:0};
  const ov=new URLSearchParams(location.search).get('peer');
  if(ov){const[h,p]=ov.split(':');Object.assign(opt,{host:h,port:+p||9000,secure:false,path:'/'});}
  if(host){
   this.peer=new Peer('ef3-'+code,opt);
   this.peer.on('open',()=>{this.ready=true;onReady();});
   this.peer.on('connection',c=>{
    c.on('open',()=>{this.conns.set(c.peer,c);this.msgFn(c.peer,{k:'ping'});});
    c.on('data',d=>this.msgFn(c.peer,d));
    c.on('close',()=>{this.conns.delete(c.peer);this.closeFn(c.peer);});
    c.on('error',()=>{this.conns.delete(c.peer);this.closeFn(c.peer);});
   });
   this.peer.on('error',onError);
  }else{
   this.peer=new Peer(opt);
   this.peer.on('open',id=>{
    this.id=id;
    const c=this.peer.connect('ef3-'+code,{reliable:true});
    this.conn=c;
    c.on('open',()=>{this.conns.set('host',c);this.ready=true;onReady();});
    c.on('data',d=>this.msgFn('host',d));
    c.on('close',()=>{this.conns.delete('host');this.closeFn('host');});
    c.on('error',e=>onError(e));
   });
   this.peer.on('error',onError);
  }
 }
 send(to,msg){const c=this.conns.get(to);if(c&&c.open)c.send(msg);}
 broadcast(msg){for(const c of this.conns.values())if(c.open)c.send(msg);}
 onmessage(fn){this.msgFn=fn;}
 onclose(fn){this.closeFn=fn;}
 close(){if(this.closed)return;this.closed=true;try{this.peer?.destroy();}catch{}}
}

// ?local forces BroadcastChannel; PeerTransport needs the vendored Peer global
// and http(s) (file:// can't reach signaling anyway — BroadcastChannel still
// works on file:// tabs in the same browser).
function openTransport(code,host,cbs){
 const forceLocal=new URLSearchParams(location.search).has('local');
 const canPeer=typeof Peer==='function'&&!forceLocal&&/^https?:/.test(location.protocol);
 return canPeer?new PeerTransport(code,host,cbs):new LocalTransport(code,host);
}
