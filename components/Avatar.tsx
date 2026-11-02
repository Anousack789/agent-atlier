"use client";
import { useEffect, useRef, useState } from "react";
import type { AvatarAppearance } from "../shared/avatar";
import { avatarSource, paintAvatar } from "./avatar-art";

export function Avatar({
  agent,
  size = 44,
  portrait = true,
}: {
  agent: AvatarAppearance & { name: string };
  size?: number;
  portrait?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const draw = (source: HTMLImageElement | null) => {
      if (cancelled || !ref.current) return;
      const context = ref.current.getContext("2d");
      context?.clearRect(0, 0, 96, 96);
      context?.drawImage(paintAvatar(source, agent, portrait), 0, 0);
      setError("");
    };
    if (agent.avatarParts) draw(null);
    else
      void avatarSource().then(draw).catch(() => {
        if (!cancelled) setError("โหลดภาพตัวละครไม่สำเร็จ");
      });
    return () => {
      cancelled = true;
    };
  }, [
    agent.avatar, agent.hairColor, agent.shirtColor,
    agent.avatarParts?.hairStyle, agent.avatarParts?.skinTone,
    agent.avatarParts?.glasses, portrait,
  ]);
  return (
    <>
      <canvas
        ref={ref}
        width={96}
        height={96}
        className="avatar"
        role="img"
        aria-label={`${portrait ? "ใบหน้า" : "ตัวละครเต็มตัว"} ${agent.name}`}
        style={{ width: size, height: size }}
      />
      {error && <span role="alert">{error}</span>}
    </>
  );
}
