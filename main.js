import * as THREE from './lib/three.module.js';

// ============================================================ config

const CHUNK = 16;          // chunk width/depth in blocks
const HEIGHT = 80;         // world height in blocks
const RENDER_DIST = 6;     // chunks
const WATER_LEVEL = 26;
const REACH = 6;           // block interaction distance
const GRAVITY = 24;
const JUMP_SPEED = 8.6;
const WALK_SPEED = 4.6;
const SPRINT_MULT = 1.6;
const FLY_SPEED = 12;
const PLAYER_HALF = 0.3;   // half width
const PLAYER_HEIGHT = 1.8;
const EYE_HEIGHT = 1.62;

const SAVE_KEY = 'tuftcraft-world-v1';

// ============================================================ blocks

// tex: [top, side, bottom] tile indices into the atlas
const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLE: 4, SAND: 5, LOG: 6,
  LEAVES: 7, PLANKS: 8, GLASS: 9, WATER: 10, SNOW: 11, BEDROCK: 12,
  BRICK: 13, GRAVEL: 14,
};

const BLOCKS = {
  [B.AIR]:     { name: 'Air',          solid: false, transparent: true,  translucent: false },
  [B.GRASS]:   { name: 'Grass Block',  solid: true,  transparent: false, translucent: false, tex: [0, 1, 2] },
  [B.DIRT]:    { name: 'Dirt',         solid: true,  transparent: false, translucent: false, tex: [2, 2, 2] },
  [B.STONE]:   { name: 'Stone',        solid: true,  transparent: false, translucent: false, tex: [3, 3, 3] },
  [B.COBBLE]:  { name: 'Cobblestone',  solid: true,  transparent: false, translucent: false, tex: [4, 4, 4] },
  [B.SAND]:    { name: 'Sand',         solid: true,  transparent: false, translucent: false, tex: [5, 5, 5] },
  [B.LOG]:     { name: 'Oak Log',      solid: true,  transparent: false, translucent: false, tex: [7, 6, 7] },
  [B.LEAVES]:  { name: 'Oak Leaves',   solid: true,  transparent: false, translucent: false, tex: [8, 8, 8] },
  [B.PLANKS]:  { name: 'Oak Planks',   solid: true,  transparent: false, translucent: false, tex: [9, 9, 9] },
  [B.GLASS]:   { name: 'Glass',        solid: true,  transparent: true,  translucent: true,  tex: [10, 10, 10] },
  [B.WATER]:   { name: 'Water',        solid: false, transparent: true,  translucent: true,  tex: [11, 11, 11] },
  [B.SNOW]:    { name: 'Snowy Grass',  solid: true,  transparent: false, translucent: false, tex: [12, 13, 2] },
  [B.BEDROCK]: { name: 'Bedrock',      solid: true,  transparent: false, translucent: false, tex: [14, 14, 14] },
  [B.BRICK]:   { name: 'Bricks',       solid: true,  transparent: false, translucent: false, tex: [15, 15, 15] },
  [B.GRAVEL]:  { name: 'Gravel',       solid: true,  transparent: false, translucent: false, tex: [16, 16, 16] },
};

const HOTBAR_ITEMS = [B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.PLANKS, B.LOG, B.LEAVES, B.GLASS, B.BRICK];

// ============================================================ deterministic hashing / noise

function hash2(x, z, seed) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function hash3(x, y, z, seed) {
  return hash2(x, Math.imul(y, 0x6c62272e) ^ z, seed ^ Math.imul(z, 0x85ebca6b));
}

