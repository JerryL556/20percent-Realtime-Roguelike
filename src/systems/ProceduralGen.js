export function generateRoom(rng, depth = 1) {
  // Very simple placeholder: base arena size varies slightly with depth
  const width = 28 + (depth % 6);
  const height = 16 + ((depth * 2) % 6);
  const enemies = 3 + Math.floor(depth / 2);
  const spawnPoints = [];
  for (let i = 0; i < enemies; i++) {
    spawnPoints.push({ x: rng.int(64, 896), y: rng.int(64, 480) });
  }
  return { width, height, spawnPoints };
}

// Generate cohesive barricade placements within a rectangle.
// Returns array of tiles: { x, y, kind: 'hard'|'soft' }
export function generateBarricades(rng, rect, variant = 'normal') {
  const res = [];
  if (!rect) return res;
  const tile = 16;
  const tilesX = Math.floor(rect.width / tile);
  const tilesY = Math.floor(rect.height / tile);
  const originTX = Math.floor(rect.x / tile);
  const originTY = Math.floor(rect.y / tile);
  const centerX = rect.centerX;
  const centerY = rect.centerY;
  const avoidR2 = 48 * 48; // keep center clear

  const used = new Set();
  const key = (tx, ty) => `${tx},${ty}`;
  const pushTile = (tx, ty, kind) => {
    if (tx < 0 || ty < 0 || tx >= tilesX || ty >= tilesY) return;
    const cx = rect.x + tx * tile + tile / 2;
    const cy = rect.y + ty * tile + tile / 2;
    const dx = cx - centerX; const dy = cy - centerY;
    if (dx * dx + dy * dy < avoidR2) return;
    const k = key(tx, ty);
    if (used.has(k)) return;
    used.add(k);
    res.push({ x: cx, y: cy, kind });
  };

  // Helper generators per variant
  const genNormal = () => {
    // 1) Small "apartments" (perimeter hard walls with gaps)
    const rooms = rng.int(3, 6);
    for (let r = 0; r < rooms; r += 1) {
      const w = rng.int(4, 8);
      const h = rng.int(3, 6);
      const tx0 = rng.int(2, Math.max(2, tilesX - w - 2));
      const ty0 = rng.int(2, Math.max(2, tilesY - h - 2));
      // Gate positions (one or two random openings)
      const gateCount = rng.int(1, 2);
      const gates = new Set();
      for (let g = 0; g < gateCount; g += 1) {
        const side = rng.int(0, 3); // 0 top, 1 right, 2 bottom, 3 left
        if (side === 0) gates.add(key(tx0 + rng.int(1, w - 2), ty0));
        else if (side === 1) gates.add(key(tx0 + w - 1, ty0 + rng.int(1, h - 2)));
        else if (side === 2) gates.add(key(tx0 + rng.int(1, w - 2), ty0 + h - 1));
        else gates.add(key(tx0, ty0 + rng.int(1, h - 2)));
      }
      for (let dx = 0; dx < w; dx += 1) {
        for (let dy = 0; dy < h; dy += 1) {
          const tx = tx0 + dx; const ty = ty0 + dy;
          const onEdge = (dx === 0 || dy === 0 || dx === w - 1 || dy === h - 1);
          if (!onEdge) continue;
          const k = key(tx, ty);
          if (gates.has(k)) continue; // opening
          // About 50% of perimeter segments are destructible to create breakable walls
          const kind = (rng.next() < 0.5) ? 'soft' : 'hard';
          pushTile(tx, ty, kind);
        }
      }
      // Optional inner soft clutter
      const clutter = rng.int(2, 4);
      for (let c = 0; c < clutter; c += 1) {
        const cx = tx0 + rng.int(1, Math.max(1, w - 2));
        const cy = ty0 + rng.int(1, Math.max(1, h - 2));
        const count = rng.int(3, 7);
        for (let i = 0; i < count; i += 1) {
          const ox = rng.int(-1, 1); const oy = rng.int(-1, 1);
          pushTile(cx + ox, cy + oy, 'soft');
        }
      }
    }

    // 2) Corridors/lines to feel cohesive
    const lines = rng.int(3, 5);
    for (let i = 0; i < lines; i += 1) {
      const vertical = rng.next() < 0.5;
      if (vertical) {
        const tx = rng.int(3, Math.max(3, tilesX - 4));
        const len = rng.int(4, Math.max(4, Math.floor(tilesY * 0.7)));
        let ty = rng.int(2, Math.max(2, tilesY - len - 2));
        for (let j = 0; j < len; j += 1) {
          // Breaks to create passages
          if (rng.next() < 0.12) { ty += 1; continue; }
          // About half of the corridor segments are destructible
          pushTile(tx, ty, (rng.next() < 0.5) ? 'soft' : 'hard');
          if (rng.next() < 0.45) pushTile(tx + (rng.next() < 0.5 ? -1 : 1), ty, 'soft');
          ty += 1;
        }
      } else {
        const ty = rng.int(3, Math.max(3, tilesY - 4));
        const len = rng.int(4, Math.max(4, Math.floor(tilesX * 0.7)));
        let tx = rng.int(2, Math.max(2, tilesX - len - 2));
        for (let j = 0; j < len; j += 1) {
          if (rng.next() < 0.12) { tx += 1; continue; }
          // About half of the corridor segments are destructible
          pushTile(tx, ty, (rng.next() < 0.5) ? 'soft' : 'hard');
          if (rng.next() < 0.45) pushTile(tx, ty + (rng.next() < 0.5 ? -1 : 1), 'soft');
          tx += 1;
        }
      }
    }

    // 3) Scatter a few soft clusters not overlapping hard
    const clusters = rng.int(9, 14);
    for (let c = 0; c < clusters; c += 1) {
      const cx = rng.int(2, tilesX - 3);
      const cy = rng.int(2, tilesY - 3);
      const n = rng.int(4, 9);
      for (let k2 = 0; k2 < n; k2 += 1) {
        const ox = rng.int(-1, 1); const oy = rng.int(-1, 1);
        pushTile(cx + ox, cy + oy, 'soft');
      }
    }
  };

  const genSoftMany = () => {
    // More rooms and lines; all soft
    const rooms = rng.int(6, 10);
    for (let r = 0; r < rooms; r += 1) {
      const w = rng.int(4, 9);
      const h = rng.int(3, 7);
      const tx0 = rng.int(1, Math.max(1, tilesX - w - 1));
      const ty0 = rng.int(1, Math.max(1, tilesY - h - 1));
      // No gates concept; all perimeter soft
      for (let dx = 0; dx < w; dx += 1) {
        for (let dy = 0; dy < h; dy += 1) {
          const tx = tx0 + dx; const ty = ty0 + dy;
          const onEdge = (dx === 0 || dy === 0 || dx === w - 1 || dy === h - 1);
          if (!onEdge) continue;
          pushTile(tx, ty, 'soft');
        }
      }
      // Dense inner soft clutter
      const clutter = rng.int(3, 6);
      for (let c = 0; c < clutter; c += 1) {
        const cx = tx0 + rng.int(1, Math.max(1, w - 2));
        const cy = ty0 + rng.int(1, Math.max(1, h - 2));
        const count = rng.int(6, 12);
        for (let i = 0; i < count; i += 1) {
          const ox = rng.int(-1, 1); const oy = rng.int(-1, 1);
          pushTile(cx + ox, cy + oy, 'soft');
        }
      }
    }
    const lines = rng.int(6, 10);
    for (let i = 0; i < lines; i += 1) {
      const vertical = rng.next() < 0.5;
      if (vertical) {
        const tx = rng.int(2, Math.max(2, tilesX - 3));
        const len = rng.int(Math.floor(tilesY * 0.4), Math.floor(tilesY * 0.9));
        let ty = rng.int(1, Math.max(1, tilesY - len - 1));
        for (let j = 0; j < len; j += 1) { pushTile(tx, ty, 'soft'); if (rng.next() < 0.5) pushTile(tx + (rng.next() < 0.5 ? -1 : 1), ty, 'soft'); ty += 1; }
      } else {
        const ty = rng.int(2, Math.max(2, tilesY - 3));
        const len = rng.int(Math.floor(tilesX * 0.4), Math.floor(tilesX * 0.9));
        let tx = rng.int(1, Math.max(1, tilesX - len - 1));
        for (let j = 0; j < len; j += 1) { pushTile(tx, ty, 'soft'); if (rng.next() < 0.5) pushTile(tx, ty + (rng.next() < 0.5 ? -1 : 1), 'soft'); tx += 1; }
      }
    }
    // Many soft clusters
    const clusters = rng.int(16, 24);
    for (let c = 0; c < clusters; c += 1) {
      const cx = rng.int(1, tilesX - 2);
      const cy = rng.int(1, tilesY - 2);
      const n = rng.int(6, 14);
      for (let k2 = 0; k2 < n; k2 += 1) {
        const ox = rng.int(-1, 1); const oy = rng.int(-1, 1);
        pushTile(cx + ox, cy + oy, 'soft');
      }
    }
  };

  const genHardSparse = () => {
    // Few strong hard barriers
    const rooms = rng.int(1, 2);
    for (let r = 0; r < rooms; r += 1) {
      const w = rng.int(5, 9);
      const h = rng.int(3, 7);
      const tx0 = rng.int(2, Math.max(2, tilesX - w - 2));
      const ty0 = rng.int(2, Math.max(2, tilesY - h - 2));
      for (let dx = 0; dx < w; dx += 1) {
        for (let dy = 0; dy < h; dy += 1) {
          const onEdge = (dx === 0 || dy === 0 || dx === w - 1 || dy === h - 1);
          if (!onEdge) continue;
          pushTile(tx0 + dx, ty0 + dy, 'hard');
        }
      }
    }
    const lines = rng.int(1, 2);
    for (let i = 0; i < lines; i += 1) {
      const vertical = rng.next() < 0.5;
      if (vertical) {
        const tx = rng.int(3, Math.max(3, tilesX - 4));
        const len = rng.int(4, Math.max(4, Math.floor(tilesY * 0.6)));
        let ty = rng.int(2, Math.max(2, tilesY - len - 2));
        for (let j = 0; j < len; j += 1) { pushTile(tx, ty, 'hard'); ty += 1; }
      } else {
        const ty = rng.int(3, Math.max(3, tilesY - 4));
        const len = rng.int(4, Math.max(4, Math.floor(tilesX * 0.6)));
        let tx = rng.int(2, Math.max(2, tilesX - len - 2));
        for (let j = 0; j < len; j += 1) { pushTile(tx, ty, 'hard'); tx += 1; }
      }
    }
    // No scatter clusters for sparse hard layout
  };

  if (variant === 'soft_many') genSoftMany();
  else if (variant === 'hard_sparse') genHardSparse();
  else genNormal();

  return res;
}
