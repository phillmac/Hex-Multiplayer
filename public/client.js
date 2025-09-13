import { axialToPixel, pixelToAxial, hexCorners, chunkFor, CHUNK } from '../shared/hex.js';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const ioClient = io();

const state = {
  player: null,
  iconAbbr: {},
  hexRadius: 36,
  scale: 1,
  origin: { x: canvas.width/2, y: canvas.height/2 },
  tiles: new Map(),           // "q,r" -> tile
  loadedChunks: new Set(),    // "cq,cr"
  credits: 0,
  tps: 0,
  lastHeartbeat: 0
};

function k(q,r){ return `${q},${r}`; }
function ck(cq,cr){ return `${cq},${cr}`; }

// --- networking
ioClient.on('hello', ({ player, game, iconAbbr }) => {
  state.player = player;
  state.iconAbbr = iconAbbr;
  state.hexRadius = game.hexRadius;
  document.getElementById('player').innerHTML = `<span class="tag">You: ${player.name}</span>`;
  document.getElementById('credits').innerHTML = `<span class="tag">Credits: 0</span>`;
  ensureChunksInView(); // kick off streaming
  render();
});

ioClient.on('chunk:data', ({ cq, cr, tiles }) => {
  for (const t of tiles) state.tiles.set(k(t.q,t.r), t);
  state.loadedChunks.add(ck(cq,cr));
  render();
});

ioClient.on('tile:patch', (patch) => {
  state.tiles.set(k(patch.q, patch.r), { ...state.tiles.get(k(patch.q, patch.r)), ...patch });
  drawTile(patch.q, patch.r, state.tiles.get(k(patch.q, patch.r)));
});

ioClient.on('economy:update', ({ credits }) => {
  state.credits += credits; // accumulate deltas
  document.getElementById('credits').innerHTML = `<span class="tag">Credits: ${state.credits.toFixed(1)}</span>`;
});

ioClient.on('tick', ({ tps, serverTime }) => {
  state.tps = tps;
  state.lastHeartbeat = serverTime;
  document.getElementById('stats').innerHTML = `<span class="tag">${tps} tps</span>`;
});

// --- input
canvas.addEventListener('mousemove', (e) => {
  ensureChunksInView();
  render();
});

canvas.addEventListener('click', async (e) => {
  const { q, r } = mouseAxial(e);
  const t = state.tiles.get(k(q, r));
  if (!t) return; // might not be loaded yet
  ioClient.emit('tile:cycle', { q, r }, (res) => {
    if (!res?.ok) console.warn(res?.error);
  });
});

canvas.addEventListener('wheel', (e) => {
  if (!e.shiftKey) return;
  e.preventDefault();
  const d = Math.sign(e.deltaY);
  const factor = d > 0 ? 1/1.1 : 1.1;
  state.scale = clamp(state.scale * factor, 0.35, 3.0);
  ensureChunksInView();
  render();
}, { passive:false });

// --- keyboard pan (arrow keys)
const PAN_STEP = 50; // pixels at scale=1
window.addEventListener('keydown', (e) => {
  const k = e.key; // 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
  if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
    e.preventDefault(); // stop page from scrolling
    const step = (e.shiftKey ? 3 : 1) * PAN_STEP;
    if (k === 'ArrowLeft')  state.origin.x += step;      // camera left => world right
    if (k === 'ArrowRight') state.origin.x -= step;      // camera right => world left
    if (k === 'ArrowUp')    state.origin.y += step;      // camera up => world down
    if (k === 'ArrowDown')  state.origin.y -= step;      // camera down => world up
    ensureChunksInView();
    render();
  }
});


function ensureChunksInView(){
  // Determine world-space corners of the canvas and request any missing chunks
  const corners = [
    screenToWorld(0,0),
    screenToWorld(canvas.width,0),
    screenToWorld(canvas.width,canvas.height),
    screenToWorld(0,canvas.height)
  ];
  const ar = corners.map(p => pixelToAxial(p.x, p.y, state.hexRadius, {x:0,y:0}));
  const qMin = Math.min(...ar.map(a=>a.q)) - 1;
  const qMax = Math.max(...ar.map(a=>a.q)) + 1;
  const rMin = Math.min(...ar.map(a=>a.r)) - 1;
  const rMax = Math.max(...ar.map(a=>a.r)) + 1;

  const cqMin = Math.floor(qMin / CHUNK.W);
  const cqMax = Math.floor(qMax / CHUNK.W);
  const crMin = Math.floor(rMin / CHUNK.H);
  const crMax = Math.floor(rMax / CHUNK.H);

  for (let cr=crMin; cr<=crMax; cr++){
    for (let cq=cqMin; cq<=cqMax; cq++){
      const key = ck(cq,cr);
      if (!state.loadedChunks.has(key)){
        state.loadedChunks.add(key);
        ioClient.emit('chunk:request', { cq, cr });
      }
    }
  }
}

// --- render
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const t of state.tiles.values()) {
    const world = axialToPixel(t.q, t.r, state.hexRadius);
    const { x, y } = worldToScreen(world);
    if (x < -100 || y < -100 || x > canvas.width+100 || y > canvas.height+100) continue;
    drawTile(t.q, t.r, t);
  }

  const { q, r } = mouseAxial();
  const world = axialToPixel(q, r, state.hexRadius);
  const { x, y } = worldToScreen(world);
  strokeHex(x, y, state.hexRadius * state.scale, '#ffffff', 2);
}

function drawTile(q, r, t) {
  const world = axialToPixel(q, r, state.hexRadius);
  const { x, y } = worldToScreen(world);

  let fill = {
    empty: '#1a1f2b',
    resource: '#214026',
    city: '#2f2a46',
    terrain: '#303b44',
    military: '#3f2a2a'
  }[t.clazz] ?? '#1a1f2b';

  if (t.type === 'lake') fill = getComputedStyle(document.documentElement).getPropertyValue('--water').trim() || '#123a5a';
  if (t.type === 'river') fill = getComputedStyle(document.documentElement).getPropertyValue('--river').trim() || '#1b4f7a';

  fillHex(x, y, state.hexRadius * state.scale, fill);
  strokeHex(x, y, state.hexRadius * state.scale, '#202635', 1);

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
function mouseAxial(e) {
  const p = e ? mouseToWorld(e) : { x: (lastMouseX - canvas.getBoundingClientRect().left - state.origin.x) / state.scale, y: (lastMouseY - canvas.getBoundingClientRect().top - state.origin.y) / state.scale };
  const a = pixelToAxial(p.x, p.y, state.hexRadius, { x: 0, y: 0 });
  if (e){ lastMouseX = e.clientX; lastMouseY = e.clientY; }
  return a;
}
let lastMouseX=0, lastMouseY=0;

function screenToWorld(sx,sy){ return { x: (sx - state.origin.x) / state.scale, y: (sy - state.origin.y) / state.scale }; }
function mouseToWorld(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  return screenToWorld(sx,sy);
}
function worldToScreen({x,y}) { return { x: x*state.scale + state.origin.x, y: y*state.scale + state.origin.y }; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

render();
