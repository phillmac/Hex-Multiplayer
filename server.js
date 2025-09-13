import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { axialToPixel, neighborsAxial, HEX_LAYOUT, hexCorners } from './shared/hex.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static('public'));
app.use('/shared', express.static('shared'));


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
  MOUNTAIN: 'mountain', RIVER: 'river', CANYON: 'canyon', OCEAN: 'ocean', SWAMP: 'swamp',
  // military
  FORT: 'fort', BARRACKS: 'barracks', WAR_FACTORY: 'war_factory', AIRBASE: 'airbase', SHIPYARD: 'shipyard',
  // empty
  EMPTY: 'empty'
};

const CLASS_TO_TYPES = {
  [TILE_CLASS.EMPTY]: [TILE_TYPE.EMPTY],
  [TILE_CLASS.RESOURCE]: [TILE_TYPE.FARM, TILE_TYPE.MINE, TILE_TYPE.SAWMILL, TILE_TYPE.FLOUR_MILL],
  [TILE_CLASS.CITY]: [TILE_TYPE.CITY],
  [TILE_CLASS.TERRAIN]: [TILE_TYPE.MOUNTAIN, TILE_TYPE.RIVER, TILE_TYPE.CANYON, TILE_TYPE.OCEAN, TILE_TYPE.SWAMP],
  [TILE_CLASS.MILITARY]: [TILE_TYPE.FORT, TILE_TYPE.BARRACKS, TILE_TYPE.WAR_FACTORY, TILE_TYPE.AIRBASE, TILE_TYPE.SHIPYARD]
};

const ICON_ABBR = {
  [TILE_TYPE.EMPTY]: '',
  [TILE_TYPE.FARM]: '🌾', [TILE_TYPE.MINE]: '⛏', [TILE_TYPE.SAWMILL]: '🪵', [TILE_TYPE.FLOUR_MILL]: '⚙',
  [TILE_TYPE.CITY]: '🏙',
  [TILE_TYPE.MOUNTAIN]: '⛰', [TILE_TYPE.RIVER]: '🌊', [TILE_TYPE.CANYON]: '🕳', [TILE_TYPE.OCEAN]: '🌊', [TILE_TYPE.SWAMP]: '🦟',
  [TILE_TYPE.FORT]: '🏰', [TILE_TYPE.BARRACKS]: '🏗', [TILE_TYPE.WAR_FACTORY]: '🏭', [TILE_TYPE.AIRBASE]: '✈️', [TILE_TYPE.SHIPYARD]: '⚓'
};

// Simple economy: credits per second (can be replaced by multi-resource later)
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

const GAME = {
  id: uuidv4(),
  hexRadius: 36,
  cols: 20, rows: 14,
  tiles: new Map(),     // "q,r" -> tile
  players: new Map(),   // socketId -> {id,name,color,credits}
  rivers: [],           // list of paths [{path:[{q,r}...]}]
  tick: 0,
  tps: 10
};

function key(q, r) { return `${q},${r}`; }

// --------------------------- RNG / Noise -------------------------------------
let SEED = hashStrToInt(GAME.id);

function hashStrToInt(str){
  let h = 2166136261>>>0;
  for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h,16777619); }
  return h>>>0;
}
function randInt() {
  // xoshiro128** style-ish LCG fallback
  SEED = (SEED + 0x6D2B79F5) >>> 0;
  let t = SEED;
  t = Math.imul(t ^ t >>> 15, 1 | t);
  t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
  return (t ^ t >>> 14) >>> 0;
}
function randf(){ return randInt() / 0xFFFFFFFF; }
function randf2(q,r){
  // deterministic per-hex pseudo-noise in [-0.5,0.5]
  const n = (q*73856093 ^ r*19349663 ^ SEED) >>> 0;
  let t = n;
  t = Math.imul(t ^ t >>> 15, 1 | t);
  t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
  const u = (t ^ t >>> 14) >>> 0;
  return (u / 0xFFFFFFFF) - 0.5;
}

