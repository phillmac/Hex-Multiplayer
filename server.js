import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import { neighborsAxial } from './shared/hex.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

// Serve static assets
app.use(express.static('public'));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

// --------------------------- Game model --------------------------------------
const TILE_CLASS = {
  EMPTY: 'empty',
  RESOURCE: 'resource',
  CITY: 'city',
  TERRAIN: 'terrain',
  MILITARY: 'military'
};

const TILE_TYPE = {
  // resource / industrial
  FARM: 'farm', MINE: 'mine', SAWMILL: 'sawmill', FLOUR_MILL: 'flour_mill',
  // city
  CITY: 'city',
  // terrain
  MOUNTAIN: 'mountain', RIVER: 'river', LAKE: 'lake', CANYON: 'canyon', SWAMP: 'swamp',
  // military
  FORT: 'fort', BARRACKS: 'barracks', WAR_FACTORY: 'war_factory', AIRBASE: 'airbase', SHIPYARD: 'shipyard',
  // empty
  EMPTY: 'empty'
};

const CLASS_TO_TYPES = {
  [TILE_CLASS.EMPTY]: [TILE_TYPE.EMPTY],
  [TILE_CLASS.RESOURCE]: [TILE_TYPE.FARM, TILE_TYPE.MINE, TILE_TYPE.SAWMILL, TILE_TYPE.FLOUR_MILL],
  [TILE_CLASS.CITY]: [TILE_TYPE.CITY],
  [TILE_CLASS.TERRAIN]: [TILE_TYPE.MOUNTAIN, TILE_TYPE.RIVER, TILE_TYPE.LAKE, TILE_TYPE.CANYON, TILE_TYPE.SWAMP],
  [TILE_CLASS.MILITARY]: [TILE_TYPE.FORT, TILE_TYPE.BARRACKS, TILE_TYPE.WAR_FACTORY, TILE_TYPE.AIRBASE, TILE_TYPE.SHIPYARD]
};

// Distinct icons: lake = 🌊, river = 🏞️
const ICON_ABBR = {
  [TILE_TYPE.EMPTY]: '',
  [TILE_TYPE.FARM]: '🌾', [TILE_TYPE.MINE]: '⛏', [TILE_TYPE.SAWMILL]: '🪵', [TILE_TYPE.FLOUR_MILL]: '⚙',
  [TILE_TYPE.CITY]: '🏙',
  [TILE_TYPE.MOUNTAIN]: '⛰', [TILE_TYPE.RIVER]: '🏞️', [TILE_TYPE.CANYON]: '🕳', [TILE_TYPE.LAKE]: '🌊', [TILE_TYPE.SWAMP]: '🦟',
  [TILE_TYPE.FORT]: '🏰', [TILE_TYPE.BARRACKS]: '🏗', [TILE_TYPE.WAR_FACTORY]: '🏭', [TILE_TYPE.AIRBASE]: '✈️', [TILE_TYPE.SHIPYARD]: '⚓'
};

// Simple economy (unchanged)
const TYPE_CREDITS_PER_SEC = {
  [TILE_TYPE.FARM]: 2,
  [TILE_TYPE.MINE]: 3,
  [TILE_TYPE.SAWMILL]: 2,
  [TILE_TYPE.FLOUR_MILL]: 2,
  [TILE_TYPE.CITY]: 1,
  [TILE_TYPE.FORT]: -0.5,
  [TILE_TYPE.BARRACKS]: -0.5,
  [TILE_TYPE.WAR_FACTORY]: -1,
  [TILE_TYPE.AIRBASE]: -1,
  [TILE_TYPE.SHIPYARD]: -0.5
};

// --------------------------- Infinite world config ---------------------------
const GAME = {
  id: uuidv4(),
  hexRadius: 36,
  tps: 10
};

const CHUNK_W = 24;     // axial-rect
const CHUNK_H = 24;
const FEATURE_STRIDE = 64; // supercells for feature seeds (lakes)

