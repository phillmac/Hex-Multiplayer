# Hex Engine RTS — Infinite (Node + Socket.IO + Canvas)

Features:
- **Infinite hex world** streamed in **chunks** (24×24 axial rectangles) generated **on demand** around the viewport.
- **Lakes (5–10 hexes)** instead of border oceans; **rivers** greedily flow towards the nearest lake and meander using noise + turn bias.
- **Authoritative Node server** with **fixed-timestep** (~10 tps) RTS loop and per-tick economy.
- **Pointy-topped axial** hex math; centered **30% radius** icon circle per tile.

## Run
```bash
npm install
npm run start
# open http://localhost:3000
```

## How it works
- **Chunk streaming**: the client requests `/chunk:request {cq,cr}` for all chunks covering the viewport. The server generates deterministic terrain from a world seed and caches results.
- **Lakes**: within each 64×64 “feature cell”, we place up to 2 lake centers. Each lake grows by a deterministic BFS to 5–10 cells.
- **Rivers**: sources are high-elevation cells selected by hash; they follow a downhill+distance-to-lake potential field until they reach a lake, marking river tiles along the way.
- **Icons & colors**: Lakes use 🌊 and the `--water` CSS var; Rivers use 🏞️ and `--river`.

## Files
- `server.js` — socket server, chunked worldgen, lakes/rivers, fixed-timestep loop.
- `shared/hex.js` — axial math + chunk helpers.
- `public/client.js` — viewport-driven chunk streaming & canvas renderer.
- `public/index.html`, `public/styles.css`.
