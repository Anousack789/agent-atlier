"use client";
import {
  defaultAvatarParts, hairStyles, hairStyleLabels, randomAvatar,
  skinTones, skinColors, type AvatarAppearance,
} from "../shared/avatar";
import { Avatar } from "./Avatar";

export function AvatarEditor({ agent, onChange }: {
  agent: AvatarAppearance & { name: string };
  onChange: (changes: Partial<AvatarAppearance>) => void;
}) {
  const parts = agent.avatarParts;
  return (
    <section className="avatar-editor" aria-label="รูปลักษณ์ตัวละคร">
      <div className="avatar-mode" role="group" aria-label="รูปแบบตัวละคร">
        <button type="button" aria-pressed={!parts}
          onClick={() => onChange({ avatarParts: undefined })}>
          ตัวละครเดิม
        </button>
        <button type="button" aria-pressed={!!parts}
          onClick={() => onChange({ avatarParts: parts || { ...defaultAvatarParts } })}>
          สร้างตัวละคร
        </button>
      </div>
      <div className="avatar-previews">
        <figure><Avatar agent={agent} size={88} /><figcaption>ใบหน้า</figcaption></figure>
        <figure><Avatar agent={agent} size={88} portrait={false} /><figcaption>เต็มตัว</figcaption></figure>
      </div>
      {parts ? (
        <>
          <label>ทรงผม
            <select value={parts.hairStyle} onChange={(event) =>
              onChange({ avatarParts: { ...parts, hairStyle: hairStyles[event.target.selectedIndex] } })}>
              {hairStyles.map((style, index) =>
                <option key={style} value={style}>{hairStyleLabels[index]}</option>)}
            </select>
          </label>
          <fieldset className="skin-tones">
            <legend>สีผิว</legend>
            <div role="group" aria-label="เลือกสีผิว">
              {skinTones.map((tone, index) => (
                <button key={tone} type="button" aria-label={`สีผิวเฉด ${index + 1}`}
                  aria-pressed={parts.skinTone === tone}
                  onClick={() => onChange({ avatarParts: { ...parts, skinTone: tone } })}>
                  <span style={{ backgroundColor: skinColors[tone] }} />
                </button>
              ))}
            </div>
          </fieldset>
          <label className="check">
            <input type="checkbox" checked={parts.glasses} onChange={(event) =>
              onChange({ avatarParts: { ...parts, glasses: event.target.checked } })} />
            ใส่แว่น
          </label>
          <button type="button" onClick={() => onChange(randomAvatar())}>สุ่มตัวละคร</button>
        </>
      ) : (
        <div>
          <strong>เลือกตัวละคร</strong>
          <div className="avatar-choices">
            {[0, 1, 2, 3].map((avatar) => (
              <button type="button" key={avatar} aria-label={`ตัวละคร ${avatar + 1}`}
                aria-pressed={agent.avatar === avatar}
                className={agent.avatar === avatar ? "chosen" : ""}
                onClick={() => onChange({ avatar })}>
                <Avatar agent={{ ...agent, avatar }} size={45} />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="form-row">
        <label>สีผม
          <input type="color" value={agent.hairColor}
            onChange={(event) => onChange({ hairColor: event.target.value })} />
        </label>
        <label>สีเสื้อ
          <input type="color" value={agent.shirtColor}
            onChange={(event) => onChange({ shirtColor: event.target.value })} />
        </label>
      </div>
    </section>
  );
}
