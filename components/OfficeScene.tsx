"use client";
import { useEffect, useRef, useState } from "react";
import type PhaserType from "phaser";
import { Minus, Plus, Info, Expand } from "lucide-react";
import type { Agent, Furniture, Point, Snapshot } from "../shared/types";
import { canPlace, occupiedCells, walkPath } from "../shared/room";
import { paintAvatar } from "./avatar-art";
import { avatarKey } from "../shared/avatar";

type Props = {
  state: Snapshot;
  furniture: Furniture[];
  agents: Agent[];
  editing: boolean;
  selectedAgent: string;
  selectedFurniture: string;
  onSelectAgent: (id: string) => void;
  onSelectFurniture: (id: string) => void;
  onFurniture: (items: Furniture[]) => void;
  onSeat: (id: string, seat: Point) => void;
  onError: (message: string) => void;
};
type Position = { x: number; y: number };
const sizes: Record<Furniture["type"], [number, number]> = {
  desk: [165, 140],
  chair: [72, 72],
  plant: [98, 105],
  meeting: [190, 175],
  sofa: [176, 136],
  bookcase: [180, 122],
};
const frames: Furniture["type"][] = [
  "desk",
  "chair",
  "plant",
  "meeting",
  "sofa",
  "bookcase",
];
const world = (p: Point) => ({ x: p.x * 32, y: p.y * 28 + 50 });
const grid = (x: number, y: number) => ({
  x: Math.max(1, Math.min(28, Math.round(x / 32))),
  y: Math.max(3, Math.min(16, Math.round((y - 50) / 28))),
});

