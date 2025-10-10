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

