"use strict";
(() => {
  // src/lib/export-layers.ts
  var text = new TextEncoder();
  function u16(value) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value);
    return bytes;
  }
  function u32(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value);
    return bytes;
  }
  function join(parts) {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
  function pascal(name) {
    const bytes = text.encode(name.slice(0, 250));
    const raw = join([Uint8Array.of(bytes.length), bytes]);
    const pad = (4 - raw.length % 4) % 4;
    return join([raw, new Uint8Array(pad)]);
  }
  function packRow(row) {
    const out = [];
    let index = 0;
    while (index < row.length) {
      let run = 1;
      while (index + run < row.length && row[index] === row[index + run] && run < 128) run += 1;
      if (run > 1) {
        out.push(1 - run & 255, row[index]);
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
  function rleChannel(data, width2, height2) {
    const rows = [];
    const counts = [];
    for (let y = 0; y < height2; y += 1) {
      const packed = packRow(data.subarray(y * width2, (y + 1) * width2));
      rows.push(packed);
      counts.push(packed.length);
    }
    return join([u16(1), ...counts.map((count) => u16(count)), ...rows]);
  }
  function channel(rgba, width2, height2, offset) {
    const plane = new Uint8Array(width2 * height2);
    for (let index = 0; index < plane.length; index += 1) plane[index] = rgba[index * 4 + offset];
    return rleChannel(plane, width2, height2);
  }
  function layerRecord(layer, width2, height2, sizes) {
    const name = pascal(layer.name);
    const extra = join([u32(0), u32(0), name]);
    const channels = join([
      u16(4),
      u16(65535),
      u32(sizes[0]),
      u16(0),
      u32(sizes[1]),
      u16(1),
      u32(sizes[2]),
      u16(2),
      u32(sizes[3])
    ]);
    return join([
      u32(0),
      u32(0),
      u32(height2),
      u32(width2),
      channels,
      text.encode("8BIM"),
      text.encode(layer.blend),
      Uint8Array.of(layer.opacity, 0, 0, 0),
      u32(extra.length),
      extra
    ]);
  }
  function planar(rgba, width2, height2) {
    const count = width2 * height2;
    const planes = [new Uint8Array(count), new Uint8Array(count), new Uint8Array(count)];
    for (let index = 0; index < count; index += 1) {
      planes[0][index] = rgba[index * 4];
      planes[1][index] = rgba[index * 4 + 1];
      planes[2][index] = rgba[index * 4 + 2];
    }
    return join(planes);
  }
  function buildPsd(width2, height2, layers2, merged) {
    const records = [];
    const pixels = [];
    for (const layer of layers2) {
      const encoded = [3, 0, 1, 2].map((offset) => channel(layer.rgba, width2, height2, offset));
      records.push(layerRecord(layer, width2, height2, encoded.map((item) => item.length)));
      pixels.push(...encoded);
    }
    const info = join([u16(layers2.length), ...records, ...pixels]);
    const layerInfo = join([u32(info.length), info, u32(0)]);
    const header = join([
      text.encode("8BPS"),
      u16(1),
      new Uint8Array(6),
      u16(3),
      u32(height2),
      u32(width2),
      u16(8),
      u16(3)
    ]);
    return join([header, u32(0), u32(0), u32(layerInfo.length), layerInfo, u16(0), planar(merged, width2, height2)]);
  }
  function effectLayer(width2, height2, effectId) {
    if (effectId === "none") return null;
    const rgba = new Uint8ClampedArray(width2 * height2 * 4);
    const paint2 = (x, y, red, green, blue, alpha) => {
      const index = (y * width2 + x) * 4;
      rgba[index] = red;
      rgba[index + 1] = green;
      rgba[index + 2] = blue;
      rgba[index + 3] = alpha;
    };
    if (effectId === "grain") {
      let seed = 42;
      for (let y = 0; y < height2; y += 1) {
        for (let x = 0; x < width2; x += 1) {
          seed = seed * 1664525 + 1013904223 >>> 0;
          const tone = seed & 255;
          paint2(x, y, tone, tone, tone, 90);
        }
      }
      return { name: "Grain", rgba, blend: "over", opacity: 180 };
    }
    for (let y = 0; y < height2; y += 1) {
      for (let x = 0; x < width2; x += 1) {
        const nx = x / width2;
        const ny = y / height2;
        if (effectId === "gold") {
          const falloff = Math.max(0, 1 - Math.hypot(nx - 0.28, ny - 0.18) / 0.75);
          paint2(x, y, 224, 138, 69, Math.round(falloff * 210));
        } else if (effectId === "mist") {
          paint2(x, y, 246, 241, 232, Math.round(70 + ny * 50));
        } else if (effectId === "night") {
          const edge = Math.min(1, Math.max(0, (Math.hypot(nx - 0.5, ny - 0.5) - 0.2) / 0.55));
          paint2(x, y, 8, 10, 16, Math.round(edge * 220));
        } else {
          const falloff = Math.max(0, 1 - Math.hypot(nx - 0.5, ny - 0.42) / 0.7);
          paint2(x, y, 255, 244, 220, Math.round(falloff * 180));
        }
      }
    }
    if (effectId === "gold") return { name: "Or", rgba, blend: "sLit", opacity: 200 };
    if (effectId === "mist") return { name: "Brume", rgba, blend: "scrn", opacity: 160 };
    if (effectId === "night") return { name: "Nuit", rgba, blend: "mul ", opacity: 220 };
    return { name: "\xC9clat", rgba, blend: "scrn", opacity: 170 };
  }

  // src/lib/gemini.ts
  var KEY = "atelier-gemini-key";
  function readGeminiKey() {
    if (typeof localStorage === "undefined") return "";
    return localStorage.getItem(KEY) ?? "";
  }
  function saveGeminiKey(value) {
    localStorage.setItem(KEY, value.trim());
  }
  function geminiDataUrl(payload) {
    const parts = payload?.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const record = part;
      const inline = record.inlineData ?? record.inline_data;
      if (!inline?.data) continue;
      const mime = record.inlineData?.mimeType ?? record.inline_data?.mime_type ?? "image/png";
      return `data:${mime};base64,${inline.data}`;
    }
    return null;
  }
  async function geminiImage(key, prompt2, ratio2) {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt2 }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: ratio2 } }
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 429) throw new Error("Quota Gemini atteint. R\xE9essaie plus tard.");
      if (response.status === 400 || response.status === 403) throw new Error("Cl\xE9 Gemini refus\xE9e. V\xE9rifie-la sur AI Studio.");
      throw new Error("Gemini n\u2019a pas r\xE9pondu.");
    }
    const url = geminiDataUrl(payload);
    if (!url) throw new Error("Gemini n\u2019a pas renvoy\xE9 d\u2019image.");
    return url;
  }

  // src/lib/segment.ts
  var NAMES = [
    [345, 20, "Rouge"],
    [20, 45, "Roux"],
    [45, 70, "Jaune"],
    [70, 165, "Vert"],
    [165, 255, "Bleu"],
    [255, 320, "Violet"],
    [320, 345, "Rose"]
  ];
  function splitElements(rgba, width2, height2) {
    const maxSide = 768;
    const sw = Math.max(1, Math.round(width2 * Math.min(1, maxSide / width2)));
    const sh = Math.max(1, Math.round(height2 * Math.min(1, maxSide / height2)));
    const small = new Uint8ClampedArray(sw * sh * 3);
    for (let y = 0; y < sh; y += 1) {
      for (let x = 0; x < sw; x += 1) {
        const sx = Math.min(width2 - 1, Math.floor((x + 0.5) * width2 / sw));
        const sy = Math.min(height2 - 1, Math.floor((y + 0.5) * height2 / sh));
        const source = (sy * width2 + sx) * 4;
        const target = (y * sw + x) * 3;
        small[target] = rgba[source];
        small[target + 1] = rgba[source + 1];
        small[target + 2] = rgba[source + 2];
      }
    }
    const color = cluster(small, sw * sh, 5);
    const owner = new Int32Array(sw * sh);
    const parts = [];
    const seen = new Uint8Array(sw * sh);
    const stack = [];
    for (let start = 0; start < sw * sh; start += 1) {
      if (seen[start]) continue;
      const label = color[start];
      stack.push(start);
      seen[start] = 1;
      const cells = [];
      let red = 0;
      let green = 0;
      let blue = 0;
      while (stack.length) {
        const point = stack.pop() ?? 0;
        cells.push(point);
        const pixel = point * 3;
        red += small[pixel];
        green += small[pixel + 1];
        blue += small[pixel + 2];
        const x = point % sw;
        const neighbors = [x > 0 ? point - 1 : -1, x < sw - 1 ? point + 1 : -1, point - sw, point + sw];
        for (const next of neighbors) {
          if (next < 0 || next >= sw * sh || seen[next] || color[next] !== label) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
      parts.push({ cells, count: cells.length, red: red / cells.length, green: green / cells.length, blue: blue / cells.length });
    }
    parts.sort((a, b) => b.count - a.count);
    const minimum = Math.max(24, Math.round(sw * sh * 0.012));
    const kept = parts.filter((part) => part.count >= minimum).slice(0, 8);
    const main = kept.length ? kept : parts.slice(0, 1);
    const keep = new Set(main);
    const used = /* @__PURE__ */ new Set();
    const named = main.map((part) => ({ ...part, name: colorName(part.red, part.green, part.blue, used) }));
    const details = parts.filter((part) => !keep.has(part));
    const layers2 = named.map(() => new Uint8ClampedArray(width2 * height2 * 4));
    const detail = details.length ? new Uint8ClampedArray(width2 * height2 * 4) : null;
    const smallOwner = new Int32Array(sw * sh).fill(-1);
    named.forEach((part, index) => {
      for (const cell of part.cells) smallOwner[cell] = index;
    });
    for (let y = 0; y < height2; y += 1) {
      const sy = Math.min(sh - 1, Math.floor((y + 0.5) * sh / height2));
      for (let x = 0; x < width2; x += 1) {
        const sx = Math.min(sw - 1, Math.floor((x + 0.5) * sw / width2));
        const index = smallOwner[sy * sw + sx];
        const source = (y * width2 + x) * 4;
        const target = index >= 0 ? layers2[index] : detail;
        if (!target) continue;
        target[source] = rgba[source];
        target[source + 1] = rgba[source + 1];
        target[source + 2] = rgba[source + 2];
        target[source + 3] = 255;
      }
    }
    const result = named.map((part, index) => ({ name: part.name, rgba: layers2[index] }));
    if (detail) result.push({ name: uniqueName("D\xE9tails", used), rgba: detail });
    return result;
  }
  function cluster(pixels, count, groups) {
    const step = Math.max(1, Math.floor(count / 1200));
    const centers = [];
    for (let index = 0; centers.length < groups && index < count; index += step) {
      centers.push([pixels[index * 3], pixels[index * 3 + 1], pixels[index * 3 + 2]]);
    }
    const labels = new Uint8Array(count);
    for (let round = 0; round < 6; round += 1) {
      const sums = centers.map(() => [0, 0, 0, 0]);
      for (let index = 0; index < count; index += 1) {
        let best = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        const red = pixels[index * 3];
        const green = pixels[index * 3 + 1];
        const blue = pixels[index * 3 + 2];
        for (let group = 0; group < centers.length; group += 1) {
          const distance = (red - centers[group][0]) ** 2 + (green - centers[group][1]) ** 2 + (blue - centers[group][2]) ** 2;
          if (distance < bestDistance) {
            best = group;
            bestDistance = distance;
          }
        }
        labels[index] = best;
        sums[best][0] += red;
        sums[best][1] += green;
        sums[best][2] += blue;
        sums[best][3] += 1;
      }
      for (let group = 0; group < centers.length; group += 1) {
        if (!sums[group][3]) continue;
        centers[group] = [sums[group][0] / sums[group][3], sums[group][1] / sums[group][3], sums[group][2] / sums[group][3]];
      }
    }
    return labels;
  }
  function colorName(red, green, blue, used) {
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const base = saturation < 0.18 ? max > 180 ? "Clair" : max < 80 ? "Ombre" : "Gris" : hueName(hue(red, green, blue));
    return uniqueName(base, used);
  }
  function uniqueName(base, used) {
    let name = base;
    let index = 2;
    while (used.has(name)) {
      name = `${base} ${index}`;
      index += 1;
    }
    used.add(name);
    return name;
  }
  function hue(red, green, blue) {
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min || 1;
    const value = max === red ? (green - blue) / delta % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
    return (value * 60 + 360) % 360;
  }
  function hueName(value) {
    for (const [from, to, name] of NAMES) {
      if (from > to) {
        if (value >= from || value < to) return name;
      } else if (value >= from && value < to) return name;
    }
    return "Teinte";
  }

  // public-site/main.ts
  var styles = [
    ["R\xE9aliste", "photorealistic, natural light, sharp detail"],
    ["Illustration", "illustration, clean shapes, rich color"],
    ["3D", "3D render, studio lighting"],
    ["Anime", "anime, clean lineart"],
    ["Aquarelle", "watercolor, soft paper texture"]
  ];
  var effects = [
    ["Aucun", "", "none", "", ""],
    ["Or", "golden hour light, warm highlights", "gold", "sepia(0.25) saturate(1.25)", "fx-gold"],
    ["Grain", "35mm film grain, subtle halation", "grain", "contrast(1.1)", "fx-grain"],
    ["Brume", "soft fog, muted colors, diffused light", "mist", "brightness(1.1) saturate(0.75)", "fx-mist"],
    ["Nuit", "night scene, cool moonlight, deep shadows", "night", "brightness(0.75) contrast(1.25) saturate(0.9)", "fx-night"],
    ["\xC9clat", "soft bloom, glowing highlights", "bloom", "brightness(1.1) saturate(1.1)", "fx-bloom"]
  ];
  var ratios = ["1:1", "16:9", "9:16", "4:3", "3:4"];
  var style = styles[0][1];
  var effect = effects[0];
  var ratio = "16:9";
  var resolution = "1080p";
  var imageUrl = "";
  var pieces = [];
  var width = 0;
  var height = 0;
  var selected = "";
  var buffers = /* @__PURE__ */ new Map();
  var prompt = document.querySelector("#prompt");
  var negative = document.querySelector("#negative");
  var gemini = document.querySelector("#gemini");
  var frame = document.querySelector("#frame");
  var layers = document.querySelector("#layers");
  var moves = document.querySelector("#moves");
  var error = document.querySelector("#error");
  var go = document.querySelector("#go");
  var split = document.querySelector("#split");
  var psd = document.querySelector("#psd");
  function chips(hostId, items, current, pick) {
    const host = document.querySelector(hostId);
    if (!host) return;
    host.replaceChildren();
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.setAttribute("aria-pressed", String(item.value === current()));
      button.addEventListener("click", () => {
        pick(item.value);
        chips(hostId, items, current, pick);
      });
      host.appendChild(button);
    }
  }
  chips("#styles", styles.map(([label, value]) => ({ label, value })), () => style, (value) => {
    style = value;
  });
  chips("#effects", effects.map((item) => ({ label: item[0], value: item[2] })), () => effect[2], (value) => {
    effect = effects.find((item) => item[2] === value) ?? effects[0];
    paint();
  });
  chips("#ratios", ratios.map((label) => ({ label, value: label })), () => ratio, (value) => {
    ratio = value;
  });
  chips("#resolutions", ["720p", "1080p"].map((label) => ({ label, value: label })), () => resolution, (value) => {
    resolution = value;
  });
  function frameSize() {
    const shortSide = resolution === "1080p" ? 1080 : 720;
    const [w, h] = ratio === "1:1" ? [1, 1] : ratio === "16:9" ? [16, 9] : ratio === "9:16" ? [9, 16] : ratio === "4:3" ? [4, 3] : [3, 4];
    return w >= h ? [Math.round(shortSide * w / h), shortSide] : [shortSide, Math.round(shortSide * h / w)];
  }
  function fail(message) {
    error.hidden = false;
    error.textContent = message;
  }
  gemini.value = readGeminiKey();
  gemini.addEventListener("change", () => saveGeminiKey(gemini.value));
  go.addEventListener("click", () => void generate());
  async function generate() {
    const text2 = prompt.value.trim();
    if (text2.length < 2) return;
    error.hidden = true;
    go.disabled = true;
    go.textContent = "G\xE9n\xE9ration\u2026";
    pieces = [];
    buffers.clear();
    renderLayers();
    const [w, h] = frameSize();
    const avoid = negative.value.trim();
    const full = [text2, style, effect[1], "sharp focus, fine detail, natural texture", avoid ? `without ${avoid}` : "without blur, pixelation, watermark"].filter(Boolean).join(", ");
    const seed = Math.floor(Math.random() * 1e9);
    const key = gemini.value.trim();
    saveGeminiKey(key);
    try {
      imageUrl = key ? await geminiImage(key, full, ratio) : await loadImage(`https://image.pollinations.ai/prompt/${encodeURIComponent(full)}?width=${w}&height=${h}&nologo=true&model=flux&enhance=true&seed=${seed}`);
      split.hidden = false;
      showImage();
    } catch (err) {
      fail(err instanceof Error ? err.message : "L\u2019image n\u2019a pas pu \xEAtre cr\xE9\xE9e. R\xE9essaie.");
    } finally {
      go.disabled = false;
      go.textContent = "G\xE9n\xE9rer";
    }
  }
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = () => reject(new Error("L\u2019image n\u2019a pas pu \xEAtre cr\xE9\xE9e. R\xE9essaie."));
      img.src = url;
    });
  }
  split.addEventListener("click", () => void separate());
  psd.addEventListener("click", () => void savePsd());
  async function separate() {
    if (!imageUrl) return;
    error.hidden = true;
    split.disabled = true;
    split.textContent = "S\xE9paration\u2026";
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error("image");
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("canvas");
      context.drawImage(bitmap, 0, 0);
      const photo = context.getImageData(0, 0, canvas.width, canvas.height);
      const parts = splitElements(photo.data, canvas.width, canvas.height);
      width = canvas.width;
      height = canvas.height;
      pieces = parts.map((part, index) => ({
        id: `${index}-${part.name}`,
        name: part.name,
        rgba: part.rgba,
        visible: true,
        opacity: 1,
        dx: 0,
        dy: 0
      }));
      selected = pieces[0]?.id ?? "";
      buffers.clear();
      for (const piece of pieces) {
        const buffer = document.createElement("canvas");
        buffer.width = width;
        buffer.height = height;
        buffer.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(piece.rgba), width, height), 0, 0);
        buffers.set(piece.id, buffer);
      }
      renderLayers();
      paint();
      psd.hidden = false;
    } catch {
      fail("La s\xE9paration a \xE9chou\xE9. R\xE9essaie.");
    } finally {
      split.disabled = false;
      split.textContent = "S\xE9parer les calques";
    }
  }
  function showImage() {
    frame.replaceChildren();
    const img = document.createElement("img");
    img.src = imageUrl;
    img.alt = prompt.value;
    img.className = "result";
    img.style.filter = effect[3];
    frame.appendChild(img);
    veil();
  }
  function paint() {
    if (!pieces.length) {
      if (imageUrl) showImage();
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.className = "result";
    canvas.style.filter = effect[3];
    const context = canvas.getContext("2d");
    if (!context) return;
    for (const piece of pieces) {
      if (!piece.visible) continue;
      const source = buffers.get(piece.id);
      if (!source) continue;
      context.globalAlpha = piece.opacity;
      context.drawImage(source, piece.dx, piece.dy);
    }
    frame.replaceChildren(canvas);
    veil();
  }
  function veil() {
    if (!effect[4]) return;
    const cover = document.createElement("div");
    cover.className = `veil ${effect[4]}`;
    frame.appendChild(cover);
  }
  function renderLayers() {
    layers.replaceChildren();
    moves.hidden = pieces.length === 0;
    for (const piece of [...pieces].reverse()) {
      const row = document.createElement("div");
      row.className = `layer${piece.id === selected ? " on" : ""}`;
      const name = document.createElement("button");
      name.type = "button";
      name.textContent = piece.name;
      name.addEventListener("click", () => {
        selected = piece.id;
        renderLayers();
      });
      const eye = document.createElement("button");
      eye.type = "button";
      eye.textContent = piece.visible ? "Visible" : "Masqu\xE9";
      eye.addEventListener("click", () => {
        piece.visible = !piece.visible;
        renderLayers();
        paint();
      });
      const range = document.createElement("input");
      range.type = "range";
      range.min = "0";
      range.max = "100";
      range.value = String(Math.round(piece.opacity * 100));
      range.addEventListener("input", () => {
        piece.opacity = Number(range.value) / 100;
        paint();
      });
      row.append(name, eye, range);
      layers.appendChild(row);
    }
  }
  for (const [label, dx, dy] of [
    ["Gauche", -16, 0],
    ["Droite", 16, 0],
    ["Haut", 0, -16],
    ["Bas", 0, 16]
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      const piece = pieces.find((item) => item.id === selected);
      if (!piece) return;
      piece.dx += dx;
      piece.dy += dy;
      paint();
    });
    moves.appendChild(button);
  }
  async function savePsd() {
    if (!pieces.length) return;
    psd.disabled = true;
    psd.textContent = "PSD\u2026";
    try {
      const elementLayers = [...pieces].reverse().map((piece) => ({
        name: piece.name,
        rgba: rasterize(piece),
        blend: "norm",
        opacity: piece.visible ? 255 : 0
      }));
      const look = effectLayer(width, height, effect[2]);
      const merged = merge(look);
      const bytes = buildPsd(width, height, [...look ? [look] : [], ...elementLayers], merged);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const url = URL.createObjectURL(new Blob([copy], { type: "image/vnd.adobe.photoshop" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "atelier.psd";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      fail("L\u2019export a \xE9chou\xE9. R\xE9essaie.");
    } finally {
      psd.disabled = false;
      psd.textContent = "Exporter le PSD";
    }
  }
  function rasterize(piece) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const source = buffers.get(piece.id);
    if (!context || !source) return new Uint8ClampedArray(width * height * 4);
    context.globalAlpha = piece.opacity;
    context.drawImage(source, piece.dx, piece.dy);
    return context.getImageData(0, 0, width, height).data;
  }
  function merge(look) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return new Uint8ClampedArray(width * height * 4);
    for (const piece of pieces) {
      if (!piece.visible) continue;
      const source = buffers.get(piece.id);
      if (!source) continue;
      context.globalAlpha = piece.opacity;
      context.drawImage(source, piece.dx, piece.dy);
    }
    context.globalAlpha = 1;
    if (look) {
      const veilCanvas = document.createElement("canvas");
      veilCanvas.width = width;
      veilCanvas.height = height;
      veilCanvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(look.rgba), width, height), 0, 0);
      context.globalCompositeOperation = look.blend === "sLit" ? "soft-light" : look.blend === "scrn" ? "screen" : look.blend === "over" ? "overlay" : look.blend === "mul " ? "multiply" : "source-over";
      context.globalAlpha = look.opacity / 255;
      context.drawImage(veilCanvas, 0, 0);
    }
    return context.getImageData(0, 0, width, height).data;
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
})();
