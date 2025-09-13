# Hex Engine RTS (Node + Socket.IO + Canvas)

A minimal real-time multiplayer hex-grid engine with:

- **Authoritative server** (Node + Socket.IO).
- **RTS fixed timestep** tick loop on the server (10 tps).
- **Procedural rivers that actually snake** from high elevation to the ocean via greedy descent with noise + turn penalties.
- **Pointy-topped axial hex grid** rendering on Canvas with a centered icon whose radius is **30% of hex radius**.

## Run

```bash
npm install
npm run start
# open http://localhost:3000 in multiple tabs
```

## Notes

- Hex math & picking follow Red Blob Games' axial formulas.
- The tick loop uses a fixed-timestep accumulator (in spirit of Gaffer on Games).
- Rivers are carved by computing `oceanDist` (multi-source BFS from ocean ring), then greedily stepping downhill with a small
  random/meander bias and turn penalty. Paths are capped and marked as `terrain: river` tiles.

## Files

- `server.js`: server, worldgen, rivers, RTS tick loop.
- `shared/hex.js`: axial ↔ pixel, corners, neighbors.
- `public/client.js`: renderer + input + HUD.
- `public/index.html`, `public/styles.css`.

## Extend

- Replace the simple economy with multiple resources and recipes.
- Add units, fog of war, A* pathfinding over hexes (see Red Blob).
- Persist state in Redis and scale Socket.IO with a Redis adapter.
