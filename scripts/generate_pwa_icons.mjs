import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const OUTPUTS = [
  { size: 180, file: "app-icon-180.png" },
  { size: 192, file: "app-icon-192.png" },
  { size: 512, file: "app-icon-512.png" },
];

function crc32(buffer) {
  if (!crc32.table) {
    crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32.table[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crc32.table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuffer.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return out;
}

function hex(hexColor) {
  const raw = hexColor.replace("#", "");
  return [
    Number.parseInt(raw.slice(0, 2), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(4, 6), 16),
  ];
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function blend(buffer, size, x, y, rgb, alpha = 1) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= size || iy >= size || alpha <= 0) return;
  const i = (iy * size + ix) * 4;
  const a = clamp01(alpha);
  buffer[i] = Math.round(rgb[0] * a + buffer[i] * (1 - a));
  buffer[i + 1] = Math.round(rgb[1] * a + buffer[i + 1] * (1 - a));
  buffer[i + 2] = Math.round(rgb[2] * a + buffer[i + 2] * (1 - a));
  buffer[i + 3] = 255;
}

function fillSdf(buffer, size, color, sdf) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = sdf(x + 0.5, y + 0.5);
      const alpha = clamp01(0.75 - d);
      if (alpha > 0) blend(buffer, size, x, y, color, alpha);
    }
  }
}

function roundedRect(buffer, size, x, y, w, h, r, color) {
  fillSdf(buffer, size, color, (px, py) => {
    const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
    const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  });
}

function circle(buffer, size, cx, cy, r, color) {
  const minX = Math.max(0, Math.floor(cx - r - 2));
  const maxX = Math.min(size - 1, Math.ceil(cx + r + 2));
  const minY = Math.max(0, Math.floor(cy - r - 2));
  const maxY = Math.min(size - 1, Math.ceil(cy + r + 2));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r;
      blend(buffer, size, x, y, color, clamp01(0.8 - d));
    }
  }
}

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u ** 3 * p0[0] + 3 * u ** 2 * t * p1[0] + 3 * u * t ** 2 * p2[0] + t ** 3 * p3[0],
    u ** 3 * p0[1] + 3 * u ** 2 * t * p1[1] + 3 * u * t ** 2 * p2[1] + t ** 3 * p3[1],
  ];
}

function strokeCubic(buffer, size, points, width, color) {
  const steps = Math.max(80, Math.round(size * 0.55));
  for (let i = 0; i <= steps; i += 1) {
    const p = cubic(points[0], points[1], points[2], points[3], i / steps);
    circle(buffer, size, p[0], p[1], width / 2, color);
  }
}

function renderIcon(size) {
  const s = size / 512;
  const buffer = Buffer.alloc(size * size * 4, 0);
  const scalePoint = ([x, y]) => [x * s, y * s];
  const color = {
    bg: hex("#edf4ff"),
    blue: hex("#7fa3df"),
    green: hex("#9bc7ab"),
    sun: hex("#e8c05d"),
    dark: hex("#243047"),
  };

  for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = color.bg[0];
    buffer[i + 1] = color.bg[1];
    buffer[i + 2] = color.bg[2];
    buffer[i + 3] = 255;
  }
  strokeCubic(buffer, size, [[92, 326], [148, 249], [203, 210], [256, 210]].map(scalePoint), 34 * s, color.blue);
  strokeCubic(buffer, size, [[256, 210], [309, 210], [364, 249], [420, 326]].map(scalePoint), 34 * s, color.blue);
  strokeCubic(buffer, size, [[118, 362], [160, 318], [206, 296], [256, 296]].map(scalePoint), 26 * s, color.green);
  strokeCubic(buffer, size, [[256, 296], [306, 296], [352, 318], [394, 362]].map(scalePoint), 26 * s, color.green);
  circle(buffer, size, 256 * s, 168 * s, 58 * s, color.sun);
  circle(buffer, size, 150 * s, 392 * s, 14 * s, color.dark);
  circle(buffer, size, 362 * s, 392 * s, 14 * s, color.dark);
  roundedRect(buffer, size, 150 * s, 378 * s, 212 * s, 28 * s, 14 * s, color.dark);
  fillSdf(buffer, size, color.dark, (px, py) => {
    const cx = 256 * s;
    const cy = 392 * s;
    const rx = 58 * s;
    const ry = 64 * s;
    const inEllipse = ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 - 1;
    const aboveBase = py <= 392 * s ? inEllipse * Math.min(rx, ry) : 99;
    const sides = Math.max(Math.abs(px - cx) - rx, py - 392 * s);
    return Math.max(aboveBase, sides);
  });
  return buffer;
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const target of OUTPUTS) {
  const bytes = png(target.size, target.size, renderIcon(target.size));
  for (const dir of [ROOT, path.join(ROOT, "web_mvp")]) {
    fs.writeFileSync(path.join(dir, target.file), bytes);
  }
  console.log(`Generated ${target.file} (${target.size}x${target.size})`);
}
