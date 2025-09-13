# Hex Engine RTS — Infinite (Arrow-key panning)

Features:
- **Infinite hex world** streamed in **chunks** (24×24) generated **on demand**.
- **Lakes (5–10 hexes)** with **rivers** flowing into lakes.
- **Arrow keys to pan** (hold **Shift** for faster panning), **Shift+Wheel** to zoom.
- **Authoritative Node server** with **fixed-timestep** (~10 tps) RTS loop and per-tick economy.
- **30% center icon circle** per hex; river 🏞️ vs lake 🌊 icons.

## Run
```bash
npm install
npm run start
# open http://localhost:3000
```