export default function OfficeScene(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const sceneRef = useRef<{
    sync: () => void;
    zoom: (value: number) => void;
  } | null>(null);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    let disposed = false;
    let game: PhaserType.Game | undefined;
    void import("phaser")
      .then(({ default: Phaser }) => {
        if (disposed || !container.current) return;
        class Office extends Phaser.Scene {
          furniture = new Map<string, PhaserType.GameObjects.Image>();
          actors = new Map<
            string,
            {
              image: PhaserType.GameObjects.Image;
              path: Point[];
              goal: string;
              agent: Agent;
            }
          >();
          signature = "";
          lastLabels = 0;
          ready = false;
          constructor() {
            super("office");
          }
          preload() {
            this.load.image("room", "/assets/room.png");
            this.load.image("characters", "/assets/characters.png");
            this.load.image("furniture", "/assets/furniture.png");
            this.load.on("loaderror", () =>
              latest.current.onError(
                "โหลดภาพออฟฟิศไม่สำเร็จ กรุณารีเฟรชหน้าเว็บ",
              ),
            );
          }
          create() {
            this.add
              .image(480, 270, "room")
              .setDisplaySize(960, 540)
              .setDepth(-100);
            const sheet = this.textures.get("furniture");
            const source = sheet.getSourceImage() as HTMLImageElement;
            const width = source.width / 3,
              height = source.height / 2;
            for (let i = 0; i < 6; i++)
              sheet.add(
                i,
                0,
                (i % 3) * width,
                Math.floor(i / 3) * height,
                width,
                height,
              );
            this.input.on(
              "drag",
              (
                _pointer: unknown,
                object: PhaserType.GameObjects.Image,
                x: number,
                y: number,
              ) => {
                if (!latest.current.editing) return;
                const point = world(grid(x, y));
                object.setPosition(point.x, point.y).setDepth(1000);
              },
            );
            this.input.on(
              "dragend",
              (_pointer: unknown, object: PhaserType.GameObjects.Image) => {
                const current = latest.current;
                const point = grid(object.x, object.y);
                const furnitureId = object.getData("furnitureId");
                if (furnitureId) {
                  const original = current.furniture.find(
                    (f) => f.id === furnitureId,
                  )!;
                  const changed = { ...original, ...point };
                  const seats = current.agents.map((a) => a.seat);
                  if (
                    canPlace(changed, current.furniture) &&
                    !occupiedCells(changed).some((p) =>
                      seats.some((s) => s.x === p.x && s.y === p.y),
                    )
                  )
                    current.onFurniture(
                      current.furniture.map((f) =>
                        f.id === furnitureId ? changed : f,
                      ),
                    );
                  else
                    current.onError(
                      "วางตรงนี้ไม่ได้ มีเฟอร์นิเจอร์หรือที่นั่งอยู่แล้ว",
                    );
                  const position = world(
                    current.furniture.find((f) => f.id === furnitureId)!,
                  );
                  object
                    .setPosition(position.x, position.y)
                    .setDepth(position.y);
                } else {
                  const agentId = object.getData("agentId");
                  const blocked = current.furniture
                    .flatMap(occupiedCells)
                    .some((p) => p.x === point.x && p.y === point.y);
                  if (
                    !blocked &&
                    !current.agents.some(
                      (a) =>
                        a.id !== agentId &&
                        a.seat.x === point.x &&
                        a.seat.y === point.y,
                    )
                  )
                    current.onSeat(agentId, point);
                  else current.onError("ที่นั่งต้องอยู่ในพื้นที่ว่าง");
                  const position = world(
                    current.agents.find((a) => a.id === agentId)!.seat,
                  );
                  object
                    .setPosition(position.x, position.y)
                    .setDepth(position.y + 1);
                }
              },
            );
            this.ready = true;
            this.sync();
            sceneRef.current = {
              sync: () => this.sync(),
              zoom: (value) => this.cameras.main.setZoom(value),
            };
          }
          sync() {
            if (!this.ready) return;
            const current = latest.current;
            const signature = JSON.stringify(current.furniture);
            if (signature !== this.signature) {
              this.furniture.forEach((image) => image.destroy());
              this.furniture.clear();
              this.signature = signature;
              for (const item of current.furniture) {
                const position = world(item),
                  size = sizes[item.type];
                const image = this.add
                  .image(
                    position.x,
                    position.y,
                    "furniture",
                    frames.indexOf(item.type),
                  )
                  .setDisplaySize(...size)
                  .setDepth(position.y)
                  .setInteractive({
                    useHandCursor: current.editing,
                    pixelPerfect: true,
                  })
                  .setData("furnitureId", item.id);
                image.on("pointerdown", () => {
                  if (latest.current.editing)
                    latest.current.onSelectFurniture(item.id);
                });
                this.furniture.set(item.id, image);
              }
              this.actors.forEach((actor) => {
                actor.goal = "";
              });
            }
            this.furniture.forEach((image, itemId) => {
              this.input.setDraggable(image, current.editing);
              if (current.editing && current.selectedFurniture === itemId)
                image.setTint(0xc8e5b7);
              else image.clearTint();
            });
            for (const agent of current.agents) {
              const texture = `avatar-${agent.id}-${avatarKey(agent)}`;
              if (!this.textures.exists(texture))
                this.textures.addCanvas(
                  texture,
                  paintAvatar(
                    this.textures
                      .get("characters")
                      .getSourceImage() as HTMLImageElement,
                    agent,
                  ),
                );
              let actor = this.actors.get(agent.id);
              if (!actor) {
                const position = world(agent.seat);
                const image = this.add
                  .image(position.x, position.y, texture)
                  .setOrigin(0.5, 0.9)
                  .setDisplaySize(104, 104)
                  .setInteractive({ useHandCursor: true, pixelPerfect: true })
                  .setData("agentId", agent.id);
                image.on("pointerdown", () =>
                  latest.current.onSelectAgent(agent.id),
                );
                actor = { image, path: [], goal: "", agent };
                this.actors.set(agent.id, actor);
              }
              const previousTexture = actor.image.texture.key;
              actor.image.setTexture(texture);
              if (previousTexture !== texture) this.textures.remove(previousTexture);
              actor.agent = agent;
              this.input.setDraggable(actor.image, current.editing);
              if (current.editing) {
                const p = world(agent.seat);
                actor.image.setPosition(p.x, p.y);
              }
            }
            for (const [agentId, actor] of this.actors)
              if (!current.agents.some((a) => a.id === agentId)) {
                const texture = actor.image.texture.key;
                actor.image.destroy();
                this.textures.remove(texture);
                this.actors.delete(agentId);
              }
          }
          update(time: number, delta: number) {
            if (!this.ready) return;
            const current = latest.current;
            const reducedMotion = window.matchMedia(
              "(prefers-reduced-motion: reduce)",
            ).matches;
            const recent = current.state.messages.filter(
              (m) =>
                m.to &&
                m.from !== "user" &&
                Date.now() - Date.parse(m.createdAt) < 18000,
            );
            for (const [agentId, actor] of this.actors) {
              if (current.editing) continue;
              const conversation = recent.find(
                (m) => m.from === agentId || m.to === agentId,
              );
              const destination = conversation
                ? {
                    x: mIndex(agentId, current.agents) % 2 ? 18 : 10,
                    y:
                      13 +
                      (Math.floor(mIndex(agentId, current.agents) / 2) % 2),
                  }
                : actor.agent.seat;
              const key = `${destination.x},${destination.y}`;
              if (actor.goal !== key) {
                actor.path = walkPath(
                  grid(actor.image.x, actor.image.y),
                  destination,
                  current.furniture,
                );
                actor.goal = key;
              }
              const step = actor.path[0];
              if (step) {
                const target = world(step),
                  dx = target.x - actor.image.x,
                  dy = target.y - actor.image.y,
                  distance = Math.hypot(dx, dy);
                const speed = reducedMotion
                  ? Infinity
                  : Math.min(delta, 100) * 0.11;
                if (distance <= speed) {
                  actor.image.setPosition(target.x, target.y);
                  actor.path.shift();
                } else
                  actor.image.setPosition(
                    actor.image.x + (dx / distance) * speed,
                    actor.image.y + (dy / distance) * speed,
                  );
              }
              const working = current.state.tasks.some(
                (t) => t.agentId === agentId && t.status === "running",
              );
              actor.image
                .setAngle(
                  !reducedMotion && (step || working)
                    ? Math.sin(time / (step ? 110 : 500)) * (step ? 2.5 : 0.5)
                    : 0,
                )
                .setDepth(actor.image.y + 1);
            }
            if (time - this.lastLabels > 100) {
              this.lastLabels = time;
              const camera = this.cameras.main;
              const values: Record<string, Position> = {};
              this.actors.forEach((actor, agentId) => {
                values[agentId] = {
                  x: (((actor.image.x - 480) * camera.zoom + 480) / 960) * 100,
                  y:
                    (((actor.image.y - 90 - 270) * camera.zoom + 270) / 540) *
                    100,
                };
              });
              if (!disposed) setPositions(values);
            }
          }
        }
        game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: container.current,
          width: 960,
          height: 540,
          backgroundColor: "#d1b48c",
          pixelArt: true,
          roundPixels: true,
          fps: { target: 30, forceSetTimeOut: true },
          scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.CENTER_BOTH,
          },
          scene: Office,
          audio: { noAudio: true },
          render: { antialias: false },
        });
      })
      .catch(() => latest.current.onError("เปิดฉากออฟฟิศไม่สำเร็จ"));
    return () => {
      disposed = true;
      sceneRef.current = null;
      game?.destroy(true);
    };
  }, []);
  useEffect(() => {
    sceneRef.current?.sync();
  }, [
    props.state,
    props.agents,
    props.furniture,
    props.editing,
    props.selectedFurniture,
  ]);
  useEffect(() => {
    sceneRef.current?.zoom(zoom);
  }, [zoom]);
  return (
    <div className={`office-scene ${props.editing ? "editing" : ""}`}>
      <div
        ref={container}
        className="phaser-host"
        aria-label="ออฟฟิศ pixel แบบโต้ตอบ"
      />
      <div className="nameplates">
        {props.agents.map((agent) => {
          const position = positions[agent.id];
          const task = props.state.tasks.find(
            (t) =>
              t.agentId === agent.id &&
              (t.status === "running" || t.status === "waiting"),
          );
          return (
            <button
              key={agent.id}
              className={`nameplate ${props.selectedAgent === agent.id ? "selected" : ""}`}
              style={{
                left: `${position?.x ?? (agent.seat.x / 30) * 100}%`,
                top: `${position?.y ?? 20}%`,
              }}
              onClick={() => props.onSelectAgent(agent.id)}
              aria-label={`เลือก ${agent.name}`}
            >
              <strong>{agent.name}</strong>
              <span>
                <i className={`dot ${task?.status || "ready"}`} />
                {task?.status === "waiting"
                  ? "รออนุมัติ"
                  : task
                    ? "กำลังทำงาน"
                    : "พร้อมทำงาน"}
              </span>
            </button>
          );
        })}
      </div>
      <div className="scene-hint">
        <Info size={15} />
        {props.editing
          ? "ลากเฟอร์นิเจอร์หรือตัวละครเพื่อจัดห้อง"
          : "คลิกสมาชิกเพื่อพูดคุย"}
      </div>
      <div className="scene-controls">
        <button
          aria-label="ซูมออก"
          disabled={zoom <= 0.8}
          onClick={() => setZoom((z) => Math.max(0.8, z - 0.1))}
        >
          <Minus size={16} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          aria-label="ซูมเข้า"
          disabled={zoom >= 1.3}
          onClick={() => setZoom((z) => Math.min(1.3, z + 0.1))}
        >
          <Plus size={16} />
        </button>
        <button aria-label="คืนมุมมอง" onClick={() => setZoom(1)}>
          <Expand size={15} />
        </button>
      </div>
    </div>
  );
}
function mIndex(agentId: string, agents: Agent[]) {
  return agents.findIndex((a) => a.id === agentId);
}