function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise2(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
  const u = smooth(xf), v = smooth(zf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm2(x, z, seed, octaves) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2(x * freq, z * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function valueNoise3(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = smooth(xf), v = smooth(yf), w = smooth(zf);
  function lerp(a, b, t) { return a + (b - a) * t; }
  const c000 = hash3(xi, yi, zi, seed),     c100 = hash3(xi + 1, yi, zi, seed);
  const c010 = hash3(xi, yi + 1, zi, seed), c110 = hash3(xi + 1, yi + 1, zi, seed);
  const c001 = hash3(xi, yi, zi + 1, seed), c101 = hash3(xi + 1, yi, zi + 1, seed);
  const c011 = hash3(xi, yi + 1, zi + 1, seed), c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
  return lerp(
    lerp(lerp(c000, c100, u), lerp(c010, c110, u), v),
    lerp(lerp(c001, c101, u), lerp(c011, c111, u), v),
    w
  );
}

// ============================================================ texture atlas (procedural pixel art)

const TILE = 16;
const ATLAS_COLS = 8;
const ATLAS_ROWS = 4;

// Per-tile deterministic RNG so textures look the same every load.
function tileRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE;
  canvas.height = ATLAS_ROWS * TILE;
  const ctx = canvas.getContext('2d');

  // paint one tile via per-pixel callback: (x, y, rng) -> [r,g,b,a]
  function paint(index, fn) {
    const img = ctx.createImageData(TILE, TILE);
    const rng = tileRng(index * 7919 + 17);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const [r, g, b, a] = fn(x, y, rng);
        const i = (y * TILE + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a === undefined ? 255 : a;
      }
    }
    const cx = (index % ATLAS_COLS) * TILE;
    const cy = Math.floor(index / ATLAS_COLS) * TILE;
    ctx.putImageData(img, cx, cy);
  }

  const vary = (rng, base, amt) => base + (rng() - 0.5) * 2 * amt;

  // 0: grass top
  paint(0, (x, y, rng) => {
    const v = vary(rng, 0, 14);
    return [106 + v * 0.6, 170 + v, 64 + v * 0.5];
  });
  // 1: grass side — dirt with ragged green strip on top
  paint(1, (x, y, rng) => {
    const edge = 3 + Math.floor(hash2(x, 91, 5) * 2.5);
    if (y < edge) {
      const v = vary(rng, 0, 14);
      return [106 + v * 0.6, 170 + v, 64 + v * 0.5];
    }
    const v = vary(rng, 0, 16);
    return [134 + v, 96 + v * 0.8, 67 + v * 0.6];
  });
  // 2: dirt
  paint(2, (x, y, rng) => {
    const v = vary(rng, 0, 18);
    const dark = rng() < 0.08 ? -28 : 0;
    return [134 + v + dark, 96 + v * 0.8 + dark, 67 + v * 0.6 + dark];
  });
  // 3: stone
  paint(3, (x, y, rng) => {
    const v = vary(rng, 0, 11);
    const patch = valueNoise2(x * 0.45, y * 0.45, 77) > 0.62 ? -16 : 0;
    return [127 + v + patch, 127 + v + patch, 130 + v + patch];
  });
  // 4: cobblestone — light stones with dark mortar
  paint(4, (x, y, rng) => {
    const n = valueNoise2(x * 0.55 + 9, y * 0.55 + 4, 1234);
    const mortar = n > 0.42 && n < 0.52;
    const v = vary(rng, 0, 10);
    if (mortar) return [72 + v, 72 + v, 74 + v];
    const shade = n > 0.52 ? 14 : -6;
    return [118 + v + shade, 118 + v + shade, 121 + v + shade];
  });
  // 5: sand
  paint(5, (x, y, rng) => {
    const v = vary(rng, 0, 12);
    return [219 + v, 207 + v, 160 + v * 0.8];
  });
  // 6: oak log side — vertical bark stripes
  paint(6, (x, y, rng) => {
    const stripe = hash2(x, 0, 333);
    const base = stripe < 0.3 ? 78 : stripe < 0.75 ? 96 : 110;
    const v = vary(rng, 0, 8);
    return [base + v, base * 0.78 + v, base * 0.5 + v * 0.6];
  });
  // 7: oak log top — growth rings
  paint(7, (x, y, rng) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.5) { const v = vary(rng, 0, 8); return [88 + v, 69 + v, 44 + v]; }
    const ring = Math.floor(d) % 2 === 0 ? 26 : 0;
    const v = vary(rng, 0, 7);
    return [170 + v - ring, 140 + v - ring, 92 + v - ring * 0.7];
  });
  // 8: leaves
  paint(8, (x, y, rng) => {
    const r = rng();
    if (r < 0.13) return [22, 48, 16];
    if (r > 0.93) return [78, 134, 48];
    const v = vary(rng, 0, 12);
    return [48 + v * 0.6, 96 + v, 34 + v * 0.5];
  });
  // 9: planks — horizontal boards with seams
  paint(9, (x, y, rng) => {
    const v = vary(rng, 0, 9);
    if (y % 4 === 3) return [110 + v, 86 + v, 50 + v];          // board gap
    const board = Math.floor(y / 4);
    const seam = (x + board * 7) % 16 === 0;
    if (seam) return [110 + v, 86 + v, 50 + v];
    return [162 + v, 130 + v, 78 + v];
  });
  // 10: glass — transparent with frame + streaks
  paint(10, (x, y, rng) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    if (edge) return [200, 220, 225, 255];
    const streak = (x + y === 11 || x + y === 12 || x + y === 21);
    if (streak && rng() < 0.7) return [235, 245, 250, 130];
    return [200, 225, 235, 28];
  });
  // 11: water
  paint(11, (x, y, rng) => {
    const v = vary(rng, 0, 12);
    const wave = valueNoise2(x * 0.4, y * 0.4, 555) * 20;
    return [38 + v, 92 + v + wave * 0.4, 196 + v + wave, 170];
  });
  // 12: snow top
  paint(12, (x, y, rng) => {
    const v = vary(rng, 0, 7);
    return [241 + v, 244 + v, 248 + v];
  });
  // 13: snowy grass side
  paint(13, (x, y, rng) => {
    const edge = 3 + Math.floor(hash2(x, 17, 6) * 2.5);
    if (y < edge) { const v = vary(rng, 0, 7); return [238 + v, 241 + v, 246 + v]; }
    const v = vary(rng, 0, 16);
    return [134 + v, 96 + v * 0.8, 67 + v * 0.6];
  });
  // 14: bedrock
  paint(14, (x, y, rng) => {
    const n = valueNoise2(x * 0.7, y * 0.7, 999);
    const base = n > 0.5 ? 88 : 40;
    const v = vary(rng, 0, 14);
    return [base + v, base + v, base + v + 3];
  });
  // 15: bricks
  paint(15, (x, y, rng) => {
    const row = Math.floor(y / 4);
    const mortarH = y % 4 === 3;
    const offset = row % 2 === 0 ? 0 : 4;
    const mortarV = (x + offset) % 8 === 7;
    const v = vary(rng, 0, 9);
    if (mortarH || mortarV) return [188 + v, 180 + v, 174 + v];
    return [148 + v, 66 + v * 0.7, 56 + v * 0.6];
  });
  // 16: gravel
  paint(16, (x, y, rng) => {
    const r = rng();
    const v = vary(rng, 0, 14);
    if (r < 0.2) return [98 + v, 90 + v, 84 + v];
    if (r < 0.35) return [156 + v, 150 + v, 144 + v];
    return [128 + v, 122 + v, 117 + v];
  });

  return canvas;
}

