import type { AvatarAppearance } from "../shared/avatar";
import { paintAvatarParts } from "./avatar-parts";

let sourcePromise: Promise<HTMLImageElement> | undefined;
export function avatarSource() {
  return (sourcePromise ||= new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      sourcePromise = undefined;
      reject(new Error("โหลดภาพตัวละครไม่สำเร็จ"));
    };
    image.src = "/assets/characters.png";
  }));
}
export function paintAvatar(
  source: HTMLImageElement | null,
  agent: AvatarAppearance,
  portrait = false,
) {
  if (agent.avatarParts) {
    const canvas = paintAvatarParts({ ...agent, avatarParts: agent.avatarParts });
    return portrait ? portraitAvatar(canvas) : canvas;
  }
  if (!source) throw new Error("โหลดภาพตัวละครไม่สำเร็จ");
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.imageSmoothingEnabled = false;
  const cell = source.width / 2,
    row = Math.floor(agent.avatar / 2),
    column = agent.avatar % 2;
  context.drawImage(
    source,
    cell * column,
    cell * row,
    cell,
    cell,
    0,
    0,
    96,
    96,
  );
  const pixels = context.getImageData(0, 0, 96, 96);
  const rgb = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const hair = rgb(agent.hairColor),
    shirt = rgb(agent.shirtColor);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const y = Math.floor(i / 4 / 96),
      [r, g, b, a] = pixels.data.slice(i, i + 4);
    if (a < 30) continue;
    let color: number[] | undefined;
    if (
      y < 34 &&
      Math.max(r, g, b) < 110 &&
      Math.max(r, g, b) - Math.min(r, g, b) < 65
    )
      color = hair;
    const clothing =
      agent.avatar === 0
        ? g > r * 1.12 && g > b * 1.05
        : agent.avatar === 1
          ? g > r * 1.25 && b > r * 1.25
          : agent.avatar === 2
            ? b > r * 1.2 && b > g * 1.08
            : r > g * 1.35 && b > g * 0.8;
    if (y > 32 && y < 62 && clothing) color = shirt;
    if (color) {
      const shade = Math.max(
        0.35,
        Math.min(1.35, Math.max(r, g, b) / (color === hair ? 70 : 150)),
      );
      for (let c = 0; c < 3; c++)
        pixels.data[i + c] = Math.min(255, Math.round(color[c] * shade));
    }
  }
  context.putImageData(pixels, 0, 0);
  if (!portrait) return canvas;
  return portraitAvatar(canvas);
}

function portraitAvatar(canvas: HTMLCanvasElement) {
  const result = document.createElement("canvas");
  result.width = 96;
  result.height = 96;
  const cropped = result.getContext("2d")!;
  cropped.imageSmoothingEnabled = false;
  cropped.drawImage(canvas, 20, 5, 56, 58, 0, 0, 96, 100);
  return result;
}
