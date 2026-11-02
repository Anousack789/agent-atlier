import { test } from "node:test";
import assert from "node:assert/strict";
import { agentInput } from "../shared/validation";
import {
  avatarKey, defaultAvatarParts, hairStyles, skinTones, randomAvatar,
} from "../shared/avatar";

const agent = {
  name: "Test", role: "Designer", instructions: "Test instructions", model: "",
  avatar: 0, hairColor: "#3c332e", shirtColor: "#55754f",
  permission: "read-only", googleAccess: false, seat: { x: 3, y: 15 },
};

test("legacy agents and all supported avatar combinations validate", () => {
  assert.deepEqual(agentInput.parse(agent), agent);
  for (const hairStyle of hairStyles)
    for (const skinTone of skinTones)
      for (const glasses of [false, true]) {
        const avatarParts = { hairStyle, skinTone, glasses };
        assert.deepEqual(agentInput.parse({ ...agent, avatarParts }).avatarParts, avatarParts);
      }
});

test("invalid or incomplete avatar parts are rejected at the save boundary", () => {
  for (const avatarParts of [
    null, {}, "short",
    { ...defaultAvatarParts, hairStyle: "unknown" },
    { ...defaultAvatarParts, skinTone: "#ffffff" },
    { ...defaultAvatarParts, glasses: "true" },
    { ...defaultAvatarParts, url: "https://example.com/avatar.png" },
  ]) assert.equal(agentInput.safeParse({ ...agent, avatarParts }).success, false);
  assert.equal(agentInput.safeParse({ ...agent, hairColor: "red", avatarParts: defaultAvatarParts }).success, false);
});

test("randomization supplies only appearance fields and valid palette choices", () => {
  const original = { ...agent, avatarParts: { ...defaultAvatarParts } };
  const before = structuredClone(original);
  for (let i = 0; i < 100; i++) {
    const appearance = randomAvatar();
    assert.deepEqual(Object.keys(appearance).sort(), ["avatarParts", "hairColor", "shirtColor"]);
    const updated = { ...original, ...appearance };
    assert.equal(agentInput.safeParse(updated).success, true);
    assert.equal(updated.name, original.name);
    assert.equal(updated.role, original.role);
    assert.equal(updated.permission, original.permission);
    assert.equal(updated.seat, original.seat);
  }
  assert.deepEqual(original, before);
});

test("texture identity changes for every appearance field, not for unrelated settings", () => {
  const base = { ...agent, avatarParts: { ...defaultAvatarParts } };
  const key = avatarKey(base);
  for (const update of [
    { avatar: 1 }, { hairColor: "#ffffff" }, { shirtColor: "#ffffff" },
    { avatarParts: { ...defaultAvatarParts, hairStyle: "bob" as const } },
    { avatarParts: { ...defaultAvatarParts, skinTone: "deep" as const } },
    { avatarParts: { ...defaultAvatarParts, glasses: true } },
    { avatarParts: undefined },
  ]) assert.notEqual(avatarKey({ ...base, ...update }), key);
  const renamed = { ...base, name: "Renamed" };
  assert.equal(avatarKey(renamed), key);
  assert.equal(avatarKey({ ...base, avatarParts: { glasses: false, skinTone: "medium", hairStyle: "short" } }), key);
});
