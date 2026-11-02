"use client";
import { useEffect, useState } from "react";
import type { RolePreset } from "../shared/role-presets";
import type {
  Agent,
  Memory,
  Project,
  Schedule,
  Snapshot,
} from "../shared/types";
import { AvatarEditor } from "./AvatarEditor";
import { occupiedCells } from "../shared/room";

type Action = <T = unknown>(name: string, data?: unknown) => Promise<T>;
const defaultInstructions = "ช่วยทำงานที่ได้รับมอบหมายอย่างรอบคอบ ถามเมื่อข้อมูลไม่พอ และรายงานสิ่งที่ทำกับข้อจำกัดอย่างชัดเจน";
function SaveButton({
  busy,
  children = "บันทึก",
}: {
  busy: boolean;
  children?: React.ReactNode;
}) {
  return (
    <button type="submit" className="primary" disabled={busy}>
      {busy ? "กำลังบันทึก…" : children}
    </button>
  );
}
export function AgentForm({
  agent,
  state,
  action,
  done,
}: {
  agent?: Agent;
  state: Snapshot;
  action: Action;
  done: () => void;
}) {
  const [draft, setDraft] = useState<Agent>(
    agent || {
      id: "",
      name: "",
      role: "General Assistant",
      instructions: defaultInstructions,
      model: "",
      avatar: 0,
      hairColor: "#3c332e",
      shirtColor: "#55754f",
      permission: "read-only",
      googleAccess: false,
      seat: freeSeat(state),
    },
  );
  const [busy, setBusy] = useState(false);
  const [isNew] = useState(!agent);
  const [presets, setPresets] = useState<RolePreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState(
    agent?.promptPresetId || (isNew ? "general-assistant" : ""),
  );
  const [presetError, setPresetError] = useState("");
  const [presetLoading, setPresetLoading] = useState(true);
  const [presetAttempt, setPresetAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPresetLoading(true);
    setPresetError("");
    async function load() {
      try {
        const response = await fetch("/api/role-presets", {
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "โหลด preset ไม่สำเร็จ");
        if (controller.signal.aborted) return;
        setPresets(result.presets);
        const general = (result.presets as RolePreset[]).find(
          (p) => p.id === "general-assistant",
        );
        if (isNew && general)
          setDraft((old) =>
            old.instructions === defaultInstructions &&
            old.role === "General Assistant" && !old.promptPresetId
              ? { ...old, instructions: general.instructions, promptPresetId: general.id }
              : old,
          );
      } catch (error) {
        if (!controller.signal.aborted)
          setPresetError(`โหลด preset ไม่สำเร็จ: ${error instanceof Error ? error.message : "เชื่อมต่อไม่ได้"}`);
      } finally {
        if (!controller.signal.aborted) setPresetLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [isNew, presetAttempt]);
  const selectedPreset = presets.find((p) => p.id === selectedPresetId);
  const applyPreset = (changeRole: boolean) => {
    if (!selectedPreset) return;
    setDraft((old) => ({
      ...old,
      instructions: selectedPreset.instructions,
      promptPresetId: selectedPreset.id,
      ...(changeRole ? { role: selectedPreset.role } : {}),
    }));
  };
  const set = <K extends keyof Agent>(key: K, value: Agent[K]) =>
    setDraft((old) => ({ ...old, [key]: value }));
  return (
    <form
      className="form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await action("agent.save", { ...draft, id: draft.id || undefined });
          done();
        } catch {
        } finally {
          setBusy(false);
        }
      }}
    >
      <AvatarEditor
        agent={draft}
        onChange={(changes) => setDraft((old) => ({ ...old, ...changes }))}
      />
      <div className="form-row">
        <label>
          ชื่อ
          <input
            required
            maxLength={40}
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </label>
        <label>
          บทบาท
          <input
            required
            maxLength={80}
            value={draft.role}
            onChange={(e) => set("role", e.target.value)}
          />
        </label>
      </div>
      <label>
        Model
        <select
          value={draft.model}
          onChange={(e) => set("model", e.target.value)}
        >
          <option value="">Codex default</option>
          {state.models.map((m) => (
            <option key={m.model} value={m.model}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="role-preset-controls" disabled={busy}>
        <legend>Preset ตามบทบาท</legend>
        <label>
          เลือก preset
          <select
            value={selectedPresetId}
            disabled={presetLoading || !presets.length}
            onChange={(e) => setSelectedPresetId(e.target.value)}
          >
            <option value="">เลือกบทบาท…</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
          </select>
        </label>
        {presetLoading && <p role="status">กำลังโหลด preset…</p>}
        {presetError && (
          <div role="alert">
            <p>{presetError}</p>
            <button type="button" onClick={() => setPresetAttempt((old) => old + 1)}>
              ลองโหลด preset อีกครั้ง
            </button>
          </div>
        )}
        {selectedPreset && (
          <details>
            <summary>ดูตัวอย่าง Markdown — {selectedPreset.role}</summary>
            <pre className="role-preset-preview">{selectedPreset.instructions}</pre>
          </details>
        )}
        <p id="preset-replacement-note">ใช้ preset จะแทนที่บทบาทและ prompt ฉบับร่าง ส่วนรีเซ็ตจะแทนที่เฉพาะ prompt ด้วย preset ที่เลือก มีผลเมื่อกดบันทึกเท่านั้น</p>
        <div className="form-row">
          <button type="button" disabled={!selectedPreset || presetLoading}
            aria-describedby="preset-replacement-note" onClick={() => applyPreset(true)}>
            ใช้ preset
          </button>
          <button type="button" disabled={!selectedPreset || presetLoading}
            aria-describedby="preset-replacement-note" onClick={() => applyPreset(false)}>
            รีเซ็ต prompt
          </button>
        </div>
      </fieldset>
      <label>
        System prompt / คำสั่งประจำตัว (Markdown)
        <textarea
          required
          rows={12}
          maxLength={16000}
          value={draft.instructions}
          onChange={(e) => set("instructions", e.target.value)}
        />
        <small>แก้ไข Markdown ได้ ส่งเป็น developer instructions ของสมาชิก ภายใต้ข้อกำหนดของ Codex</small>
      </label>
      <label>
        สิทธิ์ในโปรเจกต์
        <select
          value={draft.permission}
          onChange={(e) =>
            set("permission", e.target.value as Agent["permission"])
          }
        >
          <option value="read-only">
            อ่านและวิเคราะห์ — ขออนุมัติเมื่อใช้สิทธิ์เพิ่ม
          </option>
          <option value="workspace-write">
            แก้ไฟล์และรันคำสั่งในพื้นที่โปรเจกต์
          </option>
        </select>
      </label>
      <div className="form-row">
        <label>
          ที่นั่ง X
          <input
            type="number"
            min={1}
            max={28}
            required
            value={draft.seat.x}
            onChange={(e) =>
              set("seat", { ...draft.seat, x: Number(e.target.value) })
            }
          />
        </label>
        <label>
          ที่นั่ง Y
          <input
            type="number"
            min={3}
            max={16}
            required
            value={draft.seat.y}
            onChange={(e) =>
              set("seat", { ...draft.seat, y: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.googleAccess}
          onChange={(e) => set("googleAccess", e.target.checked)}
        />
        อนุญาตให้ใช้ Gmail และ Google Calendar
      </label>
      <small>การส่งอีเมลหรือเปลี่ยนนัดหมายยังต้องรอคุณอนุมัติทุกครั้ง</small>
      <footer>
        <SaveButton busy={busy} />
      </footer>
    </form>
  );
}
function freeSeat(state: Snapshot) {
  const blocked = new Set(
    state.layout.furniture.flatMap(occupiedCells).map((p) => `${p.x},${p.y}`),
  );
  for (let y = 6; y <= 16; y++)
    for (let x = 3; x <= 27; x += 3)
      if (
        !blocked.has(`${x},${y}`) &&
        !state.agents.some((a) => a.seat.x === x && a.seat.y === y)
      )
        return { x, y };
  return { x: 25, y: 15 };
}
export function TaskForm({
  state,
  projectId,
  agentId,
  action,
  done,
}: {
  state: Snapshot;
  projectId: string;
  agentId: string;
  action: Action;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusy(true);
        try {
          await action("task.create", Object.fromEntries(form));
          done();
        } catch {
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        ชื่องาน
        <input
          name="title"
          required
          maxLength={160}
          placeholder="เช่น สรุปอีเมลและสิ่งที่ต้องทำวันนี้"
        />
      </label>
      <div className="form-row">
        <label>
          โปรเจกต์
          <select name="projectId" defaultValue={projectId}>
            {state.projects.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          มอบหมายให้
          <select name="agentId" defaultValue={agentId}>
            {state.agents.map((a) => (
              <option value={a.id} key={a.id}>
                {a.name} · {a.role}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        ประเภทงาน
        <select name="kind">
          <option value="general">งานทั่วไป / วิเคราะห์ / ค้นคว้า</option>
          <option value="code">แก้โค้ดใน Git worktree แยก</option>
        </select>
      </label>
      <label>
        เป้าหมายและข้อมูลประกอบ
        <textarea
          name="prompt"
          required
          rows={6}
          maxLength={16000}
          placeholder="อธิบายผลลัพธ์ที่ต้องการ ข้อจำกัด และข้อมูลที่ทีมควรรู้"
        />
      </label>
      <p className="note">
        งานโค้ดต้องมี Git พร้อม initial commit และสมาชิกต้องได้รับสิทธิ์แก้ไฟล์
      </p>
      <footer>
        <SaveButton busy={busy}>มอบหมายงาน</SaveButton>
      </footer>
    </form>
  );
}
export function ProjectForm({
  project,
  action,
  done,
}: {
  project?: Project;
  action: Action;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        setBusy(true);
        try {
          await action("project.save", { ...data, id: project?.id });
          done();
        } catch {
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        ชื่อโปรเจกต์
        <input
          name="name"
          required
          maxLength={80}
          defaultValue={project?.name}
        />
      </label>
      <label>
        โฟลเดอร์ในเครื่อง
        <input
          name="path"
          required
          defaultValue={project?.path}
          placeholder="/Users/your-name/projects/my-project"
          spellCheck={false}
        />
        <small>ใช้ path แบบเต็มของโฟลเดอร์ที่มีอยู่แล้ว</small>
      </label>
      <footer>
        <SaveButton busy={busy} />
      </footer>
    </form>
  );
}
export function MemoryForm({
  memory,
  state,
  projectId,
  agentId,
  action,
  done,
}: {
  memory?: Memory;
  state: Snapshot;
  projectId: string;
  agentId: string;
  action: Action;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        setBusy(true);
        try {
          await action("memory.save", {
            ...data,
            id: memory?.id,
            agentId: data.agentId || null,
          });
          done();
        } catch {
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        โปรเจกต์
        <select name="projectId" defaultValue={memory?.projectId || projectId}>
          {state.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        ใครใช้ความทรงจำนี้
        <select
          name="agentId"
          defaultValue={memory ? memory.agentId || "" : agentId}
        >
          <option value="">ความรู้ร่วมของโปรเจกต์</option>
          {state.agents.map((a) => (
            <option value={a.id} key={a.id}>
              ส่วนตัวของ {a.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        ข้อมูลที่ควรจำ
        <textarea
          name="text"
          required
          maxLength={16000}
          rows={6}
          defaultValue={memory?.text}
        />
      </label>
      <p className="note">
        อย่าบันทึกรหัสผ่านหรือ token
        สมาชิกจะใช้เฉพาะความทรงจำส่วนตัวและความรู้ร่วมของโปรเจกต์ปัจจุบัน
      </p>
      <footer>
        <SaveButton busy={busy} />
      </footer>
    </form>
  );
}
export function ScheduleForm({
  schedule,
  state,
  projectId,
  agentId,
  action,
  done,
}: {
  schedule?: Schedule;
  state: Snapshot;
  projectId: string;
  agentId: string;
  action: Action;
  done: () => void;
}) {
  const [frequency, setFrequency] = useState(schedule?.frequency || "daily");
  const [busy, setBusy] = useState(false);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Vientiane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return (
    <form
      className="form"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        setBusy(true);
        try {
          await action("schedule.save", {
            ...data,
            id: schedule?.id,
            enabled: data.enabled === "on",
            weekday: Number(data.weekday || 1),
            date: data.date || today,
          });
          done();
        } catch {
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        ชื่อตารางงาน
        <input
          name="name"
          required
          maxLength={100}
          defaultValue={schedule?.name}
        />
      </label>
      <div className="form-row">
        <label>
          โปรเจกต์
          <select
            name="projectId"
            defaultValue={schedule?.projectId || projectId}
          >
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          สมาชิก
          <select name="agentId" defaultValue={schedule?.agentId || agentId}>
            {state.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-row">
        <label>
          ความถี่
          <select
            name="frequency"
            value={frequency}
            onChange={(e) =>
              setFrequency(e.target.value as Schedule["frequency"])
            }
          >
            <option value="once">ครั้งเดียว</option>
            <option value="daily">ทุกวัน</option>
            <option value="weekly">ทุกสัปดาห์</option>
          </select>
        </label>
        <label>
          เวลา
          <input
            name="time"
            type="time"
            required
            defaultValue={schedule?.time || "09:00"}
          />
        </label>
      </div>
      {frequency === "once" && (
        <label>
          วันที่
          <input
            name="date"
            type="date"
            required
            defaultValue={schedule?.date || today}
          />
        </label>
      )}
      {frequency === "weekly" && (
        <label>
          วัน
          <select name="weekday" defaultValue={schedule?.weekday ?? 1}>
            {[
              "อาทิตย์",
              "จันทร์",
              "อังคาร",
              "พุธ",
              "พฤหัสบดี",
              "ศุกร์",
              "เสาร์",
            ].map((day, i) => (
              <option key={i} value={i}>
                {day}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        เขตเวลา
        <input
          name="timezone"
          required
          defaultValue={schedule?.timezone || "Asia/Vientiane"}
        />
      </label>
      <label>
        ประเภทงาน
        <select name="kind" defaultValue={schedule?.kind || "general"}>
          <option value="general">งานทั่วไป</option>
          <option value="code">แก้โค้ดใน worktree</option>
        </select>
      </label>
      <label>
        คำสั่งเมื่อถึงเวลา
        <textarea
          name="prompt"
          required
          rows={4}
          maxLength={16000}
          defaultValue={schedule?.prompt}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={schedule?.enabled ?? true}
        />
        เปิดใช้งานตารางนี้
      </label>
      <p className="note">
        ต้องเปิดเครื่องและเซิร์ฟเวอร์ไว้ เมื่อพลาดเวลา
        ระบบจะชดเชยหนึ่งงานโดยไม่ทำรอบเดิมซ้อนกัน
      </p>
      <footer>
        <SaveButton busy={busy} />
      </footer>
    </form>
  );
}
