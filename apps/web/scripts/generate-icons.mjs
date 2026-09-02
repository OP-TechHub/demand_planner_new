/*
 * Generates the PWA icon set (and its SVG source) from one set of parameters.
 *
 * This is a PLACEHOLDER mark: the wave glyph and ocean-to-teal gradient mirror
 * the brand lockup already in the sidebar (components/app-sidebar.tsx), so the
 * installed app matches the app it opens. When real branding arrives, replace
 * public/icon.svg and re-render — or delete this script and drop in the real
 * PNGs at the same filenames.
 *
 * Rendered in pure Node (zlib plus a hand-rolled PNG/ICO writer) on purpose: an
 * icon set is generated once and committed, so it isn't worth adding a native
 * image-processing dependency to the tree.
 *
 * Usage: node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// --- brand ---------------------------------------------------------------
// Sampled from the CSS custom properties in app/globals.css so the icon can't
// drift from the theme: --primary (199 89% 36%) and --accent (187 80% 41%).
const PRIMARY = [0x0a, 0x7a, 0xae];
const ACCENT = [0x15, 0xa9, 0xbc];
const GLYPH = [0xff, 0xff, 0xff];

// --- geometry (unit square, 0..1) ---------------------------------------
const CORNER_RADIUS = 0.22; // matches the app's rounded brand tile
const WAVE_COUNT = 3;
const WAVE_AMPLITUDE = 0.085; // x art extent
const WAVE_SPACING = 0.26; //   x art extent, between wave centre lines
const WAVE_STROKE = 0.085; //   x art extent

/*
 * Art extent as a fraction of the canvas.
 *
 * `maskable` is deliberately much smaller: Android may crop a maskable icon to
 * a circle of 80% diameter, so anything outside that circle must be background
 * only. 0.44 keeps the whole glyph inside it with room to spare.
 */
const ART = { any: 0.62, maskable: 0.44 };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Signed distance to a rounded rectangle centred at (cx, cy). */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/*
 * Is (px, py) inside one wave stroke?
 *
 * The wave is the graph of a sine, so distance to it is approximated as the
 * vertical offset corrected by the slope — exact enough for a curve this
 * shallow, and far cheaper than sampling the curve per pixel. Beyond the ends
 * we fall back to true distance from the endpoint, which is what gives the
 * stroke its round caps.
 */
function inWave(px, py, x0, x1, yc, amp, period, halfWidth) {
  const f = (x) => yc + amp * Math.sin((2 * Math.PI * (x - x0)) / period);
  if (px < x0 || px > x1) {
    const ex = px < x0 ? x0 : x1;
    return Math.hypot(px - ex, py - f(ex)) <= halfWidth;
  }
  const slope = amp * ((2 * Math.PI) / period) * Math.cos((2 * Math.PI * (px - x0)) / period);
  return Math.abs(py - f(px)) / Math.sqrt(1 + slope * slope) <= halfWidth;
}

/*
 * Render one icon to raw RGBA.
 *
 * `bleed` fills the whole square (maskable and apple-touch-icon, both of which
 * are masked by the platform and must not supply their own transparent
 * corners); otherwise the tile is a rounded rect on transparency.
 */
function render(size, { bleed = false, art = ART.any } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4; // 4x4 supersampling — the only anti-aliasing here
  const A = art;
  const x0 = 0.5 - A / 2;
  const x1 = 0.5 + A / 2;
  const amp = WAVE_AMPLITUDE * A;
  const stroke = (WAVE_STROKE * A) / 2;
  const spacing = WAVE_SPACING * A;
  const centres = [];
  for (let i = 0; i < WAVE_COUNT; i++) {
    centres.push(0.5 + (i - (WAVE_COUNT - 1) / 2) * spacing);
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / size;
          const py = (y + (sy + 0.5) / SS) / size;
          if (bleed || sdRoundRect(px, py, 0.5, 0.5, 0.5, 0.5, CORNER_RADIUS) <= 0) bg++;
          for (const yc of centres) {
            if (inWave(px, py, x0, x1, yc, amp, A, stroke)) {
              fg++;
              break;
            }
          }
        }
      }
      const n = SS * SS;
      const bgA = bg / n;
      const fgA = Math.min(fg / n, bgA); // the glyph never spills past the tile
      // Gradient runs top-left to bottom-right, as bg-gradient-to-br does.
      const t = clamp01((x / size + y / size) / 2);
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        const tile = PRIMARY[c] + (ACCENT[c] - PRIMARY[c]) * t;
        buf[o + c] = Math.round(bgA > 0 ? (tile * (bgA - fgA) + GLYPH[c] * fgA) / bgA : 0);
      }
      buf[o + 3] = Math.round(bgA * 255);
    }
  }
  return buf;
}

// --- PNG writer ----------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO wrapping PNG entries — supported by every browser we care about. */
function encodeICO(entries) {
  const dir = Buffer.alloc(6 + entries.length * 16);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(entries.length, 4);
  let offset = dir.length;
  entries.forEach(({ size, png }, i) => {
    const o = 6 + i * 16;
    dir[o] = size >= 256 ? 0 : size;
    dir[o + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([dir, ...entries.map((e) => e.png)]);
}

// --- SVG source ----------------------------------------------------------
/** The same parameters, emitted as an editable file. Sampled, not curve-fitted. */
function buildSVG() {
  const S = 512;
  const A = ART.any;
  const x0 = 0.5 - A / 2;
  const amp = WAVE_AMPLITUDE * A;
  const spacing = WAVE_SPACING * A;
  const paths = [];
  for (let i = 0; i < WAVE_COUNT; i++) {
    const yc = 0.5 + (i - (WAVE_COUNT - 1) / 2) * spacing;
    const pts = [];
    const STEPS = 72;
    for (let s = 0; s <= STEPS; s++) {
      const x = x0 + (A * s) / STEPS;
      const y = yc + amp * Math.sin((2 * Math.PI * (x - x0)) / A);
      pts.push(`${(x * S).toFixed(2)} ${(y * S).toFixed(2)}`);
    }
    paths.push(`    <path d="M${pts.join(' L')}" />`);
  }
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <!-- PLACEHOLDER MARK. After editing, re-render the PNGs:
       node scripts/generate-icons.mjs -->
  <defs>
    <linearGradient id="op" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${hex(PRIMARY)}" />
      <stop offset="1" stop-color="${hex(ACCENT)}" />
    </linearGradient>
  </defs>
  <rect width="${S}" height="${S}" rx="${(CORNER_RADIUS * S).toFixed(1)}" fill="url(#op)" />
  <g fill="none" stroke="${hex(GLYPH)}" stroke-width="${(WAVE_STROKE * A * S).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round">
${paths.join('\n')}
  </g>
</svg>
`;
}

// --- emit ----------------------------------------------------------------
mkdirSync(OUT, { recursive: true });

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-512-maskable.png', 512, { bleed: true, art: ART.maskable }],
  // iOS applies its own mask and does not composite transparency: full bleed.
  ['apple-touch-icon.png', 180, { bleed: true }],
];

for (const [name, size, opts] of targets) {
  writeFileSync(join(OUT, name), encodePNG(size, render(size, opts)));
  console.log('wrote', name, `(${size}x${size})`);
}

writeFileSync(
  join(OUT, 'favicon.ico'),
  encodeICO([16, 32, 48].map((size) => ({ size, png: encodePNG(size, render(size)) })))
);
console.log('wrote favicon.ico (16, 32, 48)');

writeFileSync(join(OUT, 'icon.svg'), buildSVG());
console.log('wrote icon.svg');