// cache
const chunkCache = new Map();     // "cq,cr" -> { tiles: Tile[] }
const tileOverrides = new Map();  // "q,r" -> {clazz,type,owner}

// RNG helpers
let WORLD_SEED = hashStrToInt(GAME.id);
function hashStrToInt(str){ let h=2166136261>>>0; for (let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619);} return h>>>0; }
function rngSeeded(a,b){ // 2D hash -> uint
  let t = (a*73856093) ^ (b*19349663) ^ WORLD_SEED; t >>>=0;
  t = Math.imul(t ^ (t>>>15), 1|t);
  t ^= t + Math.imul(t ^ (t>>>7), 61|t);
  return (t ^ (t>>>14))>>>0;
}
function randUnit(a,b){ return rngSeeded(a,b) / 0xFFFFFFFF; }
function randRangeInt(a,b,c,d){ // integer in [c,d], hashed by (a,b)
  const u = randUnit(a,b); return c + Math.floor(u * (d-c+1)); }

// value-ish noise from axial coords (q,r)
function valueNoise(q,r,scale=32){
  const x = q/scale, y = r/scale;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = x0+1, y1 = y0+1;
  const sx = x - x0, sy = y - y0;
  function v(ix,iy){ return randUnit(ix,iy); }
  const n0 = lerp(v(x0,y0), v(x1,y0), smoothstep(sx));
  const n1 = lerp(v(x0,y1), v(x1,y1), smoothstep(sx));
  return lerp(n0, n1, smoothstep(sy)); // [0,1]
}
function smoothstep(t){ return t*t*(3-2*t); }
function lerp(a,b,t){ return a + (b-a)*t; }

// multi-octave terrain elevation ~[0,1]
function elevation(q,r){
  const n1 = valueNoise(q,r,48);
  const n2 = valueNoise(q+1000,r-1000,24);
  const n3 = valueNoise(q-777,r+333,12);
  let e = 0.6*n1 + 0.3*n2 + 0.1*n3;
  return e; // 0..1
}

// Lake feature centers per FEATURE_STRIDE cell
function lakeCentersForFeatureCell(fq, fr){
  const count = randRangeInt(fq*2+17, fr*3-9, 0, 2);
  const centers = [];
  for (let i=0;i<count;i++){
    const offQ = randRangeInt(fq+i, fr-i, 0, FEATURE_STRIDE-1) - Math.floor(FEATURE_STRIDE/2);
    const offR = randRangeInt(fq-i*7, fr+i*11, 0, FEATURE_STRIDE-1) - Math.floor(FEATURE_STRIDE/2);
    const centerQ = fq*FEATURE_STRIDE + offQ;
    const centerR = fr*FEATURE_STRIDE + offR;
    const size = randRangeInt(centerQ, centerR, 5, 10);
    centers.push({ q:centerQ, r:centerR, size });
  }
  return centers;
}

// BFS growth to produce a lake cell set of given size
function lakeCells(center, maxCells){
  const visited = new Set([key(center.q, center.r)]);
  const cells = [{q:center.q, r:center.r}];
  const frontier = [{q:center.q, r:center.r}];
  while (cells.length < maxCells && frontier.length){
    const candidates = [];
    for (const f of frontier){
      for (const nb of neighborsAxial(f.q, f.r)){
        const k = key(nb.q, nb.r);
        if (visited.has(k)) continue;
        visited.add(k);
        candidates.push(nb);
      }
    }
    if (!candidates.length) break;
    candidates.sort((a,b)=> rngSeeded(a.q,a.r) - rngSeeded(b.q,b.r));
    const chosen = candidates[0];
    cells.push(chosen);
    frontier.push(chosen);
    if (frontier.length > 32) frontier.shift();
  }
  return cells;
}

