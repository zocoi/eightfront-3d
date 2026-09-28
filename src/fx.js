/* Cosmetic particle recipes driven by serial'd visual events.
 * The simulation emits events; this layer turns them into particles identically
 * on the host and on every remote client (each recipe is seeded by ev.seed),
 * so no particle state ever crosses the network. */
function spawnEventFx(g,ev){
 if(!ev||!g.particles)return;
 let s=(ev.seed||1)*2654435761>>>0;const rnd=()=>{s=(Math.imul(s,1664525)+1013904223)|0;return(s>>>0)/4294967296;};
 const push=a=>{if(g.particles.length>=280)g.particles.shift();g.particles.push(a);};
 if(ev.kind==='blast'){
  const n=ev.big?28:12;
  for(let i=0;i<n;i++){const a=rnd()*Math.PI*2,v=(1+rnd()*4)*(ev.big?1.4:1);push({x:ev.x,y:ev.y,z:ev.z,age:0,life:.25+rnd()*.5,vx:Math.cos(a)*v,vy:Math.sin(a)*v+2,vz:(rnd()-.5)*3,size:.045+rnd()*.07,color:'#ffe4a6',kind:'spark'});}
  for(let i=0;i<(ev.big?9:4);i++)push({x:ev.x+(rnd()-.5)*.5,y:ev.y,z:ev.z,age:0,life:.35+rnd()*.45,vx:(rnd()-.5)*1.5,vy:1+rnd(),vz:0,size:(ev.big?.55:.25)+rnd()*.3,color:i%2?'#ffcd78':'#fa8751',kind:'fire'});
  push({x:ev.x,y:ev.y+.25,z:ev.z,age:0,life:ev.big?.9:.55,vx:0,vy:.8,vz:0,size:ev.big?.75:.35,color:'#526066',kind:'smoke'});
 }else if(ev.kind==='impact'){
  const palettes={metal:['#f9d792','#bbc9ce'],stone:['#8b988d','#b4b7a5'],flesh:['#835054','#b67769'],organic:['#74968b','#a2b289']};
  const colors=palettes[ev.surface]||palettes.metal,n=ev.n||5;
  for(let i=0;i<n;i++){const a=rnd()*6.283,v=(ev.surface==='metal'?3.8:1.6)*(.35+rnd());
   push({x:ev.x,y:ev.y,z:ev.z,age:0,life:ev.surface==='metal'?.18+rnd()*.19:.30+rnd()*.30,vx:Math.cos(a)*v,vy:Math.sin(a)*v+1.2,vz:(rnd()-.5)*1.8,size:ev.surface==='metal'?.036+rnd()*.035:.07+rnd()*.07,color:colors[i%2],kind:ev.surface==='metal'?'spark':ev.surface==='stone'?'dust':'debris',surface:ev.surface});}
 }else if(ev.kind==='burst'){
  for(let i=0;i<(ev.n||10);i++){const a=rnd()*Math.PI*2,v=(1+rnd()*4)*(ev.big?1.4:1);push({x:ev.x,y:ev.y,z:ev.z,age:0,life:.25+rnd()*.5,vx:Math.cos(a)*v,vy:Math.sin(a)*v+2,vz:(rnd()-.5)*3,size:.045+rnd()*.07,color:ev.col||'#ffc67e',kind:'spark'});}
 }else if(ev.kind==='puff'){
  push({x:ev.x,y:ev.y,z:ev.z,age:0,life:ev.life||.65,vx:0,vy:.5,vz:0,size:ev.size||.5,color:ev.col||'#526066',kind:'smoke'});
 }
}
function stepParticles(g,dt){
 for(const a of g.particles){a.age+=dt;a.x+=a.vx*dt;a.y+=a.vy*dt;a.z+=a.vz*dt;if(['spark','debris'].includes(a.kind))a.vy-=13*dt;if(a.kind==='dust')a.vy*=Math.exp(-dt*3);}
 g.particles=g.particles.filter(a=>a.age<a.life);
}
