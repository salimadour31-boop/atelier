export type Blend = "norm" | "sLit" | "scrn" | "over" | "mul ";

export type Layer = {
  name: string;
  rgba: Uint8ClampedArray;
  blend: Blend;
  opacity: number;
};

const text = new TextEncoder();

function u16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value);
  return bytes;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function join(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pascal(name: string) {
  const bytes = text.encode(name.slice(0, 250));
  const raw = join([Uint8Array.of(bytes.length), bytes]);
  const pad = (4 - (raw.length % 4)) % 4;
  return join([raw, new Uint8Array(pad)]);
}

function packRow(row: Uint8Array) {
  const out: number[] = [];
  let index = 0;
  while (index < row.length) {
    let run = 1;
    while (index + run < row.length && row[index] === row[index + run] && run < 128) run += 1;
    if (run > 1) {
      out.push((1 - run) & 255, row[index]);
      index += run;
      continue;
    }
    const start = index;
    index += 1;
    while (index < row.length && index - start < 128) {
      if (index + 1 < row.length && row[index] === row[index + 1]) break;
      index += 1;
    }
    out.push(index - start - 1);
    for (let cursor = start; cursor < index; cursor += 1) out.push(row[cursor]);
  }
  return Uint8Array.from(out);
}

function rleChannel(data: Uint8Array, width: number, height: number) {
  const rows: Uint8Array[] = [];
  const counts: number[] = [];
  for (let y = 0; y < height; y += 1) {
    const packed = packRow(data.subarray(y * width, (y + 1) * width));
    rows.push(packed);
    counts.push(packed.length);
  }
  return join([u16(1), ...counts.map((count) => u16(count)), ...rows]);
}

function channel(rgba: Uint8ClampedArray, width: number, height: number, offset: number) {
  const plane = new Uint8Array(width * height);
  for (let index = 0; index < plane.length; index += 1) plane[index] = rgba[index * 4 + offset];
  return rleChannel(plane, width, height);
}

function layerRecord(layer: Layer, width: number, height: number, sizes: number[]) {
  const name = pascal(layer.name);
  const extra = join([u32(0), u32(0), name]);
  const channels = join([
    u16(4),
    u16(0xffff),
    u32(sizes[0]),
    u16(0),
    u32(sizes[1]),
    u16(1),
    u32(sizes[2]),
    u16(2),
    u32(sizes[3]),
  ]);
  return join([
    u32(0),
    u32(0),
    u32(height),
    u32(width),
    channels,
    text.encode("8BIM"),
    text.encode(layer.blend),
    Uint8Array.of(layer.opacity, 0, 0, 0),
    u32(extra.length),
    extra,
  ]);
}

function planar(rgba: Uint8ClampedArray, width: number, height: number) {
  const count = width * height;
  const planes = [new Uint8Array(count), new Uint8Array(count), new Uint8Array(count)];
  for (let index = 0; index < count; index += 1) {
    planes[0][index] = rgba[index * 4];
    planes[1][index] = rgba[index * 4 + 1];
    planes[2][index] = rgba[index * 4 + 2];
  }
  return join(planes);
}

export function buildPsd(width: number, height: number, layers: Layer[], merged: Uint8ClampedArray) {
  const records: Uint8Array[] = [];
  const pixels: Uint8Array[] = [];
  for (const layer of layers) {
    const encoded = [3, 0, 1, 2].map((offset) => channel(layer.rgba, width, height, offset));
    records.push(layerRecord(layer, width, height, encoded.map((item) => item.length)));
    pixels.push(...encoded);
  }
  const info = join([u16(layers.length), ...records, ...pixels]);
  const layerInfo = join([u32(info.length), info, u32(0)]);
  const header = join([
    text.encode("8BPS"),
    u16(1),
    new Uint8Array(6),
    u16(3),
    u32(height),
    u32(width),
    u16(8),
    u16(3),
  ]);
  return join([header, u32(0), u32(0), u32(layerInfo.length), layerInfo, u16(0), planar(merged, width, height)]);
}

export function effectLayer(width: number, height: number, effectId: string): Layer | null {
  if (effectId === "none") return null;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const paint = (x: number, y: number, red: number, green: number, blue: number, alpha: number) => {
    const index = (y * width + x) * 4;
    rgba[index] = red;
    rgba[index + 1] = green;
    rgba[index + 2] = blue;
    rgba[index + 3] = alpha;
  };
  if (effectId === "grain") {
    let seed = 42;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const tone = seed & 255;
        paint(x, y, tone, tone, tone, 90);
      }
    }
    return { name: "Grain", rgba, blend: "over", opacity: 180 };
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = x / width;
      const ny = y / height;
      if (effectId === "gold") {
        const falloff = Math.max(0, 1 - Math.hypot(nx - 0.28, ny - 0.18) / 0.75);
        paint(x, y, 224, 138, 69, Math.round(falloff * 210));
      } else if (effectId === "mist") {
        paint(x, y, 246, 241, 232, Math.round(70 + ny * 50));
      } else if (effectId === "night") {
        const edge = Math.min(1, Math.max(0, (Math.hypot(nx - 0.5, ny - 0.5) - 0.2) / 0.55));
        paint(x, y, 8, 10, 16, Math.round(edge * 220));
      } else {
        const falloff = Math.max(0, 1 - Math.hypot(nx - 0.5, ny - 0.42) / 0.7);
        paint(x, y, 255, 244, 220, Math.round(falloff * 180));
      }
    }
  }
  if (effectId === "gold") return { name: "Or", rgba, blend: "sLit", opacity: 200 };
  if (effectId === "mist") return { name: "Brume", rgba, blend: "scrn", opacity: 160 };
  if (effectId === "night") return { name: "Nuit", rgba, blend: "mul ", opacity: 220 };
  return { name: "Éclat", rgba, blend: "scrn", opacity: 170 };
}