const atlasCanvas = buildAtlas();
const atlasTexture = new THREE.CanvasTexture(atlasCanvas);
atlasTexture.magFilter = THREE.NearestFilter;
atlasTexture.minFilter = THREE.NearestFilter;
atlasTexture.generateMipmaps = false;
atlasTexture.colorSpace = THREE.SRGBColorSpace;

// uv rect for a tile, inset half a texel to stop bleeding
function tileUV(index) {
  const col = index % ATLAS_COLS, row = Math.floor(index / ATLAS_COLS);
  const e = 0.5 / (ATLAS_COLS * TILE);
  const u0 = col / ATLAS_COLS + e, u1 = (col + 1) / ATLAS_COLS - e;
  // canvas y is down; three.js uv v is up
  const v1 = 1 - row / ATLAS_ROWS - e, v0 = 1 - (row + 1) / ATLAS_ROWS + e;
  return [u0, v0, u1, v1];
}

// ============================================================ world generation

let seed = 1337;
try {
  const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (saved && typeof saved.seed === 'number') seed = saved.seed;
  else seed = (Math.random() * 2 ** 31) | 0;
} catch (e) { /* fresh world */ }

function terrainHeight(x, z) {
  const continent = fbm2(x * 0.004, z * 0.004, seed, 3);          // big land masses
  const hills = fbm2(x * 0.018, z * 0.018, seed + 50, 4);         // rolling hills
  const mountains = fbm2(x * 0.009, z * 0.009, seed + 100, 4);    // mountain mask
  let h = 18 + continent * 22 + (hills - 0.5) * 14;
  const m = Math.max(0, mountains - 0.55) / 0.45;
  h += m * m * 46;
  return Math.max(2, Math.min(HEIGHT - 10, Math.floor(h)));
}

function isCave(x, y, z, surface) {
  if (y > surface - 5 || y < 4) return false;
  const n = valueNoise3(x * 0.075, y * 0.11, z * 0.075, seed + 777);
  return n > 0.71;
}

function treeAt(x, z) {
  // deterministic sparse trees; only where a tree "wins" over its neighbors to keep spacing
  const r = hash2(x, z, seed ^ 0x51ab);
  if (r < 0.984) return 0;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue;
      if (hash2(x + dx, z + dz, seed ^ 0x51ab) > r) return 0;
    }
  }
  const h = terrainHeight(x, z);
  if (h <= WATER_LEVEL + 1 || h > 52) return 0;                   // no trees on beaches/mountains
  if (isCave(x, h, z, h)) return 0;
  return 4 + Math.floor(hash2(x, z, seed ^ 0x77e) * 3);           // trunk height 4-6
}

// ============================================================ world / chunks

function chunkKey(cx, cz) { return cx + ',' + cz; }
function blockIndex(x, y, z) { return (y * CHUNK + z) * CHUNK + x; }

