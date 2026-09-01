/*
 * Resamples captured PNG screenshots to the exact pixel sizes the Chrome Web
 * Store wants, and wraps the brochure pages into a PDF. Zero dependencies.
 *
 * Run: node tools/finalize-assets.js <manifest.json>
 *
 * manifest.json: {
 *   "images": [ { "src": "C:/.../capture.png", "dst": "marketing/out/screenshot-1.png", "w": 1280, "h": 800 }, ... ],
 *   "pdf": { "dst": "marketing/out/brochure.pdf", "pages": ["marketing/out/brochure-front.png", "..."] }
 * }
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');

/* ---------------- PNG decode (8-bit RGB/RGBA, non-interlaced) ------------ */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width, height, colorType, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error('only 8-bit PNGs supported');
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNGs not supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = { 2: 3, 6: 4, 0: 1, 4: 2 }[colorType];
  if (!bpp) throw new Error('unsupported colour type ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * bpp;
      if (bpp >= 3) {
        out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2];
        out[o + 3] = bpp === 4 ? line[s + 3] : 255;
      } else {
        out[o] = out[o + 1] = out[o + 2] = line[s];
        out[o + 3] = bpp === 2 ? line[s + 1] : 255;
      }
    }
    prev = line;
  }
  return { width, height, data: out };
}

/* ---------------- PNG encode ------------------------------------------- */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(img, rgbOnly = true) {
  const bpp = rgbOnly ? 3 : 4;
  const raw = Buffer.alloc((img.width * bpp + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    const row = y * (img.width * bpp + 1);
    raw[row] = 0;
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4;
      const d = row + 1 + x * bpp;
      raw[d] = img.data[s]; raw[d + 1] = img.data[s + 1]; raw[d + 2] = img.data[s + 2];
      if (!rgbOnly) raw[d + 3] = img.data[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8; ihdr[9] = rgbOnly ? 2 : 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- Resample (area-average for downscale, bilinear up) ----- */
function resize(img, w, h) {
  const out = Buffer.alloc(w * h * 4);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy, y1 = (y + 1) * sy;
    for (let x = 0; x < w; x++) {
      const x0 = x * sx, x1 = (x + 1) * sx;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.min(Math.ceil(y1), img.height); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        if (wy <= 0) continue;
        for (let xx = Math.floor(x0); xx < Math.min(Math.ceil(x1), img.width); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          if (wx <= 0) continue;
          const wgt = wx * wy;
          const s = (yy * img.width + xx) * 4;
          r += img.data[s] * wgt; g += img.data[s + 1] * wgt; b += img.data[s + 2] * wgt; a += img.data[s + 3] * wgt;
          wsum += wgt;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = Math.round(r / wsum); out[o + 1] = Math.round(g / wsum); out[o + 2] = Math.round(b / wsum); out[o + 3] = Math.round(a / wsum);
    }
  }
  return { width: w, height: h, data: out };
}

/* ---------------- PDF with one image per page --------------------------- */
function buildPdf(pages) {
  const objects = [];
  const add = (s) => { objects.push(s); return objects.length; };
  const catalogId = add(null);
  const pagesId = add(null);
  const pageIds = [];
  for (const img of pages) {
    const rgb = Buffer.alloc(img.width * img.height * 3);
    for (let i = 0, j = 0; i < img.data.length; i += 4, j += 3) { rgb[j] = img.data[i]; rgb[j + 1] = img.data[i + 1]; rgb[j + 2] = img.data[i + 2]; }
    const flate = zlib.deflateSync(rgb, { level: 9 });
    const imgId = add(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${flate.length} >>\nstream\n`),
      flate, Buffer.from('\nendstream'),
    ]));
    // Page is sized to the image at 96 dpi -> points
    const pw = (img.width * 72) / 96, ph = (img.height * 72) / 96;
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'binary')];
  const offsets = [];
  let length = parts[0].length;
  objects.forEach((obj, i) => {
    offsets.push(length);
    const body = Buffer.isBuffer(obj) ? obj : Buffer.from(obj, 'binary');
    const piece = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    parts.push(piece);
    length += piece.length;
  });
  const xref = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f '];
  for (const off of offsets) xref.push(String(off).padStart(10, '0') + ' 00000 n ');
  parts.push(Buffer.from(xref.join('\n') + `\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(parts);
}

/* ---------------- main --------------------------------------------------- */
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const item of manifest.images || []) {
  const src = decodePng(fs.readFileSync(item.src));
  const dst = path.resolve(root, item.dst);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, encodePng(resize(src, item.w, item.h)));
  console.log(`${path.relative(root, dst)}  ${src.width}x${src.height} -> ${item.w}x${item.h}`);
}
if (manifest.pdf) {
  const pages = manifest.pdf.pages.map((p) => decodePng(fs.readFileSync(path.resolve(root, p))));
  const dst = path.resolve(root, manifest.pdf.dst);
  fs.writeFileSync(dst, buildPdf(pages));
  console.log(`${path.relative(root, dst)}  ${pages.length} page(s)`);
}
