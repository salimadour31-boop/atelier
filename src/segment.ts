export type ElementLayer = { name: string; rgba: Uint8ClampedArray };

const NAMES = [
  [345, 20, "Rouge"],
  [20, 45, "Roux"],
  [45, 70, "Jaune"],
  [70, 165, "Vert"],
  [165, 255, "Bleu"],
  [255, 320, "Violet"],
  [320, 345, "Rose"],
] as const;

export function splitElements(rgba: Uint8ClampedArray, width: number, height: number): ElementLayer[] {
  const maxSide = 420;
  const sw = Math.max(1, Math.round(width * Math.min(1, maxSide / width)));
  const sh = Math.max(1, Math.round(height * Math.min(1, maxSide / height)));
  const small = new Uint8ClampedArray(sw * sh * 3);
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / sw));
      const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / sh));
      const source = (sy * width + sx) * 4;
      const target = (y * sw + x) * 3;
      small[target] = rgba[source];
      small[target + 1] = rgba[source + 1];
      small[target + 2] = rgba[source + 2];
    }
  }

  const color = cluster(small, sw * sh, 5);
  const owner = new Int32Array(sw * sh);
  const parts: { cells: number[]; count: number; red: number; green: number; blue: number }[] = [];
  const seen = new Uint8Array(sw * sh);
  const stack: number[] = [];
  for (let start = 0; start < sw * sh; start += 1) {
    if (seen[start]) continue;
    const label = color[start];
    stack.push(start);
    seen[start] = 1;
    const cells: number[] = [];
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
  const used = new Set<string>();
  const named = main.map((part) => ({ ...part, name: colorName(part.red, part.green, part.blue, used) }));
  const details = parts.filter((part) => !keep.has(part));
  const layers = named.map(() => new Uint8ClampedArray(width * height * 4));
  const detail = details.length ? new Uint8ClampedArray(width * height * 4) : null;
  const smallOwner = new Int32Array(sw * sh).fill(-1);
  named.forEach((part, index) => {
    for (const cell of part.cells) smallOwner[cell] = index;
  });

  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / width));
      const index = smallOwner[sy * sw + sx];
      const source = (y * width + x) * 4;
      const target = index >= 0 ? layers[index] : detail;
      if (!target) continue;
      target[source] = rgba[source];
      target[source + 1] = rgba[source + 1];
      target[source + 2] = rgba[source + 2];
      target[source + 3] = 255;
    }
  }

  const result = named.map((part, index) => ({ name: part.name, rgba: layers[index] }));
  if (detail) result.push({ name: uniqueName("Détails", used), rgba: detail });
  return result;
}

function cluster(pixels: Uint8ClampedArray, count: number, groups: number) {
  const step = Math.max(1, Math.floor(count / 1200));
  const centers: number[][] = [];
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
        const distance =
          (red - centers[group][0]) ** 2 + (green - centers[group][1]) ** 2 + (blue - centers[group][2]) ** 2;
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

function colorName(red: number, green: number, blue: number, used: Set<string>) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const base =
    saturation < 0.18 ? (max > 180 ? "Clair" : max < 80 ? "Ombre" : "Gris") : hueName(hue(red, green, blue));
  return uniqueName(base, used);
}

function uniqueName(base: string, used: Set<string>) {
  let name = base;
  let index = 2;
  while (used.has(name)) {
    name = `${base} ${index}`;
    index += 1;
  }
  used.add(name);
  return name;
}

function hue(red: number, green: number, blue: number) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min || 1;
  const value =
    max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return (value * 60 + 360) % 360;
}

function hueName(value: number) {
  for (const [from, to, name] of NAMES) {
    if (from > to) {
      if (value >= from || value < to) return name;
    } else if (value >= from && value < to) return name;
  }
  return "Teinte";
}