class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.data = new Uint8Array(CHUNK * HEIGHT * CHUNK);
    this.opaqueMesh = null;
    this.transMesh = null;
    this.dirty = true;
    this.generate();
  }

  get(x, y, z) { return this.data[blockIndex(x, y, z)]; }
  set(x, y, z, id) { this.data[blockIndex(x, y, z)] = id; }

  generate() {
    const x0 = this.cx * CHUNK, z0 = this.cz * CHUNK;
    for (let lx = 0; lx < CHUNK; lx++) {
      for (let lz = 0; lz < CHUNK; lz++) {
        const wx = x0 + lx, wz = z0 + lz;
        const h = terrainHeight(wx, wz);
        const beach = h <= WATER_LEVEL + 2;
        const snowy = h > 56;
        for (let y = 0; y <= Math.max(h, WATER_LEVEL); y++) {
          let id = B.AIR;
          if (y === 0) id = B.BEDROCK;
          else if (y <= h) {
            if (isCave(wx, y, wz, h)) { id = B.AIR; }
            else if (y === h) id = beach ? B.SAND : (snowy ? B.SNOW : B.GRASS);
            else if (y >= h - 3) id = beach ? B.SAND : B.DIRT;
            else id = hash3(wx, y, wz, seed ^ 0xfeed) < 0.04 ? B.GRAVEL : B.STONE;
          } else if (y <= WATER_LEVEL) {
            id = B.WATER;
          }
          if (id !== B.AIR) this.set(lx, y, lz, id);
        }
      }
    }
    // trees — scan an apron so canopies cross chunk borders correctly
    for (let wx = x0 - 3; wx < x0 + CHUNK + 3; wx++) {
      for (let wz = z0 - 3; wz < z0 + CHUNK + 3; wz++) {
        const trunk = treeAt(wx, wz);
        if (!trunk) continue;
        const base = terrainHeight(wx, wz) + 1;
        const stamp = (bx, by, bz, id, keepExisting) => {
          const lx = bx - x0, lz = bz - z0;
          if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || by < 0 || by >= HEIGHT) return;
          if (keepExisting && this.get(lx, by, lz) !== B.AIR) return;
          this.set(lx, by, lz, id);
        };
        // canopy
        const top = base + trunk;
        for (let dy = -2; dy <= 1; dy++) {
          const y = top + dy;
          const rad = dy < 0 ? 2 : 1;
          for (let dx = -rad; dx <= rad; dx++) {
            for (let dz = -rad; dz <= rad; dz++) {
              if (Math.abs(dx) === rad && Math.abs(dz) === rad && hash3(wx + dx, y, wz + dz, seed ^ 0xc0fe) < 0.5) continue;
              if (dy === 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
              stamp(wx + dx, y, wz + dz, B.LEAVES, true);
            }
          }
        }
        // trunk
        for (let dy = 0; dy < trunk; dy++) stamp(wx, base + dy, wz, B.LOG, false);
      }
    }
  }
}

class World {
  constructor() {
    this.chunks = new Map();
    this.edits = {};            // "x,y,z" (world coords) -> block id
    this.loadEdits();
  }

  loadEdits() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (saved && saved.seed === seed && saved.edits) this.edits = saved.edits;
    } catch (e) { /* ignore */ }
  }

  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify({ seed, edits: this.edits })); } catch (e) { /* full */ }
    }, 400);
  }

  reset() {
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  }

  getChunk(cx, cz) { return this.chunks.get(chunkKey(cx, cz)); }

  ensureChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let c = this.chunks.get(key);
    if (!c) {
      c = new Chunk(cx, cz);
      // apply saved edits that land in this chunk
      const x0 = cx * CHUNK, z0 = cz * CHUNK;
      for (const k in this.edits) {
        const [x, y, z] = k.split(',').map(Number);
        if (x >= x0 && x < x0 + CHUNK && z >= z0 && z < z0 + CHUNK && y >= 0 && y < HEIGHT) {
          c.set(x - x0, y, z - z0, this.edits[k]);
        }
      }
      this.chunks.set(key, c);
      // neighbors must re-mesh: their border faces may now be hidden/shown
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = this.getChunk(cx + dx, cz + dz);
        if (n) n.dirty = true;
      }
    }
    return c;
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= HEIGHT) return B.AIR;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.getChunk(cx, cz);
    if (!c) return B.AIR;
    return c.get(x - cx * CHUNK, y, z - cz * CHUNK);
  }

  isLoaded(x, z) {
    return !!this.getChunk(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
  }

  setBlock(x, y, z, id) {
    if (y < 1 || y >= HEIGHT) return;   // keep bedrock floor intact
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.getChunk(cx, cz);
    if (!c) return;
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    c.set(lx, y, lz, id);
    c.dirty = true;
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK - 1) this.markDirty(cx, cz + 1);
    this.edits[x + ',' + y + ',' + z] = id;
    this.save();
  }

  markDirty(cx, cz) {
    const c = this.getChunk(cx, cz);
    if (c) c.dirty = true;
  }

  isSolid(x, y, z) {
    const def = BLOCKS[this.getBlock(x, y, z)];
    return def ? def.solid : false;
  }
}

// ============================================================ meshing

const FACES = [
  { dir: [-1, 0, 0], shade: 0.65, corners: [{ pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] }, { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] }] },
  { dir: [1, 0, 0],  shade: 0.65, corners: [{ pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] }, { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] }] },
  { dir: [0, -1, 0], shade: 0.5,  corners: [{ pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [0, 1] }] },
  { dir: [0, 1, 0],  shade: 1.0,  corners: [{ pos: [0, 1, 1], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 0] }] },
  { dir: [0, 0, -1], shade: 0.8,  corners: [{ pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] }] },
  { dir: [0, 0, 1],  shade: 0.8,  corners: [{ pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] }] },
];

function faceVisible(id, neighborId) {
  if (neighborId === B.AIR) return true;
  const n = BLOCKS[neighborId];
  if (!n.transparent) return false;
  if (neighborId === id) return false;   // no internal faces in water/glass volumes
  return true;
}

const opaqueMaterial = new THREE.MeshLambertMaterial({ map: atlasTexture, vertexColors: true });
const transMaterial = new THREE.MeshLambertMaterial({
  map: atlasTexture, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
});

