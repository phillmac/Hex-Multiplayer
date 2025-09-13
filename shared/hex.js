// Hex math utilities for pointy-topped axial coordinates.
// Based on Red Blob Games: https://www.redblobgames.com/grids/hexagons/

export const HEX_LAYOUT = {
  orientation: 'pointy',
  size: 36,
  origin: { x: 0, y: 0 }
};

const sqrt3 = Math.sqrt(3);

// q,r -> pixel (pointy-top)
export function axialToPixel(q, r, size = HEX_LAYOUT.size, origin = HEX_LAYOUT.origin) {
  const x = size * (sqrt3 * (q + r/2)) + origin.x;
  const y = size * (3/2 * r) + origin.y;
  return { x, y };
}

// pixel -> nearest axial (rounded)
export function pixelToAxial(x, y, size = HEX_LAYOUT.size, origin = HEX_LAYOUT.origin) {
  const q = ((x - origin.x) * sqrt3/3 - (y - origin.y)/3) / (size/1);
  const r = ((y - origin.y) * 2/3) / (size/1);
  return cubeRound(axialToCube(q, r));
}

function axialToCube(q, r) { return { x: q, y: -q - r, z: r }; }
function cubeToAxial({ x, z }) { return { q: x, r: z }; }

function cubeRound({ x, y, z }) {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return cubeToAxial({ x: rx, z: rz });
}

// Corner points around a hex centered at (cx, cy)
export function hexCorners(cx, cy, size = HEX_LAYOUT.size) {
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI/180 * (60 * i - 30);
    corners.push({ x: cx + size * Math.cos(angle), y: cy + size * Math.sin(angle) });
  }
  return corners;
}

// neighbors; if withIndex is true, attach direction index 0..5 (used by rivers)
export function neighborsAxial(q, r, withIndex = false) {
  const dirs = [
    { dq: +1, dr: 0 }, { dq: +1, dr: -1 }, { dq: 0, dr: -1 },
    { dq: -1, dr: 0 }, { dq: -1, dr: +1 }, { dq: 0, dr: +1 }
  ];
  if (!withIndex) return dirs.map(d => ({ q: q + d.dq, r: r + d.dr }));
  return dirs.map((d, idx) => ({ q: q + d.dq, r: r + d.dr, idx }));
}
