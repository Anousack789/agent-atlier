import type { Agent, AvatarParts } from "./types";

export const hairStyles = ["short", "bob", "long", "curly"] as const;
export const hairStyleLabels = ["สั้น", "บ๊อบ", "ยาว", "หยิก"];
export const skinTones = [
  "porcelain", "light", "medium", "tan", "brown", "deep",
] as const;
export const skinColors: Record<AvatarParts["skinTone"], string> = {
  porcelain: "#f8dfcf",
  light: "#efc6a5",
  medium: "#dba67d",
  tan: "#bb8059",
  brown: "#925c40",
  deep: "#603c30",
};
export const defaultAvatarParts: AvatarParts = {
  hairStyle: "short", skinTone: "medium", glasses: false,
};
const hairColors = ["#302827", "#68432e", "#b88745", "#d7c6aa", "#713f50", "#5a5869"];
const shirtColors = ["#55754f", "#577c96", "#916b96", "#b57952", "#527d79", "#a35e63"];

export type AvatarAppearance = Pick<Agent,
  "avatar" | "hairColor" | "shirtColor" | "avatarParts"
>;

export function randomAvatar(): Pick<Agent, "avatarParts" | "hairColor" | "shirtColor"> {
  const pick = <T,>(values: readonly T[]) => values[Math.floor(Math.random() * values.length)];
  return {
    avatarParts: {
      hairStyle: pick(hairStyles),
      skinTone: pick(skinTones),
      glasses: Math.random() < 0.5,
    },
    hairColor: pick(hairColors),
    shirtColor: pick(shirtColors),
  };
}

export function avatarKey(agent: AvatarAppearance) {
  const parts = agent.avatarParts;
  return JSON.stringify([
    agent.avatar, agent.hairColor, agent.shirtColor,
    parts?.hairStyle, parts?.skinTone, parts?.glasses,
  ]);
}
