/* Squad identity roster. Every player slot owns one authored identity: a callsign,
 * a three-part commando palette (band / pants / vest shader uniforms), a HUD accent
 * and a rifle-tracer tint. Slots are stable for a connection's lifetime, so colour
 * and name never change mid-stage. Keep hues pairwise separable for common
 * colour-vision differences; secondary differentiators are palette combos and the
 * overhead name tag, never hue alone. */
const SQUAD_MAX=10;
const SQUAD=Object.freeze([
 Object.freeze({call:'VIPER',band:'#42c3e5',pants:'#364c59',vest:'#78857a',accent:'#4dc3e8',tracer:'#bff0ff'}),
 Object.freeze({call:'BLAZE',band:'#e8432c',pants:'#4a2d33',vest:'#9b7050',accent:'#ff7857',tracer:'#9be9ff'}),
 Object.freeze({call:'ORCA', band:'#f0a03c',pants:'#4d4028',vest:'#8a7f58',accent:'#f5b04c',tracer:'#ffe08a'}),
 Object.freeze({call:'NOVA', band:'#2fd0a8',pants:'#1e4a44',vest:'#5d8a72',accent:'#43e0b4',tracer:'#c2ffe9'}),
 Object.freeze({call:'JOLT', band:'#9d7bff',pants:'#3a2f52',vest:'#6f6288',accent:'#a98aff',tracer:'#e6d4ff'}),
 Object.freeze({call:'SABLE',band:'#a8d94a',pants:'#3b4a1e',vest:'#7d8555',accent:'#b5e356',tracer:'#eaffab'}),
 Object.freeze({call:'FROST',band:'#ff6fc0',pants:'#4d2d44',vest:'#8a5d78',accent:'#ff86c9',tracer:'#ffd4f0'}),
 Object.freeze({call:'ROOK', band:'#e8e8e0',pants:'#4a4a44',vest:'#8f8f85',accent:'#efefe6',tracer:'#ffffff'}),
 Object.freeze({call:'GALE', band:'#5d8de8',pants:'#2e3c56',vest:'#5f6f85',accent:'#6f9bf0',tracer:'#cfe0ff'}),
 Object.freeze({call:'DUNE', band:'#c98a4a',pants:'#4a3a26',vest:'#8a744f',accent:'#e0a35c',tracer:'#ffe6bd'})
]);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function squadIdentity(slot){return SQUAD[Math.max(0,(slot-1)%SQUAD.length)];}
function squadAccent(slot){return squadIdentity(slot).accent;}
function defaultName(slot){return squadIdentity(slot).call;}
function playerName(p){return (p&&p.name)||defaultName(p?.id||1);}