function lakesAffectingChunk(cq, cr){
  const qMin = cq*CHUNK_W, qMax = qMin + CHUNK_W - 1;
  const rMin = cr*CHUNK_H, rMax = rMin + CHUNK_H - 1;
  const fQMin = Math.floor((qMin) / FEATURE_STRIDE)-1;
  const fQMax = Math.floor((qMax) / FEATURE_STRIDE)+1;
  const fRMin = Math.floor((rMin) / FEATURE_STRIDE)-1;
  const fRMax = Math.floor((rMax) / FEATURE_STRIDE)+1;
  const lakeSets = [];
  for (let fq=fQMin; fq<=fQMax; fq++){
    for (let fr=fRMin; fr<=fRMax; fr++){
      const centers = lakeCentersForFeatureCell(fq, fr);
      for (const c of centers){
        const cells = lakeCells(c, c.size);
        lakeSets.push({ center:c, cells });
      }
    }
  }
  return lakeSets;
}

function riversForChunk(cq, cr, lakeSets){
  const rivers = new Set();
  const qMin = cq*CHUNK_W, qMax = qMin + CHUNK_W - 1;
  const rMin = cr*CHUNK_H, rMax = rMin + CHUNK_H - 1;

  function isLake(q,r){
    for (const ls of lakeSets){
      for (const c of ls.cells){
        if (c.q===q && c.r===r) return true;
      }
    }
    return false;
  }
  function nearestLakeCenter(q,r){
    let best=null, bestD=Infinity;
    for (const ls of lakeSets){
      const c = ls.center;
      const d = axialDist(q,r,c.q,c.r);
      if (d<bestD){ bestD=d; best=c; }
    }
    return best;
  }

  for (let r=rMin; r<=rMax; r++){
    for (let q=qMin; q<=qMax; q++){
      const elev = elevation(q,r);
      const high = elev > 0.72 && randUnit(q,r) > 0.7;
      if (!high || isLake(q,r)) continue;
      const pathLen = 12 + Math.floor(randUnit(q*7,r*7)*16);
      let cur = {q,r};
      const visited = new Set();
      let steps=0;
      while (steps<pathLen && !isLake(cur.q,cur.r)){
        rivers.add(key(cur.q,cur.r));
        visited.add(key(cur.q,cur.r));
        const target = nearestLakeCenter(cur.q, cur.r);
        const nbs = neighborsAxial(cur.q, cur.r).map(nb=>{
          const e = elevation(nb.q, nb.r);
          const dLake = axialDist(nb.q, nb.r, target.q, target.r);
          const score = dLake - 0.25*(elev - e) + 0.1*(randUnit(nb.q,nb.r)-0.5);
          return { nb, score };
        });
        nbs.sort((a,b)=> a.score - b.score);
        const next = nbs.find(x=>!visited.has(key(x.nb.q,x.nb.r))) || nbs[0];
        cur = next.nb;
        steps++;
        if (isLake(cur.q,cur.r)){ rivers.add(key(cur.q,cur.r)); break; }
      }
    }
  }
  return rivers;
}

function axialDist(q1,r1,q2,r2){
  const s1 = -q1 - r1, s2 = -q2 - r2;
  return Math.max(Math.abs(q1-q2), Math.abs(r1-r2), Math.abs(s1-s2));
}

function key(q, r) { return `${q},${r}`; }
function chunkKey(cq, cr){ return `${cq},${cr}`; }

function generateChunk(cq, cr){
  const ck = chunkKey(cq,cr);
  const cached = chunkCache.get(ck);
  if (cached) return cached;

  const lakeSets = lakesAffectingChunk(cq, cr);
  const riverCells = riversForChunk(cq, cr, lakeSets);

  const tiles = [];
  const qMin = cq*CHUNK_W, qMax = qMin + CHUNK_W - 1;
  const rMin = cr*CHUNK_H, rMax = rMin + CHUNK_H - 1;

  const lakeLookup = new Set();
  for (const ls of lakeSets){ for (const c of ls.cells){ lakeLookup.add(key(c.q,c.r)); } }

  for (let r=rMin; r<=rMax; r++){
    for (let q=qMin; q<=qMax; q++){
      let clazz = 'empty';
      let type = 'empty';
      if (lakeLookup.has(key(q,r))){
        clazz = 'terrain'; type = 'lake';
      } else if (riverCells.has(key(q,r))){
        clazz = 'terrain'; type = 'river';
      } else {
        const elev = elevation(q,r);
        if (elev > 0.85 && randUnit(q,r) > 0.6){ clazz = 'terrain'; type = 'mountain'; }
      }
      const ov = tileOverrides.get(key(q,r));
      if (ov){ clazz = ov.clazz; type = ov.type; }
      tiles.push({ q, r, clazz, type, owner: ov?.owner ?? null });
    }
  }

  const chunk = { cq, cr, tiles };
  chunkCache.set(ck, chunk);
  return chunk;
}

