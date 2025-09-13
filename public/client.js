import { axialToPixel, pixelToAxial, hexCorners } from '../shared/hex.js';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const ioClient = io();

const state = {
  player: null,
  iconAbbr: {},
  tiles: new Map(), // "q,r" -> {q,r,clazz,type,owner,elev}
  hexRadius: 36,
  scale: 1,
  origin: { x: canvas.width/2, y: canvas.height/2 },
  hover: null,
  credits: 0,
  tps: 0,
  lastHeartbeat: 0
};

function k(q,r){ return `${q},${r}`; }

// --- networking
ioClient.on('hello', ({ player, game, iconAbbr }) => {
  state.player = player;
  state.iconAbbr = iconAbbr;
  state.hexRadius = game.hexRadius;
  document.getElementById('player').innerHTML = `<span class="tag">You: ${player.name}</span>`;
  document.getElementById('credits').innerHTML = `<span class="tag">Credits: 0</span>`;
  for (const t of game.tiles) state.tiles.set(k(t.q,t.r), t);
  render();
});

ioClient.on('player:join', (p) => {
  // could show toast
  console.log('join', p);
});
ioClient.on('player:leave', (id) => {
  console.log('leave', id);
});

ioClient.on('tile:patch', (patch) => {
  state.tiles.set(k(patch.q, patch.r), { ...state.tiles.get(k(patch.q, patch.r)), ...patch });
  drawTile(patch.q, patch.r, state.tiles.get(k(patch.q, patch.r)));
});

ioClient.on('economy:update', ({ credits }) => {
  state.credits = credits;
  document.getElementById('credits').innerHTML = `<span class="tag">Credits: ${credits.toFixed(1)}</span>`;
});

ioClient.on('tick', ({ tick, tps, serverTime }) => {
  state.tps = tps;
  state.lastHeartbeat = serverTime;
  document.getElementById('stats').innerHTML = `<span class="tag">Tick ${tick} • ${tps} tps</span>`;
});

// --- input
canvas.addEventListener('mousemove', (e) => {
  const { x, y } = mouseToWorld(e);
  const { q, r } = pixelToAxial(x, y, state.hexRadius, { x: 0, y: 0 });
  const t = state.tiles.get(k(q, r));
  state.hover = t ? { q, r } : null;
  render();
});

canvas.addEventListener('click', async (e) => {
  const { x, y } = mouseToWorld(e);
  const { q, r } = pixelToAxial(x, y, state.hexRadius, { x: 0, y: 0 });
  const t = state.tiles.get(k(q, r));
  if (!t) return;
  ioClient.emit('tile:cycle', { q, r }, (res) => {
    if (!res?.ok) console.warn(res?.error);
  });
});

canvas.addEventListener('wheel', (e) => {
  if (!e.shiftKey) return;
  e.preventDefault();
  const d = Math.sign(e.deltaY);
  const factor = d > 0 ? 1/1.1 : 1.1;
  state.scale = clamp(state.scale * factor, 0.5, 2.5);
  render();
}, { passive:false });

let isPanning = false; let last = {x:0,y:0};
canvas.addEventListener('mousedown', (e)=>{ isPanning = true; last = {x:e.clientX, y:e.clientY}; });
window.addEventListener('mouseup', ()=>{ isPanning = false; });
window.addEventListener('mousemove', (e)=>{
  if (!isPanning) return;
  const dx = e.clientX - last.x, dy = e.clientY - last.y;
  state.origin.x += dx; state.origin.y += dy;
  last = {x:e.clientX, y:e.clientY};
  render();
});

// --- render
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const t of state.tiles.values()) drawTile(t.q, t.r, t);
  if (state.hover) {
    const { x, y } = worldToScreen(axialToPixel(state.hover.q, state.hover.r, state.hexRadius));
    strokeHex(x, y, state.hexRadius * state.scale, '#ffffff', 2);
  }
}

function drawTile(q, r, t) {
  const world = axialToPixel(q, r, state.hexRadius);
  const { x, y } = worldToScreen(world);

  // fill by class/type; rivers and oceans get special colors
  let fill = {
    empty: '#1a1f2b',
    resource: '#214026',
    city: '#2f2a46',
    terrain: '#303b44',
    military: '#3f2a2a'
  }[t.clazz] ?? '#1a1f2b';

  if (t.type === 'ocean') fill = getComputedStyle(document.documentElement).getPropertyValue('--water').trim() || '#123a5a';
  if (t.type === 'river') fill = getComputedStyle(document.documentElement).getPropertyValue('--river').trim() || '#1b4f7a';

  fillHex(x, y, state.hexRadius * state.scale, fill);
  strokeHex(x, y, state.hexRadius * state.scale, '#202635', 1);

  // Center icon circle — radius = 0.30 * hexRadius (requirement)
  const circleR = state.hexRadius * 0.30 * state.scale;
  if (t.type !== 'empty') {
    drawIconCircle(x, y, circleR, '#111822', '#8aa1ff');
    drawIconGlyph(x, y, state.iconAbbr[t.type] || '?', circleR);
  }
}

function fillHex(cx, cy, size, color) {
  ctx.beginPath();
  for (const [i, p] of hexCorners(cx, cy, size).entries()) {
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function strokeHex(cx, cy, size, color, width=1) {
  ctx.beginPath();
  for (const [i, p] of hexCorners(cx, cy, size).entries()) {
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function drawIconCircle(x, y, r, fill='#111', stroke='#888') {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.15);
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function drawIconGlyph(x, y, glyph, r) {
  ctx.font = `bold ${Math.floor(r*1.2)}px system-ui,Segoe UI,Roboto,Emoji`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#dde4ff';
  ctx.fillText(glyph, x, y);
}

// --- helpers
function mouseToWorld(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  return { x: (sx - state.origin.x) / state.scale, y: (sy - state.origin.y) / state.scale };
}
function worldToScreen({x,y}) {
  return { x: x*state.scale + state.origin.x, y: y*state.scale + state.origin.y };
}
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

// Initial draw
render();
