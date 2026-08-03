import zlib from 'zlib';
import fs from 'fs';
import path from 'path';

/* Minimal PNG encoder so the PWA ships real maskable raster icons. */
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, draw) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const off = y * (size * 4 + 1);
    raw[off] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y, size);
      const p = off + 1 + x * 4;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BRAND = [15, 107, 128];
const WHITE = [255, 255, 255];

/* Ledger mark: brand field with three ascending bars + a baseline. */
function painter(pad) {
  return (x, y, size) => {
    const u = size / 24;
    const inset = pad * u;
    if (x < inset || y < inset || x > size - inset || y > size - inset) {
      return pad > 0 ? [...BRAND, 255] : [...BRAND, 255];
    }
    const gx = (x - inset) / (size - 2 * inset) * 24;
    const gy = (y - inset) / (size - 2 * inset) * 24;
    const baseline = gy >= 19 && gy <= 20.6 && gx >= 4 && gx <= 20;
    const bars = [
      { x0: 5.2, x1: 9.0, y0: 13.5 },
      { x0: 10.2, x1: 14.0, y0: 9.5 },
      { x0: 15.2, x1: 19.0, y0: 5.5 },
    ];
    const inBar = bars.some((b) => gx >= b.x0 && gx <= b.x1 && gy >= b.y0 && gy <= 18.2);
    return baseline || inBar ? [...WHITE, 255] : [...BRAND, 255];
  };
}

const dir = path.join(process.cwd(), 'public', 'icons');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon-192.png'), png(192, painter(0)));
fs.writeFileSync(path.join(dir, 'icon-512.png'), png(512, painter(0)));
fs.writeFileSync(path.join(dir, 'maskable-192.png'), png(192, painter(2.5)));
fs.writeFileSync(path.join(dir, 'maskable-512.png'), png(512, painter(2.5)));
fs.writeFileSync(path.join(dir, 'apple-touch-icon.png'), png(180, painter(0)));
console.log('icons written to', dir);