// --------------------------- Networking --------------------------------------
io.on('connection', (socket) => {
  const player = { id: socket.id, name: `P${socket.id.slice(0,4)}`, color: randomColor(), credits: 0 };
  io.to(socket.id).emit('hello', { player, game: { id: GAME.id, hexRadius: GAME.hexRadius }, iconAbbr: ICON_ABBR });

  socket.on('chunk:request', ({ cq, cr }) => {
    const chunk = generateChunk(cq, cr);
    socket.emit('chunk:data', { cq, cr, tiles: chunk.tiles });
  });

  socket.on('tile:update', (payload, ack) => {
    try {
      const { q, r, clazz, type } = payload;
      if (!CLASS_TO_TYPES[clazz]?.includes(type)) throw new Error('type not valid for class');
      const ov = tileOverrides.get(key(q,r)) || { owner: socket.id };
      ov.clazz = clazz; ov.type = type; ov.owner = socket.id;
      tileOverrides.set(key(q,r), ov);
      io.emit('tile:patch', { q, r, clazz, type, owner: ov.owner });
      ack?.({ ok: true });
    } catch (e) { ack?.({ ok: false, error: e.message }); }
  });

  socket.on('tile:cycle', ({ q, r }, ack) => {
    const classes = Object.values(TILE_CLASS);
    const ov = tileOverrides.get(key(q,r)) || { clazz: 'empty', type: 'empty' };
    let cIdx = classes.indexOf(ov.clazz);
    cIdx = (cIdx + 1) % classes.length;
    const clazz = classes[cIdx];
    const types = CLASS_TO_TYPES[clazz];
    const type = types[0] ?? 'empty';
    ov.clazz = clazz; ov.type = type; ov.owner = socket.id;
    tileOverrides.set(key(q,r), ov);
    io.emit('tile:patch', { q, r, clazz, type, owner: ov.owner });
    ack?.({ ok: true });
  });
});

function randomColor() {
  const h = Math.floor(Math.random()*360);
  return `hsl(${h} 70% 55%)`;
}

// --------------------------- RTS Tick Loop -----------------------------------
const TICK_HZ = GAME.tps;
const MS_PER_TICK = Math.floor(1000 / TICK_HZ);
let lastTime = Date.now();
let accumulator = 0;

function serverLoop(){
  const now = Date.now();
  accumulator += (now - lastTime);
  lastTime = now;

  while (accumulator >= MS_PER_TICK) {
    step(MS_PER_TICK / 1000);
    accumulator -= MS_PER_TICK;
  }
  setImmediate(serverLoop);
}

function step(dt){
  const produced = new Map();
  for (const [k, ov] of tileOverrides.entries()) {
    if (!ov.owner) continue;
    const rate = TYPE_CREDITS_PER_SEC[ov.type] || 0;
    if (rate === 0) continue;
    const add = rate * dt;
    produced.set(ov.owner, (produced.get(ov.owner) || 0) + add);
  }
  for (const [pid, delta] of produced.entries()) {
    io.to(pid).emit('economy:update', { credits: (delta) });
  }
  io.emit('tick', { tps: TICK_HZ, serverTime: Date.now() });
}

serverLoop();

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Hex engine RTS (infinite) listening on http://localhost:${PORT}`);
});