function buildChunkMesh(world, chunk, scene) {
  if (chunk.opaqueMesh) { scene.remove(chunk.opaqueMesh); chunk.opaqueMesh.geometry.dispose(); chunk.opaqueMesh = null; }
  if (chunk.transMesh) { scene.remove(chunk.transMesh); chunk.transMesh.geometry.dispose(); chunk.transMesh = null; }

  const sets = {
    opaque: { positions: [], normals: [], uvs: [], colors: [], indices: [] },
    trans:  { positions: [], normals: [], uvs: [], colors: [], indices: [] },
  };
  const x0 = chunk.cx * CHUNK, z0 = chunk.cz * CHUNK;

  for (let y = 0; y < HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const id = chunk.get(lx, y, lz);
        if (id === B.AIR) continue;
        const def = BLOCKS[id];
        const wx = x0 + lx, wz = z0 + lz;
        const set = def.translucent ? sets.trans : sets.opaque;
        for (const face of FACES) {
          const nx = wx + face.dir[0], ny = y + face.dir[1], nz = wz + face.dir[2];
          let neighbor;
          if (ny < 0) neighbor = B.BEDROCK;          // never draw the underside of the world
          else if (ny >= HEIGHT) neighbor = B.AIR;
          else if (nx >= x0 && nx < x0 + CHUNK && nz >= z0 && nz < z0 + CHUNK) neighbor = chunk.get(nx - x0, ny, nz - z0);
          else neighbor = world.getBlock(nx, ny, nz);
          if (!faceVisible(id, neighbor)) continue;

          const texIndex = face.dir[1] > 0 ? def.tex[0] : face.dir[1] < 0 ? def.tex[2] : def.tex[1];
          const [u0, v0, u1, v1] = tileUV(texIndex);
          const ndx = set.positions.length / 3;
          for (const corner of face.corners) {
            set.positions.push(wx + corner.pos[0], y + corner.pos[1], wz + corner.pos[2]);
            set.normals.push(...face.dir);
            set.uvs.push(corner.uv[0] === 0 ? u0 : u1, corner.uv[1] === 0 ? v0 : v1);
            set.colors.push(face.shade, face.shade, face.shade);
          }
          set.indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
        }
      }
    }
  }

  for (const kind of ['opaque', 'trans']) {
    const s = sets[kind];
    if (s.positions.length === 0) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(s.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(s.normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(s.uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(s.colors, 3));
    geo.setIndex(s.indices);
    const mesh = new THREE.Mesh(geo, kind === 'opaque' ? opaqueMaterial : transMaterial);
    mesh.frustumCulled = true;
    scene.add(mesh);
    if (kind === 'opaque') chunk.opaqueMesh = mesh; else chunk.transMesh = mesh;
  }
  chunk.dirty = false;
}

// ============================================================ scene setup

const scene = new THREE.Scene();
const SKY = new THREE.Color(0x87ceeb);
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, RENDER_DIST * CHUNK * 0.55, RENDER_DIST * CHUNK * 0.95);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('game').appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
sun.position.set(0.5, 1, 0.3);
scene.add(sun);

// block highlight wireframe
const highlightGeo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(highlightGeo),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 })
);
highlight.visible = false;
scene.add(highlight);

// ============================================================ held block (first-person hand)

const handScene = new THREE.Scene();
const handCamera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 10);
handScene.add(new THREE.AmbientLight(0xffffff, 0.85));
const handSun = new THREE.DirectionalLight(0xfff4e0, 1.3);
handSun.position.set(-0.6, 1, 0.8);
handScene.add(handSun);