// --------------------------- World gen ---------------------------------------
function seedWorld() {
  GAME.tiles.clear();
  const qmin = -Math.floor(GAME.cols/2), qmax = Math.ceil(GAME.cols/2)-1;
  const rmin = -Math.floor(GAME.rows/2), rmax = Math.ceil(GAME.rows/2)-1;

  // Fill map
  for (let r = rmin; r <= rmax; r++) {
    for (let q = qmin; q <= qmax; q++) {
      GAME.tiles.set(key(q, r), { q, r, clazz: TILE_CLASS.EMPTY, type: TILE_TYPE.EMPTY, owner: null, elev: 0, oceanDist: Infinity });
    }
  }

  // Elevation: radial hill + noise; ocean ring near border
  const qHalf = Math.max(Math.abs(qmin), Math.abs(qmax));
  const rHalf = Math.max(Math.abs(rmin), Math.abs(rmax));
  const sHalf = Math.round((GAME.cols + GAME.rows)/4);

  function ringMargin(q,r){
    const s = -q - r;
    return Math.min(qHalf - Math.abs(q), rHalf - Math.abs(r), sHalf - Math.abs(s));
  }

  for (const t of GAME.tiles.values()) {
    const margin = ringMargin(t.q, t.r); // steps from border
    const centerBias = margin / Math.max(qHalf, rHalf, sHalf); // 0 at edge -> 1 center
    const noise = randf2(t.q, t.r) * 0.35;
    const elev = centerBias + noise; // ~[-0.35..1.35]
    t.elev = elev;

    // Oceans on outer ring
    if (margin <= 1) { t.clazz = TILE_CLASS.TERRAIN; t.type = TILE_TYPE.OCEAN; }
  }

  // Scatter some mountains (high elev)
  for (const t of GAME.tiles.values()) {
    if (t.type === TILE_TYPE.OCEAN) continue;
    if (t.elev > 0.85 && randf() < 0.45) { t.clazz = TILE_CLASS.TERRAIN; t.type = TILE_TYPE.MOUNTAIN; }
  }

  computeOceanDistances();
  carveRivers(3); // make 3 snaking rivers by default
}

function computeOceanDistances(){
  // Multi-source BFS from all ocean tiles
  const q = [];
  for (const t of GAME.tiles.values()) {
    t.oceanDist = (t.type === TILE_TYPE.OCEAN) ? 0 : Infinity;
    if (t.type === TILE_TYPE.OCEAN) q.push(t);
  }
  while(q.length){
    const cur = q.shift();
    const curDist = cur.oceanDist;
    for (const d of neighborsAxial(cur.q, cur.r, true)) {
      const nb = GAME.tiles.get(key(d.q, d.r));
      if (!nb || nb.oceanDist <= curDist + 1) continue;
      nb.oceanDist = curDist + 1;
      q.push(nb);
    }
  }
}

function carveRivers(count){
  GAME.rivers = [];
  let attempts = 0, made = 0;
  const candidates = Array.from(GAME.tiles.values())
    .filter(t => t.type !== TILE_TYPE.OCEAN && t.elev > 0.6 && t.oceanDist > 4);

  while (made < count && attempts < count*10 && candidates.length) {
    attempts++;
    const src = candidates[Math.floor(randf() * candidates.length)];
    const path = growRiverFrom(src);
    if (path.length >= 6) {
      GAME.rivers.push({ path });
      // mark tiles
      for (const p of path) {
        const tile = GAME.tiles.get(key(p.q, p.r));
        if (tile && tile.type !== TILE_TYPE.OCEAN) {
          tile.clazz = TILE_CLASS.TERRAIN;
          tile.type = TILE_TYPE.RIVER;
        }
      }
      made++;
    }
  }
}

function growRiverFrom(start){
  // Greedy descent to ocean using oceanDist field; inject meander via noise and turn penalty
  const path = [];
  const visited = new Set();
  let cur = start;
  let prevDir = null;
  let steps = 0;
  const MAX_STEPS = GAME.cols * GAME.rows; // safe cap
  while (cur && cur.oceanDist > 0 && steps < MAX_STEPS) {
    path.push({ q: cur.q, r: cur.r });
    visited.add(key(cur.q, cur.r));
    // pick neighbor with strictly smaller oceanDist
    const nbs = neighborsAxial(cur.q, cur.r, true)
      .map((d, idx) => {
        const t = GAME.tiles.get(key(d.q, d.r));
        if (!t) return null;
        return { ...d, idx, tile: t };
      })
      .filter(e => e && e.tile.oceanDist < cur.oceanDist && !visited.has(key(e.q, e.r)));

    if (!nbs.length) break;

    // Score neighbors: prefer downhill (lower elev), meander via local noise, and penalize sharp turns
    let best = null, bestScore = Infinity;
    for (const nb of nbs) {
      const downhill = Math.max(0, (cur.elev - nb.tile.elev)); // positive when going downhill
      const meander = randf2(nb.q, nb.r); // [-0.5..0.5]
      const turnPenalty = (prevDir === null) ? 0 : angleTurnPenalty(prevDir, nb.idx);
      const score = nb.tile.oceanDist - 0.15*downhill - 0.4*meander + 0.25*turnPenalty;
      if (score < bestScore) { bestScore = score; best = nb; }
    }
    if (!best) break;
    prevDir = best.idx;
    cur = best.tile;
    steps++;
  }
  if (cur?.oceanDist === 0) {
    // include final ocean-adjacent step to reach water edge (optional)
    path.push({ q: cur.q, r: cur.r });
  }
  return path;
}

