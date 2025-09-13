# Hex Engine RTS (Node + Socket.IO + Canvas)

A minimal real-time multiplayer hex-grid engine with:

- **Authoritative server** (Node + Socket.IO).
- **RTS fixed timestep** tick loop on the server (10 tps).
- **Procedural snaking rivers** from high elevation to the ocean via greedy descent (noise + turn penalties).
- **Pointy-topped axial hex grid** rendering on Canvas with a centered icon whose radius is **30% of hex radius**.
- **Distinct water icons**: Ocean uses **🌊 Water Wave**, River uses **🏞️ National Park**.

## Run

```bash
npm install
npm run start
# open http://localhost:3000 in multiple tabs
```

## Notes

- Browser imports for shared math are served from `/shared/hex.js` via Express static mount.
- Ocean tiles render with `--water` color (CSS var), Rivers with `--river`.
- Icons are drawn inside a circular badge, sized at 30% of hex radius.

## Files

- `server.js`: server, worldgen, rivers, RTS tick loop.
- `shared/hex.js`: axial ↔ pixel, corners, neighbors.
- `public/client.js`: renderer + input + HUD.
- `public/index.html`, `public/styles.css`.