// one unit cube centred on the origin, with this block's atlas tiles per face
function buildBlockGeometry(id) {
  const def = BLOCKS[id];
  const positions = [], normals = [], uvs = [], colors = [], indices = [];
  for (const face of FACES) {
    const texIndex = face.dir[1] > 0 ? def.tex[0] : face.dir[1] < 0 ? def.tex[2] : def.tex[1];
    const [u0, v0, u1, v1] = tileUV(texIndex);
    const ndx = positions.length / 3;
    for (const corner of face.corners) {
      positions.push(corner.pos[0] - 0.5, corner.pos[1] - 0.5, corner.pos[2] - 0.5);
      normals.push(...face.dir);
      uvs.push(corner.uv[0] === 0 ? u0 : u1, corner.uv[1] === 0 ? v0 : v1);
      colors.push(face.shade, face.shade, face.shade);
    }
    indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

let handMesh = null;
let swingT = 1;   // 0..1 swing progress, 1 = idle
let bobT = 0;     // walk-bob phase

function updateHandMesh() {
  if (handMesh) { handScene.remove(handMesh); handMesh.geometry.dispose(); }
  const id = HOTBAR_ITEMS[selectedSlot];
  const mat = BLOCKS[id].translucent ? transMaterial : opaqueMaterial;
  handMesh = new THREE.Mesh(buildBlockGeometry(id), mat);
  handMesh.scale.setScalar(0.4);
  handScene.add(handMesh);
}

function triggerSwing() { swingT = 0; }

function animateHand(dt) {
  if (!handMesh) return;
  swingT = Math.min(1, swingT + dt / 0.22);
  const moving = locked && !player.flying && player.onGround &&
    (keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD);
  if (moving) bobT += dt * (keys.ShiftLeft || keys.ShiftRight ? 12 : 8.5);
  const s = Math.sin(swingT * Math.PI);   // 0 -> 1 -> 0 over the swing
  handMesh.position.set(
    0.62 + Math.sin(bobT) * 0.02 - s * 0.12,
    -0.58 - Math.abs(Math.sin(bobT)) * 0.035 - s * 0.18,
    -1.05 - s * 0.16
  );
  handMesh.rotation.set(-s * 0.85, -Math.PI / 5 - s * 0.5, s * 0.2);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  handCamera.aspect = window.innerWidth / window.innerHeight;
  handCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================ player

const world = new World();

const player = {
  pos: new THREE.Vector3(8.5, HEIGHT, 8.5),
  vel: new THREE.Vector3(),
  yaw: 0, pitch: 0,
  onGround: false,
  flying: false,
};

// spawn on dry land: walk east until the terrain rises out of the sea
const SPAWN = { x: 8, z: 8 };
while (terrainHeight(SPAWN.x, SPAWN.z) <= WATER_LEVEL + 1) SPAWN.x += 16;
player.pos.set(SPAWN.x + 0.5, terrainHeight(SPAWN.x, SPAWN.z) + 3, SPAWN.z + 0.5);

function playerAABBCollides(pos) {
  const minX = Math.floor(pos.x - PLAYER_HALF), maxX = Math.floor(pos.x + PLAYER_HALF);
  const minY = Math.floor(pos.y), maxY = Math.floor(pos.y + PLAYER_HEIGHT);
  const minZ = Math.floor(pos.z - PLAYER_HALF), maxZ = Math.floor(pos.z + PLAYER_HALF);
  for (let x = minX; x <= maxX; x++)
    for (let y = minY; y <= maxY; y++)
      for (let z = minZ; z <= maxZ; z++)
        if (world.isSolid(x, y, z)) return { x, y, z };
  return null;
}

function moveAxis(axis, amount) {
  if (amount === 0) return;
  player.pos[axis] += amount;
  const hit = playerAABBCollides(player.pos);
  if (!hit) {
    if (axis === 'y' && amount < 0) player.onGround = false;
    return;
  }
  const eps = 0.001;
  if (axis === 'x') player.pos.x = amount > 0 ? hit.x - PLAYER_HALF - eps : hit.x + 1 + PLAYER_HALF + eps;
  if (axis === 'z') player.pos.z = amount > 0 ? hit.z - PLAYER_HALF - eps : hit.z + 1 + PLAYER_HALF + eps;
  if (axis === 'y') {
    if (amount > 0) player.pos.y = hit.y - PLAYER_HEIGHT - eps;
    else { player.pos.y = hit.y + 1 + eps; player.onGround = true; }
    player.vel.y = 0;
  } else {
    player.vel[axis] = 0;
  }
}

function headInWater() {
  const eye = player.pos.clone(); eye.y += EYE_HEIGHT;
  return world.getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z)) === B.WATER;
}

function bodyInWater() {
  return world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y + 0.4), Math.floor(player.pos.z)) === B.WATER;
}

// ============================================================ input

const keys = {};
const mouse = { left: false, right: false, leftTimer: 0, rightTimer: 0 };
let selectedSlot = 0;
let locked = false;

const overlay = document.getElementById('overlay');
const canvasEl = renderer.domElement;

overlay.addEventListener('click', () => canvasEl.requestPointerLock());

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvasEl;
  overlay.style.display = locked ? 'none' : 'flex';
});

document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch -= e.movementY * 0.0022;
  player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.pitch));
});

document.addEventListener('keydown', (e) => {
  if (!locked) return;
  keys[e.code] = true;
  if (e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5), 10);
    if (n >= 1 && n <= HOTBAR_ITEMS.length) selectSlot(n - 1);
  }
  if (e.code === 'KeyF') {
    player.flying = !player.flying;
    player.vel.set(0, 0, 0);
  }
  if (e.code === 'KeyR') {
    if (confirm('Reset the world? All your builds will be lost.')) world.reset();
  }
  if (e.code === 'Space') e.preventDefault();
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

document.addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0) { mouse.left = true; mouse.leftTimer = 0; triggerSwing(); breakBlock(); }
  if (e.button === 2) { mouse.right = true; mouse.rightTimer = 0; triggerSwing(); placeBlock(); }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouse.left = false;
  if (e.button === 2) mouse.right = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('wheel', (e) => {
  if (!locked) return;
  const dir = e.deltaY > 0 ? 1 : -1;
  selectSlot((selectedSlot + dir + HOTBAR_ITEMS.length) % HOTBAR_ITEMS.length);
});

// ============================================================ block interaction

function raycastBlocks(origin, dir, maxDist) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const tDeltaX = Math.abs(1 / dir.x), tDeltaY = Math.abs(1 / dir.y), tDeltaZ = Math.abs(1 / dir.z);
  let tMaxX = dir.x !== 0 ? Math.abs(((stepX > 0 ? x + 1 : x) - origin.x) / dir.x) : Infinity;
  let tMaxY = dir.y !== 0 ? Math.abs(((stepY > 0 ? y + 1 : y) - origin.y) / dir.y) : Infinity;
  let tMaxZ = dir.z !== 0 ? Math.abs(((stepZ > 0 ? z + 1 : z) - origin.z) / dir.z) : Infinity;
  let face = [0, 0, 0];
  let t = 0;
  while (t <= maxDist) {
    const id = world.getBlock(x, y, z);
    if (id !== B.AIR && id !== B.WATER) return { x, y, z, face, id };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0]; }
    else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0]; }
    else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ]; }
  }
  return null;
}