// direction index turn cost (0..5) — small penalty when changing direction a lot
function angleTurnPenalty(prevIdx, nextIdx){
  const diff = Math.abs(prevIdx - nextIdx);
  const wrapped = Math.min(diff, 6 - diff); // 0..3
  return wrapped * 0.5; // 0, 0.5, 1.0, 1.5
}

// --------------------------- Snapshot ----------------------------------------
function snapshot() {
  return {
    id: GAME.id,
    hexRadius: GAME.hexRadius,
    cols: GAME.cols, rows: GAME.rows,
    tiles: Array.from(GAME.tiles.values()),
    players: Array.from(GAME.players.values()),
    rivers: GAME.rivers
  };
}

// --------------------------- Networking --------------------------------------
io.on('connection', (socket) => {
  const player = { id: socket.id, name: `P${socket.id.slice(0,4)}`, color: randomColor(), credits: 0 };
  GAME.players.set(socket.id, player);

  socket.emit('hello', { player, game: snapshot(), iconAbbr: ICON_ABBR });
  socket.broadcast.emit('player:join', summarizePlayer(player));

  socket.on('tile:update', (payload, ack) => {
    try {
      const { q, r, clazz, type } = payload;
      const t = GAME.tiles.get(key(q, r));
      if (!t) throw new Error('invalid tile');
      if (!CLASS_TO_TYPES[clazz]?.includes(type)) throw new Error('type not valid for class');
      t.clazz = clazz; t.type = type; t.owner = socket.id;
      const patch = { q, r, clazz, type, owner: t.owner };
      io.emit('tile:patch', patch);
      ack?.({ ok: true });
    } catch (e) { ack?.({ ok: false, error: e.message }); }
  });

  socket.on('tile:cycle', ({ q, r }, ack) => {
    const t = GAME.tiles.get(key(q, r));
    if (!t) return ack?.({ ok: false, error: 'invalid tile' });
    const classes = Object.values(TILE_CLASS);
    let cIdx = classes.indexOf(t.clazz);
    cIdx = (cIdx + 1) % classes.length;
    const clazz = classes[cIdx];
    const types = CLASS_TO_TYPES[clazz];
    const type = types[0] ?? TILE_TYPE.EMPTY;
    t.clazz = clazz; t.type = type; t.owner = socket.id;
    const patch = { q, r, clazz, type, owner: t.owner };
    io.emit('tile:patch', patch);
    ack?.({ ok: true, patch });
  });

  socket.on('disconnect', () => {
    GAME.players.delete(socket.id);
    socket.broadcast.emit('player:leave', socket.id);
  });
});

function summarizePlayer(p){ return { id: p.id, name: p.name, color: p.color, credits: p.credits }; }

function randomColor() {
  const h = Math.floor(Math.random()*360);
  return `hsl(${h} 70% 55%)`;
}

// --------------------------- RTS Tick Loop -----------------------------------
// Fixed-timestep server loop ~Gaffer style: accumulate and step at constant dt.
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
  GAME.tick++;

  // Economy: sum credits from owned tiles
  const produced = new Map(); // pid -> delta
  for (const t of GAME.tiles.values()) {
    if (!t.owner) continue;
    const rate = TYPE_CREDITS_PER_SEC[t.type] || 0;
    if (rate === 0) continue;
    const add = rate * dt;
    produced.set(t.owner, (produced.get(t.owner) || 0) + add);
  }
  for (const [pid, delta] of produced.entries()) {
    const p = GAME.players.get(pid);
    if (!p) continue;
    p.credits += delta;
    io.to(pid).emit('economy:update', { credits: p.credits });
  }

  // Broadcast lightweight time/tick heartbeat (for HUD)
  if (GAME.tick % TICK_HZ === 0) {
    io.emit('tick', { tick: GAME.tick, tps: TICK_HZ, serverTime: Date.now() });
  }
}

// --------------------------- Boot --------------------------------------------
seedWorld();
serverLoop();

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Hex engine RTS listening on http://localhost:${PORT}`);
});
