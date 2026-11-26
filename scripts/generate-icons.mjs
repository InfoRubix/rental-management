// Generates the PWA app icons (PNG) without any image library:  node scripts/generate-icons.mjs
// Purple gradient tile with the white "box" logo used in the app header.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../public/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

// Gradient stops (same as --grad in styles.css): #4f46e5 → #7c3aed → #c026d3 at 135°.
const STOPS = [
  [0, [0x4f, 0x46, 0xe5]],
  [0.55, [0x7c, 0x3a, 0xed]],
  [1, [0xc0, 0x26, 0xd3]],
];
function gradient(t) {
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i];
    const [p0, c0] = STOPS[i - 1];
    if (t <= p1) {
      const k = (t - p0) / (p1 - p0);
      return c0.map((v, j) => v + (c1[j] - v) * k);
    }
  }
  return STOPS.at(-1)[1];
}

// Logo strokes in a 24×24 box (lucide "box" icon).
const SEGMENTS = [
  [21, 8, 12, 3], [12, 3, 3, 8], [3, 8, 3, 16], [3, 16, 12, 21], [12, 21, 21, 16], [21, 16, 21, 8],
  [3, 8, 12, 13], [12, 13, 21, 8], [12, 13, 12, 21],
];
function distToSegment(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * @param size     output size in px
 * @param radius   corner radius as a fraction of size (0 = square, for maskable icons)
 * @param logo     logo width as a fraction of size
 */
function render(size, { radius, logo }) {
  const SS = 4; // supersampling for smooth edges
  const px = Buffer.alloc(size * size * 4);
  const r = radius * size;
  const logoPx = logo * size;
  const offset = (size - logoPx) / 2;
  const stroke = 2.1; // in 24-unit logo space
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cover = 0, white = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS, fy = y + (sy + 0.5) / SS;
          // inside rounded rectangle?
          const cx = Math.min(Math.max(fx, r), size - r), cy = Math.min(Math.max(fy, r), size - r);
          if (r > 0 && Math.hypot(fx - cx, fy - cy) > r) continue;
          cover++;
          const lx = ((fx - offset) / logoPx) * 24, ly = ((fy - offset) / logoPx) * 24;
          if (lx > -2 && lx < 26 && ly > -2 && ly < 26 && SEGMENTS.some((s) => distToSegment(lx, ly, s) <= stroke / 2)) white++;
        }
      }
      const i = (y * size + x) * 4;
      if (!cover) continue;
      const bg = gradient((x + y) / (2 * size));
      const w = white / cover;
      px[i] = Math.round(bg[0] + (255 - bg[0]) * w);
      px[i + 1] = Math.round(bg[1] + (255 - bg[1]) * w);
      px[i + 2] = Math.round(bg[2] + (255 - bg[2]) * w);
      px[i + 3] = Math.round((cover / (SS * SS)) * 255);
    }
  }
  return png(size, px);
}

// --- minimal PNG encoder (RGBA, 8-bit) ---
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const FILES = [
  ['icon-192.png', 192, { radius: 0.22, logo: 0.56 }],
  ['icon-512.png', 512, { radius: 0.22, logo: 0.56 }],
  // Maskable: full-bleed background, logo inside the 80% safe zone so any mask shape keeps it intact.
  ['maskable-512.png', 512, { radius: 0, logo: 0.44 }],
  // iOS adds its own rounded corners, so this one is square too.
  ['apple-touch-icon.png', 180, { radius: 0, logo: 0.52 }],
];
for (const [name, size, opts] of FILES) {
  writeFileSync(new URL(name, OUT), render(size, opts));
  console.log(`wrote public/icons/${name}`);
}
