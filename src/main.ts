import { buildPsd, effectLayer, type Layer } from "../src/lib/export-layers.ts";
import { splitElements } from "../src/lib/segment.ts";

type Piece = {
  id: string;
  name: string;
  rgba: Uint8ClampedArray;
  visible: boolean;
  opacity: number;
  dx: number;
  dy: number;
};

const styles = [
  ["Réaliste", "photorealistic, natural light, sharp detail"],
  ["Illustration", "illustration, clean shapes, rich color"],
  ["3D", "3D render, studio lighting"],
  ["Anime", "anime, clean lineart"],
  ["Aquarelle", "watercolor, soft paper texture"],
] as const;
const effects = [
  ["Aucun", "", "none", "", ""],
  ["Or", "golden hour light, warm highlights", "gold", "sepia(0.25) saturate(1.25)", "fx-gold"],
  ["Grain", "35mm film grain, subtle halation", "grain", "contrast(1.1)", "fx-grain"],
  ["Brume", "soft fog, muted colors, diffused light", "mist", "brightness(1.1) saturate(0.75)", "fx-mist"],
  ["Nuit", "night scene, cool moonlight, deep shadows", "night", "brightness(0.75) contrast(1.25) saturate(0.9)", "fx-night"],
  ["Éclat", "soft bloom, glowing highlights", "bloom", "brightness(1.1) saturate(1.1)", "fx-bloom"],
] as const;
const ratios = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;

let style = styles[0][1];
let effect = effects[0];
let ratio: (typeof ratios)[number] = "16:9";
let resolution: "720p" | "1080p" = "720p";
let imageUrl = "";
let pieces: Piece[] = [];
let width = 0;
let height = 0;
let selected = "";
const buffers = new Map<string, HTMLCanvasElement>();

const prompt = document.querySelector<HTMLTextAreaElement>("#prompt")!;
const negative = document.querySelector<HTMLInputElement>("#negative")!;
const frame = document.querySelector<HTMLDivElement>("#frame")!;
const layers = document.querySelector<HTMLDivElement>("#layers")!;
const moves = document.querySelector<HTMLDivElement>("#moves")!;
const error = document.querySelector<HTMLParagraphElement>("#error")!;
const go = document.querySelector<HTMLButtonElement>("#go")!;
const split = document.querySelector<HTMLButtonElement>("#split")!;
const psd = document.querySelector<HTMLButtonElement>("#psd")!;

function chips(hostId: string, items: { label: string; value: string }[], current: () => string, pick: (value: string) => void) {
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

chips("#styles", styles.map(([label, value]) => ({ label, value })), () => style, (value) => { style = value; });
chips("#effects", effects.map((item) => ({ label: item[0], value: item[2] })), () => effect[2], (value) => {
  effect = effects.find((item) => item[2] === value) ?? effects[0];
  paint();
});
chips("#ratios", ratios.map((label) => ({ label, value: label })), () => ratio, (value) => { ratio = value as typeof ratio; });
chips("#resolutions", ["720p", "1080p"].map((label) => ({ label, value: label })), () => resolution, (value) => { resolution = value as typeof resolution; });

function frameSize() {
  const shortSide = resolution === "1080p" ? 1080 : 720;
  const [w, h] = ratio === "1:1" ? [1, 1] : ratio === "16:9" ? [16, 9] : ratio === "9:16" ? [9, 16] : ratio === "4:3" ? [4, 3] : [3, 4];
  return w >= h ? [Math.round((shortSide * w) / h), shortSide] : [shortSide, Math.round((shortSide * h) / w)];
}

function fail(message: string) {
  error.hidden = false;
  error.textContent = message;
}

go.addEventListener("click", () => {
  const text = prompt.value.trim();
  if (text.length < 2) return;
  error.hidden = true;
  go.disabled = true;
  go.textContent = "Génération…";
  pieces = [];
  buffers.clear();
  renderLayers();
  const [w, h] = frameSize();
  const avoid = negative.value.trim();
  const full = [text, style, effect[1], avoid ? `without ${avoid}` : ""].filter(Boolean).join(", ");
  const seed = Math.floor(Math.random() * 1_000_000_000);
  imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(full)}?width=${w}&height=${h}&nologo=true&model=flux&seed=${seed}`;
  const img = new Image();
  img.onload = () => {
    go.disabled = false;
    go.textContent = "Générer";
    split.hidden = false;
    showImage();
  };
  img.onerror = () => {
    go.disabled = false;
    go.textContent = "Générer";
    fail("L’image n’a pas pu être créée. Réessaie.");
  };
  img.src = imageUrl;
});

split.addEventListener("click", () => void separate());
psd.addEventListener("click", () => void savePsd());

async function separate() {
  if (!imageUrl) return;
  error.hidden = true;
  split.disabled = true;
  split.textContent = "Séparation…";
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
      dy: 0,
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
    fail("La séparation a échoué. Réessaie.");
  } finally {
    split.disabled = false;
    split.textContent = "Séparer les calques";
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
    eye.textContent = piece.visible ? "Visible" : "Masqué";
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
  ["Bas", 0, 16],
] as const) {
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
  psd.textContent = "PSD…";
  try {
    const elementLayers: Layer[] = [...pieces].reverse().map((piece) => ({
      name: piece.name,
      rgba: rasterize(piece),
      blend: "norm",
      opacity: piece.visible ? 255 : 0,
    }));
    const look = effectLayer(width, height, effect[2]);
    const merged = merge(look);
    const bytes = buildPsd(width, height, [...(look ? [look] : []), ...elementLayers], merged);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const url = URL.createObjectURL(new Blob([copy], { type: "image/vnd.adobe.photoshop" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "atelier.psd";
    link.click();
    URL.revokeObjectURL(url);
  } catch {
    fail("L’export a échoué. Réessaie.");
  } finally {
    psd.disabled = false;
    psd.textContent = "Exporter le PSD";
  }
}

function rasterize(piece: Piece) {
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

function merge(look: Layer | null) {
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
    context.globalCompositeOperation =
      look.blend === "sLit" ? "soft-light" : look.blend === "scrn" ? "screen" : look.blend === "over" ? "overlay" : look.blend === "mul " ? "multiply" : "source-over";
    context.globalAlpha = look.opacity / 255;
    context.drawImage(veilCanvas, 0, 0);
  }
  return context.getImageData(0, 0, width, height).data;
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