export function buildSvg(width: number, height: number, imageUrl: string, effect: Layer | null) {
  const overlay = effect
    ? `<g id="effet" inkscape:groupmode="layer" inkscape:label="${effect.name}" style="mix-blend-mode:${blendCss(effect.blend)};opacity:${(effect.opacity / 255).toFixed(3)}"><image href="${pngDataUrl(effect.rgba, width, height)}" width="${width}" height="${height}"/></g>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <g id="image" inkscape:groupmode="layer" inkscape:label="Image"><image href="${imageUrl}" width="${width}" height="${height}"/></g>
  ${overlay}
  <g id="dessin" inkscape:groupmode="layer" inkscape:label="Dessin"></g>
</svg>`;
}

function blendCss(blend: Blend) {
  if (blend === "sLit") return "soft-light";
  if (blend === "scrn") return "screen";
  if (blend === "over") return "overlay";
  if (blend === "mul ") return "multiply";
  return "normal";
}

function pngDataUrl(rgba: Uint8ClampedArray, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

export async function buildPdf(width: number, height: number, image: Blob, effect: Layer | null) {
  const imageBytes = new Uint8Array(await image.arrayBuffer());
  const effectBytes = effect ? await overlayJpeg(effect, width, height) : null;
  const blend = effect ? blendPdf(effect.blend) : "/Normal";
  const opacity = (effect ? effect.opacity / 255 : 1).toFixed(3);
  const content = effectBytes
    ? `/OC /OC0 BDC\nq ${width} 0 0 ${height} 0 0 cm /Im0 Do\nQ\nEMC\n/OC /OC1 BDC\nq /GS1 gs ${width} 0 0 ${height} 0 0 cm /Im1 Do\nQ\nEMC`
    : `/OC /OC0 BDC\nq ${width} 0 0 ${height} 0 0 cm /Im0 Do\nQ\nEMC`;
  const objects: Uint8Array[] = [
    text.encode("<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [4 0 R 5 0 R] /D << /ON [4 0 R 5 0 R] /Order [4 0 R 5 0 R] >> >> >>"),
    text.encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    text.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 6 0 R${effectBytes ? " /Im1 7 0 R" : ""} >> /Properties << /OC0 4 0 R /OC1 5 0 R >> /ExtGState << /GS1 8 0 R >> >> /Contents 9 0 R >>`),
    text.encode("<< /Type /OCG /Name (Image) >>"),
    text.encode(`<< /Type /OCG /Name (${effect?.name ?? "Dessin"}) >>`),
    jpegObject(imageBytes, width, height),
    effectBytes ? jpegObject(effectBytes, width, height) : text.encode("<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] /Length 0 >>\nstream\nendstream"),
    text.encode(`<< /Type /ExtGState /BM ${blend} /ca ${opacity} /CA ${opacity} >>`),
    text.encode(`<< /Length ${text.encode(content).length} >>\nstream\n${content}\nendstream`),
  ];
  const chunks: Uint8Array[] = [text.encode("%PDF-1.5\n")];
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    chunks.push(text.encode(`${index + 1} 0 obj\n`), object, text.encode("\nendobj\n"));
  });
  const xrefAt = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  chunks.push(text.encode(xref));
  return join(chunks);
}

function blendPdf(blend: Blend) {
  if (blend === "sLit") return "/SoftLight";
  if (blend === "scrn") return "/Screen";
  if (blend === "over") return "/Overlay";
  if (blend === "mul ") return "/Multiply";
  return "/Normal";
}

function jpegObject(bytes: Uint8Array, width: number, height: number) {
  const header = text.encode(
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`,
  );
  return join([header, bytes, text.encode("\nendstream")]);
}

async function overlayJpeg(effect: Layer, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return new Uint8Array();
  context.putImageData(new ImageData(new Uint8ClampedArray(effect.rgba), width, height), 0, 0);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((file) => resolve(file ?? new Blob()), "image/jpeg", 0.92));
  return new Uint8Array(await blob.arrayBuffer());
}