const lookDir = new THREE.Vector3();

function currentTarget() {
  camera.getWorldDirection(lookDir);
  return raycastBlocks(camera.position, lookDir, REACH);
}

function breakBlock() {
  const hit = currentTarget();
  if (!hit) return;
  if (hit.id === B.BEDROCK) return;
  world.setBlock(hit.x, hit.y, hit.z, B.AIR);
}

function placeBlock() {
  const hit = currentTarget();
  if (!hit) return;
  const px = hit.x + hit.face[0], py = hit.y + hit.face[1], pz = hit.z + hit.face[2];
  const existing = world.getBlock(px, py, pz);
  if (existing !== B.AIR && existing !== B.WATER) return;
  // don't place a block inside the player
  const id = HOTBAR_ITEMS[selectedSlot];
  if (BLOCKS[id].solid) {
    const overlapX = px + 1 > player.pos.x - PLAYER_HALF && px < player.pos.x + PLAYER_HALF;
    const overlapY = py + 1 > player.pos.y && py < player.pos.y + PLAYER_HEIGHT;
    const overlapZ = pz + 1 > player.pos.z - PLAYER_HALF && pz < player.pos.z + PLAYER_HALF;
    if (overlapX && overlapY && overlapZ) return;
  }
  world.setBlock(px, py, pz, id);
}

// ============================================================ hotbar UI

const hotbarEl = document.getElementById('hotbar');
const itemNameEl = document.getElementById('itemname');
let itemNameTimer = null;

function drawItemIcon(canvas, blockId) {
  const ctx = canvas.getContext('2d');
  const def = BLOCKS[blockId];
  const sideIdx = def.tex[1], topIdx = def.tex[0];
  const sx = (i) => (i % ATLAS_COLS) * TILE;
  const sy = (i) => Math.floor(i / ATLAS_COLS) * TILE;
  canvas.width = 48; canvas.height = 48;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 48, 48);
  // fake-isometric: top parallelogram + two sides
  // left face
  ctx.save();
  ctx.transform(1, 0.5, 0, 1, 4, 14);
  ctx.drawImage(atlasCanvas, sx(sideIdx), sy(sideIdx), TILE, TILE, 0, 0, 20, 23);
  ctx.restore();
  // right face (darker)
  ctx.save();
  ctx.transform(1, -0.5, 0, 1, 24, 24);
  ctx.drawImage(atlasCanvas, sx(sideIdx), sy(sideIdx), TILE, TILE, 0, 0, 20, 23);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, 20, 23);
  ctx.restore();
  // top face
  ctx.save();
  ctx.transform(1, 0.5, -1, 0.5, 24, 4);
  ctx.drawImage(atlasCanvas, sx(topIdx), sy(topIdx), TILE, TILE, 0, 0, 20, 20);
  ctx.restore();
}

function buildHotbar() {
  HOTBAR_ITEMS.forEach((blockId, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot' + (i === selectedSlot ? ' selected' : '');
    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = i + 1;
    const cv = document.createElement('canvas');
    drawItemIcon(cv, blockId);
    slot.appendChild(cv);
    slot.appendChild(key);
    slot.addEventListener('click', () => selectSlot(i));
    hotbarEl.appendChild(slot);
  });
}

function selectSlot(i) {
  selectedSlot = i;
  updateHandMesh();
  [...hotbarEl.children].forEach((el, j) => el.classList.toggle('selected', j === i));
  itemNameEl.textContent = BLOCKS[HOTBAR_ITEMS[i]].name;
  itemNameEl.style.opacity = 1;
  clearTimeout(itemNameTimer);
  itemNameTimer = setTimeout(() => { itemNameEl.style.opacity = 0; }, 1200);
}

buildHotbar();

// ============================================================ chunk management

function updateChunks() {
  const pcx = Math.floor(player.pos.x / CHUNK);
  const pcz = Math.floor(player.pos.z / CHUNK);

  // generate needed chunks (closest first), budgeted per frame
  const need = [];
  const genDist = RENDER_DIST + 1;             // +1 apron so border meshes are correct
  for (let dx = -genDist; dx <= genDist; dx++) {
    for (let dz = -genDist; dz <= genDist; dz++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > genDist * genDist) continue;
      if (!world.getChunk(pcx + dx, pcz + dz)) need.push([d2, pcx + dx, pcz + dz]);
    }
  }
  need.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < Math.min(2, need.length); i++) {
    world.ensureChunk(need[i][1], need[i][2]);
  }

  // re-mesh dirty chunks within render distance (closest first), budgeted
  const dirty = [];
  for (const c of world.chunks.values()) {
    const dx = c.cx - pcx, dz = c.cz - pcz;
    const d2 = dx * dx + dz * dz;
    if (d2 > RENDER_DIST * RENDER_DIST) {
      // unload far chunks
      if (d2 > (RENDER_DIST + 3) * (RENDER_DIST + 3)) {
        if (c.opaqueMesh) { scene.remove(c.opaqueMesh); c.opaqueMesh.geometry.dispose(); }
        if (c.transMesh) { scene.remove(c.transMesh); c.transMesh.geometry.dispose(); }
        world.chunks.delete(chunkKey(c.cx, c.cz));
      }
      continue;
    }
    if (c.dirty) dirty.push([d2, c]);
  }
  dirty.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < Math.min(3, dirty.length); i++) {
    buildChunkMesh(world, dirty[i][1], scene);
  }
  return need.length;
}

