// Simple grid-based A* for 4-direction movement

export function buildNavGrid(scene, rect, tile = 16) {
  const gw = Math.max(1, Math.floor(rect.width / tile));
  const gh = Math.max(1, Math.floor(rect.height / tile));
  const originX = rect.x; const originY = rect.y;
  const walkable = new Array(gw * gh).fill(true);
  const idx = (x, y) => y * gw + x;

  const markBlocked = (wx, wy, w = tile, h = tile) => {
    const left = Math.floor((wx - originX) / tile);
    const top = Math.floor((wy - originY) / tile);
    const right = Math.floor(((wx + w - 1) - originX) / tile);
    const bottom = Math.floor(((wy + h - 1) - originY) / tile);
    for (let gx = left; gx <= right; gx += 1) {
      for (let gy = top; gy <= bottom; gy += 1) {
        if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) walkable[idx(gx, gy)] = false;
      }
    }
  };

  const blockers = [];
  try { blockers.push(...(scene.barricadesHard?.getChildren?.() || [])); } catch (_) {}
  try { blockers.push(...(scene.barricadesSoft?.getChildren?.() || [])); } catch (_) {}
  blockers.forEach((s) => {
    if (!s.active) return;
    const b = s.getBounds();
    markBlocked(b.x, b.y, b.width, b.height);
  });

  return { originX, originY, tile, gw, gh, walkable };
}

export function worldToGrid(grid, x, y) {
  const gx = Math.floor((x - grid.originX) / grid.tile);
  const gy = Math.floor((y - grid.originY) / grid.tile);
  return [gx, gy];
}

export function gridToWorld(grid, gx, gy) {
  const x = grid.originX + gx * grid.tile + grid.tile / 2;
  const y = grid.originY + gy * grid.tile + grid.tile / 2;
  return [x, y];
}

export function findPath(grid, sx, sy, gx, gy) {
  const gw = grid.gw, gh = grid.gh; const W = grid.walkable;
  const inb = (x, y) => x >= 0 && y >= 0 && x < gw && y < gh;
  const sOk = inb(sx, sy) && W[sy * gw + sx];
  const gOk = inb(gx, gy) && W[gy * gw + gx];
  if (!sOk) return null;
  // If goal not walkable, find nearest walkable around goal within small radius
  let tgx = gx, tgy = gy;
  if (!gOk) {
    let best = null, bestD = Infinity;
    for (let dy = -3; dy <= 3; dy += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        const x = gx + dx, y = gy + dy;
        if (!inb(x, y)) continue;
        if (!W[y * gw + x]) continue;
        const d = Math.abs(dx) + Math.abs(dy);
        if (d < bestD) { bestD = d; best = [x, y]; }
      }
    }
    if (best) { tgx = best[0]; tgy = best[1]; } else return null;
  }

  const N = gw * gh;
  const gScore = new Array(N).fill(Infinity);
  const fScore = new Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const open = [];
  const sid = sy * gw + sx; const gid = tgy * gw + tgx;
  gScore[sid] = 0; fScore[sid] = heuristic(sx, sy, tgx, tgy);
  open.push(sid);

  const neighbors = [[1,0],[-1,0],[0,1],[0,-1]];

  while (open.length) {
    // find node with lowest f
    let bi = 0; let bId = open[0]; let bf = fScore[bId];
    for (let i = 1; i < open.length; i += 1) { const id = open[i]; if (fScore[id] < bf) { bf = fScore[id]; bi = i; bId = id; } }
    const current = bId;
    if (current === gid) return reconstruct(grid, came, current);
    open.splice(bi, 1);
    const cx = current % gw; const cy = Math.floor(current / gw);
    for (let k = 0; k < 4; k += 1) {
      const nx = cx + neighbors[k][0]; const ny = cy + neighbors[k][1];
      if (!inb(nx, ny)) continue;
      const nid = ny * gw + nx;
      if (!W[nid]) continue;
      const tg = gScore[current] + 1;
      if (tg < gScore[nid]) {
        came[nid] = current;
        gScore[nid] = tg;
        fScore[nid] = tg + heuristic(nx, ny, tgx, tgy);
        if (!open.includes(nid)) open.push(nid);
      }
    }
  }
  return null;
}

function heuristic(x0, y0, x1, y1) { return Math.abs(x0 - x1) + Math.abs(y0 - y1); }

function reconstruct(grid, came, current) {
  const path = [];
  const gw = grid.gw;
  let cur = current;
  while (cur !== -1) {
    const x = cur % gw; const y = Math.floor(cur / gw);
    path.push(gridToWorld(grid, x, y));
    cur = came[cur];
  }
  path.reverse();
  return path;
}

