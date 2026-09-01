/*
 * Generates icons/icon{16,32,48,128}.png with zero dependencies.
 * Run: node tools/make-icons.js
 *
 * Design: Google-blue rounded square, a white "page" with three little
 * index tabs on its left edge, and a blue download arrow on the page.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MASTER = 512; // render at this size, then box-filter down
const SIZES = [16, 32, 48, 128];

const BLUE = [26, 115, 232]; // #1a73e8
const WHITE = [255, 255, 255];
const PAGE_SHADOW = [12, 76, 168];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Signed distance of point to rounded rectangle centred at (cx, cy)
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}

// Coverage from a signed distance (1px anti-aliasing at master scale)
function cov(d) {
  return clamp(0.5 - d, 0, 1);
}

function blend(dst, src, a) {
  return [
    dst[0] + (src[0] - dst[0]) * a,
    dst[1] + (src[1] - dst[1]) * a,
    dst[2] + (src[2] - dst[2]) * a,
    dst[3] + (255 - dst[3]) * a,
  ];
}

function renderMaster() {
  const S = MASTER;
  const img = new Float32Array(S * S * 4);
  const u = S / 128; // design units: 128 grid

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let c = [0, 0, 0, 0];

      // Background rounded square
      const dBg = sdRoundRect(px, py, S / 2, S / 2, S / 2, S / 2, 28 * u);
      c = blend(c, [...BLUE, 255], cov(dBg));

      // Page (white) with a soft shadow offset
      const pageCx = 70 * u;
      const pageCy = 66 * u;
      const pageHw = 30 * u;
      const pageHh = 40 * u;
      const dShadow = sdRoundRect(px + 0, py - 3 * u, pageCx, pageCy, pageHw, pageHh, 6 * u);
      c = blend(c, [...PAGE_SHADOW, 255], cov(dShadow) * 0.55);
      const dPage = sdRoundRect(px, py, pageCx, pageCy, pageHw, pageHh, 6 * u);
      c = blend(c, [...WHITE, 255], cov(dPage));

      // Three index tabs sticking out on the page's left edge
      const tabX = pageCx - pageHw - 6 * u; // centre x of the tabs
      for (let i = 0; i < 3; i++) {
        const ty = pageCy - 22 * u + i * 22 * u;
        const dTab = sdRoundRect(px, py, tabX, ty, 9 * u, 8 * u, 3 * u);
        const shade = i === 0 ? WHITE : i === 1 ? [220, 232, 252] : [190, 212, 248];
        c = blend(c, [...shade, 255], cov(dTab));
      }

      // Download arrow on the page (blue): stem + head + baseline
      const ax = pageCx + 3 * u;
      const stemTop = pageCy - 24 * u;
      const stemBot = pageCy + 6 * u;
      const dStem = sdRoundRect(px, py, ax, (stemTop + stemBot) / 2, 4.5 * u, (stemBot - stemTop) / 2, 2 * u);
      c = blend(c, [...BLUE, 255], cov(dStem));

      // Arrow head: triangle pointing down, apex at stemBot + 14u
      const headHalf = 15 * u;
      const headTop = stemBot - 2 * u;
      const headApex = stemBot + 14 * u;
      if (py >= headTop && py <= headApex) {
        const t = (py - headTop) / (headApex - headTop);
        const halfW = headHalf * (1 - t);
        const dHead = Math.abs(px - ax) - halfW;
        // soften edges
        c = blend(c, [...BLUE, 255], cov(dHead) * cov(headTop - py) * cov(py - headApex));
      }

      // Baseline under the arrow
      const dBase = sdRoundRect(px, py, ax, pageCy + 26 * u, 16 * u, 3 * u, 2 * u);
      c = blend(c, [...BLUE, 255], cov(dBase));

      const o = (y * S + x) * 4;
      img[o] = c[0];
      img[o + 1] = c[1];
      img[o + 2] = c[2];
      img[o + 3] = c[3];
    }
  }
  return img;
}

function downscale(master, size) {
  const S = MASTER;
  const f = S / size;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = Math.floor(y * f); yy < Math.floor((y + 1) * f); yy++) {
        for (let xx = Math.floor(x * f); xx < Math.floor((x + 1) * f); xx++) {
          const o = (yy * S + xx) * 4;
          const alpha = master[o + 3] / 255;
          // premultiplied average so edges don't darken
          r += master[o] * alpha;
          g += master[o + 1] * alpha;
          b += master[o + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
const master = renderMaster();
for (const size of SIZES) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, encodePng(downscale(master, size), size));
  console.log('wrote', path.relative(process.cwd(), file));
}