// ============================================================ main loop

const hudEl = document.getElementById('hud');
const waterOverlay = document.getElementById('water-overlay');
const loadingEl = document.getElementById('loading');

let lastTime = performance.now();
let fpsCount = 0, fpsTime = 0, fps = 0;

function physics(dt) {
  // freeze until ground beneath us exists
  if (!world.isLoaded(player.pos.x, player.pos.z)) return;

  const inWater = bodyInWater();
  const sprint = keys.ShiftLeft || keys.ShiftRight;

  let fwd = 0, strafe = 0;
  if (keys.KeyW) fwd += 1;
  if (keys.KeyS) fwd -= 1;
  if (keys.KeyD) strafe += 1;
  if (keys.KeyA) strafe -= 1;
  const len = Math.hypot(fwd, strafe) || 1;
  fwd /= len; strafe /= len;

  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  let speed = player.flying ? FLY_SPEED : WALK_SPEED * (sprint ? SPRINT_MULT : 1);
  if (inWater && !player.flying) speed *= 0.5;

  const vx = (-sin * fwd + cos * strafe) * speed;
  const vz = (-cos * fwd - sin * strafe) * speed;
  player.vel.x = vx;
  player.vel.z = vz;

  if (player.flying) {
    player.vel.y = 0;
    if (keys.Space) player.vel.y = FLY_SPEED;
    if (keys.KeyC) player.vel.y = -FLY_SPEED;
  } else if (inWater) {
    player.vel.y -= GRAVITY * 0.3 * dt;
    player.vel.y = Math.max(player.vel.y, -3.5);
    if (keys.Space) player.vel.y = 4;
  } else {
    player.vel.y -= GRAVITY * dt;
    player.vel.y = Math.max(player.vel.y, -50);
    if (keys.Space && player.onGround) {
      player.vel.y = JUMP_SPEED;
      player.onGround = false;
    }
  }

  // sub-step so fast falls can't tunnel through blocks
  const steps = Math.max(1, Math.ceil(Math.abs(player.vel.y * dt) / 0.5));
  for (let i = 0; i < steps; i++) {
    moveAxis('y', (player.vel.y * dt) / steps);
    moveAxis('x', (player.vel.x * dt) / steps);
    moveAxis('z', (player.vel.z * dt) / steps);
  }

  // fell out of the world
  if (player.pos.y < -20) {
    player.pos.set(SPAWN.x + 0.5, terrainHeight(SPAWN.x, SPAWN.z) + 3, SPAWN.z + 0.5);
    player.vel.set(0, 0, 0);
  }
}

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  dt = Math.min(dt, 0.1);

  fpsCount++; fpsTime += dt;
  if (fpsTime >= 0.5) { fps = Math.round(fpsCount / fpsTime); fpsCount = 0; fpsTime = 0; }

  const pending = updateChunks();

  if (locked) {
    physics(dt);

    // hold-to-mine / hold-to-place
    if (mouse.left) { mouse.leftTimer += dt; if (mouse.leftTimer > 0.25) { mouse.leftTimer = 0; triggerSwing(); breakBlock(); } }
    if (mouse.right) { mouse.rightTimer += dt; if (mouse.rightTimer > 0.22) { mouse.rightTimer = 0; triggerSwing(); placeBlock(); } }
  }

  camera.position.set(player.pos.x, player.pos.y + EYE_HEIGHT, player.pos.z);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  // block highlight
  const hit = locked ? currentTarget() : null;
  if (hit) {
    highlight.visible = true;
    highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  } else {
    highlight.visible = false;
  }

  waterOverlay.style.display = headInWater() ? 'block' : 'none';

  hudEl.innerHTML =
    `TuftCraft &nbsp;|&nbsp; ${fps} fps<br>` +
    `xyz: ${player.pos.x.toFixed(1)} / ${player.pos.y.toFixed(1)} / ${player.pos.z.toFixed(1)}<br>` +
    `${world.chunks.size} chunks${player.flying ? ' &nbsp;|&nbsp; FLYING' : ''}`;
  loadingEl.textContent = pending > 0 ? `Generating terrain… ${pending} chunks left` : '';

  animateHand(dt);
  renderer.render(scene, camera);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(handScene, handCamera);
  renderer.autoClear = true;
}

selectSlot(0);
frame();

// debug/testing hook
window.__game = { player, world, B, breakBlock, placeBlock, selectSlot, currentTarget };
