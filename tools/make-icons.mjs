// Generates the extension icons.
//
// Chrome will not take SVG for `icons` or `action.default_icon`, so these have
// to be real PNGs. Rather than carry binaries nobody can diff or a build
// dependency for four flat images, they are drawn here and encoded with
// node:zlib -- PNG is a short format and this stays reviewable.
//
// Design: a white shield on the CloakLLM violet. At 16px the toolbar icon is
// ~16 device pixels, so silhouette is all that survives; anything with interior
// detail turns to mush. Supersampled 4x4 for clean edges.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SIZES = [16, 32, 48, 128];
const OUT = new URL('../icons/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const BG = [124, 58, 237, 255];      // #7C3AED
const FG = [255, 255, 255, 255];

// --- PNG encoding ---------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {Uint8Array} rgba length = w*h*4 */
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  ihdr[10] = 0;   // deflate
  ihdr[11] = 0;   // adaptive filtering
  ihdr[12] = 0;   // no interlace

  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4)
      .copy(raw, y * (w * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- shapes ---------------------------------------------------------------

/** Rounded square covering the whole canvas, in normalised coords. */
function inRoundedSquare(u, v, radius) {
  const dx = Math.max(radius - u, 0, u - (1 - radius));
  const dy = Math.max(radius - v, 0, v - (1 - radius));
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Heater shield in normalised coords: flat across the top, straight sides down
 * to the shoulder, then a taper to a point at the bottom.
 *
 * Two things decide whether this reads as a shield rather than a cup: the
 * taper has to start high (around a third of the way down, not the waist), and
 * the form has to be narrower than it is tall. A wide shape with a low, round
 * taper is a drinking vessel.
 */
const SHOULDER = 0.34;   // where the sides start converging
const HALF_W = 0.40;     // half-width of the flat top

function inShield(u, v) {
  if (v < 0 || v > 1 || u < 0 || u > 1) return false;
  let half;
  if (v <= SHOULDER) {
    half = HALF_W;
  } else {
    const t = (v - SHOULDER) / (1 - SHOULDER);   // 0 at the shoulder, 1 at the tip
    half = HALF_W * Math.pow(1 - t, 0.62);       // convex sides converging to a point
  }
  return Math.abs(u - 0.5) <= half;
}

function draw(size) {
  const px = new Uint8Array(size * size * 4);
  const SS = 4;                       // supersampling factor
  const inset = size <= 16 ? 0.16 : 0.2;   // the shield's margin inside the tile
  const span = 1 - inset * 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          if (!inRoundedSquare(u, v, 0.22)) continue;
          bg++;
          if (inShield((u - inset) / span, (v - inset) / span)) fg++;
        }
      }
      const total = SS * SS;
      const i = (y * size + x) * 4;
      if (bg === 0) continue;                       // transparent corner

      // Composite shield over field, then the whole tile over transparency.
      const fgFrac = fg / total;
      const bgFrac = bg / total;
      for (let c = 0; c < 3; c++) {
        px[i + c] = Math.round((FG[c] * fgFrac + BG[c] * (bgFrac - fgFrac)) / bgFrac);
      }
      px[i + 3] = Math.round(255 * bgFrac);
    }
  }
  return px;
}

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const png = encodePng(draw(size), size, size);
  writeFileSync(join(OUT, `icon${size}.png`), png);
  console.log(`icons/icon${size}.png  ${png.length} bytes`);
}
