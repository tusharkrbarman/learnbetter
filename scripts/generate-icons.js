const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const outDir = path.join(__dirname, "../assets/icons");
const size = 256;
const scale = 4;
const canvasSize = size * scale;
const pixels = Buffer.alloc(canvasSize * canvasSize * 4);

function color(hex, alpha = 255) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
    a: alpha
  };
}

function blendPixel(x, y, fill) {
  if (x < 0 || y < 0 || x >= canvasSize || y >= canvasSize) {
    return;
  }

  const offset = (y * canvasSize + x) * 4;
  const sourceAlpha = fill.a / 255;
  const targetAlpha = pixels[offset + 3] / 255;
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);

  if (outAlpha <= 0) {
    return;
  }

  pixels[offset] = Math.round((fill.r * sourceAlpha + pixels[offset] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  pixels[offset + 1] = Math.round((fill.g * sourceAlpha + pixels[offset + 1] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  pixels[offset + 2] = Math.round((fill.b * sourceAlpha + pixels[offset + 2] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  pixels[offset + 3] = Math.round(outAlpha * 255);
}

function fillRect(x, y, width, height, fill) {
  const left = Math.round(x * scale);
  const top = Math.round(y * scale);
  const right = Math.round((x + width) * scale);
  const bottom = Math.round((y + height) * scale);

  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      blendPixel(px, py, fill);
    }
  }
}

function fillRoundedRect(x, y, width, height, radius, fill) {
  const left = Math.round(x * scale);
  const top = Math.round(y * scale);
  const right = Math.round((x + width) * scale);
  const bottom = Math.round((y + height) * scale);
  const r = radius * scale;

  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      const dx = Math.max(left + r - px, 0, px - (right - r));
      const dy = Math.max(top + r - py, 0, py - (bottom - r));
      if (dx * dx + dy * dy <= r * r) {
        blendPixel(px, py, fill);
      }
    }
  }
}

function fillPolygon(points, fill) {
  const scaled = points.map(([x, y]) => [x * scale, y * scale]);
  const minY = Math.floor(Math.min(...scaled.map((point) => point[1])));
  const maxY = Math.ceil(Math.max(...scaled.map((point) => point[1])));

  for (let y = minY; y <= maxY; y += 1) {
    const intersections = [];

    for (let index = 0; index < scaled.length; index += 1) {
      const [x1, y1] = scaled[index];
      const [x2, y2] = scaled[(index + 1) % scaled.length];

      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        intersections.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }

    intersections.sort((a, b) => a - b);
    for (let index = 0; index < intersections.length; index += 2) {
      const start = Math.ceil(intersections[index]);
      const end = Math.floor(intersections[index + 1]);
      for (let x = start; x <= end; x += 1) {
        blendPixel(x, y, fill);
      }
    }
  }
}

function downsample() {
  const output = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const totals = [0, 0, 0, 0];

      for (let yy = 0; yy < scale; yy += 1) {
        for (let xx = 0; xx < scale; xx += 1) {
          const offset = (((y * scale + yy) * canvasSize) + (x * scale + xx)) * 4;
          totals[0] += pixels[offset];
          totals[1] += pixels[offset + 1];
          totals[2] += pixels[offset + 2];
          totals[3] += pixels[offset + 3];
        }
      }

      const target = (y * size + x) * 4;
      output[target] = Math.round(totals[0] / (scale * scale));
      output[target + 1] = Math.round(totals[1] / (scale * scale));
      output[target + 2] = Math.round(totals[2] / (scale * scale));
      output[target + 3] = Math.round(totals[3] / (scale * scale));
    }
  }

  return output;
}

const crcTable = Array.from({ length: 256 }, (_unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function makePng(rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function makeIco(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 0;
  header[7] = 0;
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);
  return Buffer.concat([header, png]);
}

fillRoundedRect(16, 16, 224, 224, 48, color("#172033"));
fillRoundedRect(55, 38, 150, 180, 18, color("#f8fafc"));
fillRoundedRect(55, 38, 38, 180, 18, color("#e2e8f0"));
fillRect(74, 38, 19, 180, color("#e2e8f0"));
fillRect(182, 38, 20, 72, color("#3b82f6"));
fillPolygon([[182, 110], [192, 102], [202, 110]], color("#f8fafc"));
fillRoundedRect(82, 82, 92, 14, 7, color("#f6d76b"));
fillRoundedRect(82, 118, 76, 14, 7, color("#f6d76b"));
fillRoundedRect(82, 154, 96, 14, 7, color("#f6d76b"));
fillRoundedRect(82, 184, 66, 8, 4, color("#94a3b8"));
fillRoundedRect(111, 58, 44, 10, 5, color("#172033"));

fs.mkdirSync(outDir, { recursive: true });
const png = makePng(downsample());
fs.writeFileSync(path.join(outDir, "icon.png"), png);
fs.writeFileSync(path.join(outDir, "icon.ico"), makeIco(png));
console.log("Generated assets/icons/icon.png and assets/icons/icon.ico");
