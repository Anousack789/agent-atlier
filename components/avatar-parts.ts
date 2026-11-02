import type { AvatarParts } from "../shared/types";
import { skinColors, type AvatarAppearance } from "../shared/avatar";

// Each character is one pixel on the 32×32 grid; dots leave lower layers visible.
const hairMasks: Record<AvatarParts["hairStyle"], string[]> = {
  short: [
    ".....OOOOOO.....", "...OOHHLLHHOO...", "..OHHLLHHHHHHO..",
    ".OHLLHHHHHHHHHO.", ".OHHHHHHHHHHHHO.", "OHHHHHSHHHHHHHHO",
    "OHHHHSSHHHSHHHHO", "OHHSO..OSS.OHHHO", ".OHO........OHO.",
    ".OHO........OHO.", "..O..........O..",
  ],
  bob: [
    ".....OOOOOO.....", "...OOHLLLHHOO...", "..OHLLHHHHHHHO..",
    ".OHLLHHHHHHHHHO.", ".OHLHHHHHHHHHHO.", "OHHHHHHHHHHHHHHO",
    "OHHHHHHHHHHHHHHO", "OHHSSSSSSSSSHHHO", "OHHO........OHHO",
    "OHHO........OHHO", "OHHO........OHHO", "OHHO........OHHO",
    "OHHO........OHHO", "OHHO........OHHO", "OSSO........OSSO",
    ".OO..........OO.",
  ],
  long: [
    ".....OOOOOO.....", "...OOHLLHHHOO...", "..OHLLHHSHHHHO..",
    ".OHLLHHHSHHHHHO.", ".OHLHHHSSHHHHHO.", "OHHLHHHSSHHHHHHO",
    "OHHHHHO.OHHHHHHO", "OHHHHO...OHHHHHO", "OHHHO.....OHHHHO",
    "OHHO........OHHO", "OHHO........OHHO", "OHHO........OHHO",
    "OHHO........OHHO", "OHHO........OHHO", "OHHO........OHHO",
    "OHHO........OHHO", "OHHO........OHHO", "OHHO........OHHO",
    "OSSO........OSSO", ".OO..........OO.",
  ],
  curly: [
    "...OO..OO.OO....", "..OHLOOHLOHHO...", ".OHLLHHHHHHHHO..",
    "OOHHHHLHHHLHHOO.", "OHHLHHHHHHHHHHHO", "OHHHHHSHHHSHHHHO",
    ".OHHSHHHSHHHHHO.", "OHHHOOSHHOOSHHHO", ".OHO...OO...OHO.",
    "OHHO........OHHO", ".OHO........OHO.", "..O..........O..",
  ],
};

function shade(hex: string, factor: number) {
  return `rgb(${[1, 3, 5].map((i) =>
    Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * factor)),
  ).join(",")})`;
}

export function paintAvatarParts(agent: AvatarAppearance & { avatarParts: AvatarParts }) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  const skin = skinColors[agent.avatarParts.skinTone];
  const outline = "#302b30";
  const rect = (color: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  // Body and face share fixed anchors with every hair mask and the portrait crop.
  rect(outline, 10, 25, 12, 5);
  rect("#4b4c58", 11, 25, 4, 4);
  rect("#4b4c58", 17, 25, 4, 4);
  rect(outline, 9, 29, 6, 2);
  rect(outline, 17, 29, 6, 2);
  rect(outline, 10, 17, 12, 10);
  rect(outline, 8, 19, 16, 6);
  rect(agent.shirtColor, 11, 18, 10, 8);
  rect(agent.shirtColor, 9, 20, 3, 4);
  rect(agent.shirtColor, 20, 20, 3, 4);
  rect(shade(agent.shirtColor, 0.72), 11, 24, 10, 2);
  rect(shade(agent.shirtColor, 1.18), 11, 19, 2, 5);
  rect(shade(agent.shirtColor, 0.65), 15, 20, 1, 6);
  rect("#ddd5c1", 16, 21, 1, 1);
  rect("#ddd5c1", 16, 24, 1, 1);
  rect(skin, 9, 24, 2, 2);
  rect(skin, 21, 24, 2, 2);
  rect(shade(skin, 0.8), 14, 16, 4, 3);
  rect(shade(agent.shirtColor, 1.2), 12, 18, 2, 2);
  rect(shade(agent.shirtColor, 1.2), 18, 18, 2, 2);
  rect(outline, 10, 5, 12, 11);
  rect(outline, 12, 15, 8, 3);
  rect(shade(skin, 0.8), 9, 10, 14, 4);
  rect(skin, 11, 6, 10, 9);
  rect(skin, 12, 14, 8, 3);
  rect(shade(skin, 1.1), 12, 7, 6, 3);
  rect(shade(skin, 0.82), 19, 10, 2, 5);
  rect(outline, 12, 11, 2, 2);
  rect(outline, 18, 11, 2, 2);
  rect("#fff1d9", 12, 11, 1, 1);
  rect("#fff1d9", 18, 11, 1, 1);
  rect(shade(skin, 0.7), 15, 13, 1, 1);
  rect(shade(skin, 0.65), 15, 15, 3, 1);
  const colors: Record<string, string> = {
    O: outline, H: agent.hairColor,
    L: shade(agent.hairColor, 1.3), S: shade(agent.hairColor, 0.7),
  };
  hairMasks[agent.avatarParts.hairStyle].forEach((row, y) => {
    [...row].forEach((pixel, x) => {
      if (pixel !== ".") rect(colors[pixel], x + 8, y + 2, 1, 1);
    });
  });
  if (agent.avatarParts.glasses) {
    const frame = agent.avatarParts.skinTone === "deep" ? "#d9c9a6" : outline;
    for (const x of [10, 17]) {
      rect(frame, x, 10, 5, 1);
      rect(frame, x, 13, 5, 1);
      rect(frame, x, 10, 1, 4);
      rect(frame, x + 4, 10, 1, 4);
    }
    rect(frame, 15, 11, 2, 1);
  }
  const result = document.createElement("canvas");
  result.width = result.height = 96;
  const scaled = result.getContext("2d")!;
  scaled.imageSmoothingEnabled = false;
  scaled.drawImage(canvas, 0, 0, 96, 96);
  return result;
}
