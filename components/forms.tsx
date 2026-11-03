"use client";
import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import type { RolePreset } from "../shared/role-presets";
import type {
  Agent,
  Memory,
  Project,
  Repository,
  Schedule,
  Snapshot,
  Task,
  WorkflowTemplate,
} from "../shared/types";
import { AvatarEditor } from "./AvatarEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { occupiedCells } from "../shared/room";
import { projectRepositories } from "../shared/projects";

type Action = <T = unknown>(name: string, data?: unknown) => Promise<T>;
const defaultInstructions = "ช่วยทำงานที่ได้รับมอบหมายอย่างรอบคอบ ถามเมื่อข้อมูลไม่พอ และรายงานสิ่งที่ทำกับข้อจำกัดอย่างชัดเจน";
const defaultModelValue = "__codex_default__";
const noPresetValue = "__no_preset__";
const sharedMemoryValue = "__shared_memory__";
function SaveButton({
  busy,
  disabled = false,
  children = "บันทึก",
}: {
  busy: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <button type="submit" className="primary" disabled={busy || disabled}>
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
  const [saveError, setSaveError] = useState("");
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
  const selectedModel = state.models.find((m) => draft.model ? m.model === draft.model : m.isDefault);
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
        setSaveError("");
        try {
          const saved = await action<Agent>("agent.save", { ...draft, id: draft.id || undefined });
          if ((saved.reasoningEffort || "") !== (draft.reasoningEffort || ""))
            throw new Error("บันทึก reasoning effort ไม่สำเร็จ กรุณารีสตาร์ตเซิร์ฟเวอร์แล้วลองอีกครั้ง");
          done();
        } catch (error) {
          setSaveError(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
        } finally {
          setBusy(false);
        }
      }}
    >
      {saveError && <p role="alert">{saveError}</p>}
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(250px,1fr)_minmax(0,2fr)] lg:items-start">
      <AvatarEditor
        agent={draft}
        onChange={(changes) => setDraft((old) => ({ ...old, ...changes }))}
      />
      <div className="form min-w-0">
      <label className="check">
        <input type="checkbox" checked={!!draft.boss} onChange={(event) => set("boss", event.target.checked)} />
        ให้สมาชิกนี้เป็น Boss ของห้องรวม
      </label>
      <p className="note">เลือก Boss ได้หนึ่งคนต่อออฟฟิศ การเลือกคนนี้จะแทนที่ Boss เดิม ใช้ prompt กลางสำหรับตีความและเสนอแผนกระจายงาน โดยไม่เพิ่มสิทธิ์ของสมาชิก</p>
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
        <Select value={draft.model || defaultModelValue} onValueChange={(value) => {
          const model = value === defaultModelValue ? "" : value;
          const selected = state.models.find((m) => model ? m.model === model : m.isDefault);
          setDraft((old) => ({ ...old, model, reasoningEffort: selected?.supportedReasoningEfforts?.some((e) => e.reasoningEffort === old.reasoningEffort) ? old.reasoningEffort : "" }));
        }}>
          <SelectTrigger><SelectValue placeholder="Codex default" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={defaultModelValue}>Codex default</SelectItem>
          {state.models.map((m) => (
            <SelectItem key={m.model} value={m.model}>
              {m.displayName}
            </SelectItem>
          ))}
          </SelectContent>
        </Select>
      </label>
      <label>
        Reasoning effort
        <Select value={draft.reasoningEffort || defaultModelValue} onValueChange={(value) => set("reasoningEffort", value === defaultModelValue ? "" : value)}>
          <SelectTrigger aria-label="Reasoning effort"><SelectValue placeholder="ค่าเริ่มต้น" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={defaultModelValue}>ค่าเริ่มต้น{selectedModel?.defaultReasoningEffort ? ` (${selectedModel.defaultReasoningEffort})` : ""}</SelectItem>
            {selectedModel?.supportedReasoningEfforts?.map((effort) => (
              <SelectItem key={effort.reasoningEffort} value={effort.reasoningEffort}>{effort.reasoningEffort}</SelectItem>
            ))}
            {draft.reasoningEffort && !selectedModel?.supportedReasoningEfforts?.some((e) => e.reasoningEffort === draft.reasoningEffort) && (
              <SelectItem value={draft.reasoningEffort} disabled>{draft.reasoningEffort} (ไม่รองรับ)</SelectItem>
            )}
          </SelectContent>
        </Select>
      </label>
      <fieldset className="role-preset-controls" disabled={busy}>
        <legend>Preset ตามบทบาท</legend>
        <label>
          เลือก preset
          <Select
            value={selectedPresetId || noPresetValue}
            disabled={presetLoading || !presets.length}
            onValueChange={(value) => setSelectedPresetId(value === noPresetValue ? "" : value)}
          >
            <SelectTrigger><SelectValue placeholder="เลือกบทบาท…" /></SelectTrigger>
            <SelectContent>
            <SelectItem value={noPresetValue}>ไม่เลือก preset</SelectItem>
            {presets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>{preset.label}</SelectItem>
            ))}
            </SelectContent>
          </Select>
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
        <Select value={draft.permission} onValueChange={(value) => set("permission", value as Agent["permission"])}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
          <SelectItem value="read-only">
            อ่านและวิเคราะห์ — ขออนุมัติเมื่อใช้สิทธิ์เพิ่ม
          </SelectItem>
          <SelectItem value="workspace-write">
            แก้ไฟล์และรันคำสั่งในพื้นที่โปรเจกต์
          </SelectItem>
          </SelectContent>
        </Select>
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
      <label className="check">
        <input type="checkbox" checked={draft.serena !== false} onChange={(e) => set("serena", e.target.checked)} />
        ใช้ Serena MCP
      </label>
      <label className="check">
        <input type="checkbox" checked={draft.ponytail !== false} onChange={(e) => set("ponytail", e.target.checked)} />
        ใช้ ponytail full
      </label>
      <small>การตั้งค่า Serena และ ponytail มีผลกับรอบถัดไป</small>
      <small>การส่งอีเมลหรือเปลี่ยนนัดหมายยังต้องรอคุณอนุมัติทุกครั้ง</small>
      </div>
      </div>
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
  openTask,
}: {
  state: Snapshot;
  projectId: string;
  agentId: string;
  action: Action;
  done: () => void;
  openTask: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [selectedProject, setSelectedProject] = useState(projectId);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [templateId, setTemplateId] = useState("none");
  const [templateName, setTemplateName] = useState("");
  const [templateError, setTemplateError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    action<WorkflowTemplate[]>("template.list", { projectId: selectedProject }).then((items) => { if (current) setTemplates(items); }).catch((e) => { if (current) setTemplateError(e instanceof Error ? e.message : "โหลดเทมเพลตไม่ได้"); });
    return () => { current = false; };
  }, [action, selectedProject, refresh]);
  const template = templates.find((item) => item.id === templateId);
  if (template) return <form className="form" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setTemplateError("");
    try {
      const task = await action<Task>("template.createDraft", { projectId: selectedProject, id: template.id, prompt: new FormData(event.currentTarget).get("prompt") });
      openTask(task.id);
    } catch (e) { setTemplateError(e instanceof Error ? e.message : "สร้างร่างไม่ได้"); }
    finally { setBusy(false); }
  }}>
    <p>โปรเจกต์: {state.projects.find((p) => p.id === selectedProject)?.name} · เทมเพลต: {template.name}</p>
    <label>โจทย์รอบใหม่<textarea name="prompt" required maxLength={16000} rows={6} /></label>
    <p className="note">สร้างเฉพาะร่าง ตรวจและแก้แผนก่อนยืนยันเริ่มงาน</p>
    {templateError && <p role="alert" className="inline-error">{templateError}</p>}
    <div className="flex flex-wrap gap-2"><button className="primary" disabled={busy}>เปิดแผนร่าง</button><button type="button" onClick={() => setTemplateId("none")}>กลับไปเลือก</button></div>
  </form>;
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
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-start">
      <div className="form min-w-0">
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
          <Select name="projectId" value={selectedProject} onValueChange={(value) => { setSelectedProject(value); setTemplates([]); setTemplateId("none"); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
            {state.projects.map((p) => (
              <SelectItem value={p.id} key={p.id}>
                {p.name}
              </SelectItem>
            ))}
            </SelectContent>
          </Select>
        </label>
        <label>
          มอบหมายให้
          <Select name="agentId" defaultValue={agentId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
            {state.agents.map((a) => (
              <SelectItem value={a.id} key={a.id}>
                {a.name} · {a.role}
              </SelectItem>
            ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <div className="space-y-2">
        <label>เทมเพลตของโปรเจกต์
          <Select value={templateId} onValueChange={(value) => { setTemplateId(value); setTemplateName(templates.find((t) => t.id === value)?.name || ""); }}>
            <SelectTrigger aria-label="เลือกเทมเพลต"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">สร้างงานตามปกติ</SelectItem>{templates.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        {templates.map((item) => <details key={item.id}><summary>{item.name}</summary>
          <label>เปลี่ยนชื่อ<input defaultValue={item.name} onChange={(event) => setTemplateName(event.target.value)} /></label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={async (event) => { const input = event.currentTarget.parentElement?.previousElementSibling?.querySelector("input"); try { await action("template.rename", { projectId: selectedProject, id: item.id, name: input?.value || templateName }); setRefresh((n) => n + 1); } catch (e) { setTemplateError(e instanceof Error ? e.message : "เปลี่ยนชื่อไม่ได้"); } }}>บันทึกชื่อ</button>
            <button type="button" onClick={async () => { if (!window.confirm(`ลบเทมเพลต ${item.name}?`)) return; try { await action("template.delete", { projectId: selectedProject, id: item.id }); setRefresh((n) => n + 1); } catch (e) { setTemplateError(e instanceof Error ? e.message : "ลบไม่ได้"); } }}>ลบเทมเพลต</button>
            {state.tasks.some((t) => t.id === item.sourceTaskId && t.projectId === selectedProject) && <button type="button" onClick={() => openTask(item.sourceTaskId)}>เปิดงานต้นทาง</button>}
          </div>
        </details>)}
        {templateError && <p role="alert" className="inline-error">{templateError}</p>}
      </div>
      <label>
        ประเภทงาน
        <Select name="kind" defaultValue="general">
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="general">งานทั่วไป / วิเคราะห์ / ค้นคว้า</SelectItem>
            <SelectItem value="code">แก้โค้ดใน Git worktree แยก</SelectItem>
          </SelectContent>
        </Select>
      </label>
      </div>
      <div className="form min-w-0">
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
        เตรียมแผนก่อน ยังไม่เริ่มงานจนกดยืนยัน งานโค้ดต้องมี Git พร้อม initial commit และสมาชิกต้องได้รับสิทธิ์แก้ไฟล์ก่อนเริ่ม
      </p>
      </div>
      </div>
      <footer>
        <SaveButton busy={busy}>เตรียมแผนงาน</SaveButton>
      </footer>
    </form>
  );
}
function PathInput({ id, name, label, value, onChange, onChoose, disabled, placeholder, hint }: {
  id: string; name?: string; label: string; value: string;
  onChange: (value: string) => void; onChoose: () => void;
  disabled: boolean; placeholder: string; hint: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-[7px]">
      <label id={`${id}-label`} htmlFor={id}>{label}</label>
      <div className="flex min-w-0 items-stretch gap-2">
        <input id={id} name={name} required value={value} onChange={(e) => onChange(e.target.value)}
          disabled={disabled} placeholder={placeholder} spellCheck={false}
          aria-describedby={`${id}-hint`} className="min-w-0 flex-1" />
        <button type="button" disabled={disabled} title="เลือกโฟลเดอร์" aria-label="เลือกโฟลเดอร์"
          aria-describedby={`${id}-label`} onClick={onChoose} className="icon-button shrink-0 self-stretch px-3">
          <FolderOpen size={18} aria-hidden="true" />
        </button>
      </div>
      <small id={`${id}-hint`}>{hint}</small>
    </div>
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
  const [choosing, setChoosing] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [path, setPath] = useState(project?.path || "");
  const [repositories, setRepositories] = useState<Repository[]>(() => project ? projectRepositories(project) : []);
  const setRepository = (index: number, key: "name" | "path" | "description", value: string) =>
    setRepositories((old) => old.map((repo, i) => i === index ? { ...repo, [key]: value } : repo));
  const choose = async (onSelect: (path: string) => void) => {
    if (busy || choosing) return;
    setChoosing(true);
    setPickerError("");
    try {
      const result = await action<{ path: string | null }>("path.choose");
      if (result.path !== null) onSelect(result.path);
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : "เลือกโฟลเดอร์ไม่สำเร็จ กรุณาพิมพ์ path เอง");
    } finally {
      setChoosing(false);
    }
  };
  return (
    <form
      className="form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || choosing) return;
        const data = Object.fromEntries(new FormData(event.currentTarget));
        setBusy(true);
        try {
          await action("project.save", { ...data, repositories, id: project?.id });
          done();
        } catch {
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-start">
      <div className="form min-w-0">
      <label>
        ชื่อโปรเจกต์
        <input
          name="name"
          required
          maxLength={80}
          defaultValue={project?.name}
        />
      </label>
      <PathInput id="project-workspace-path" name="path" label="Workspace หลัก" value={path} onChange={setPath}
        onChoose={() => void choose(setPath)} disabled={busy || choosing}
        placeholder="/Users/your-name/projects/my-project"
        hint="path เต็มของโฟลเดอร์ที่มีอยู่แล้ว ใช้เก็บเอกสารและไฟล์ทั่วไปของโปรเจกต์" />
      {pickerError && <p role="alert" className="inline-error">{pickerError}</p>}
      <label>
        รายละเอียดโปรเจกต์
        <textarea name="description" rows={4} maxLength={16000} defaultValue={project?.description}
          placeholder="เป้าหมาย ข้อจำกัด และความสัมพันธ์ระหว่าง frontend, backend และ API" />
        <small>ส่งให้ agent ทุกงานในโปรเจกต์นี้ ไม่ควรใส่รหัสผ่านหรือ token</small>
      </label>
      </div>
      <fieldset disabled={busy || choosing} className="space-y-4 min-w-0">
        <legend>Repositories ({repositories.length}/16)</legend>
        <p className="note">เพิ่ม repo ที่ agent ใช้ทำงานร่วมกัน เช่น Next.js และ Go/Fiber งานโค้ดจะสร้าง worktree แยกให้แต่ละ repo</p>
        {repositories.map((repo, index) => (
          <fieldset key={repo.id} className="min-w-0 space-y-3 rounded-lg border border-solid border-stone-200 p-4">
            <legend>Repository {index + 1}</legend>
            <label>ชื่อ repository
              <input required maxLength={80} value={repo.name} onChange={(e) => setRepository(index, "name", e.target.value)} placeholder="เช่น Frontend หรือ Backend API" />
            </label>
            <PathInput id={`repository-path-${repo.id}`} label="Path ของ repository" value={repo.path}
              onChange={(value) => setRepository(index, "path", value)}
              onChoose={() => void choose((value) => setRepository(index, "path", value))} disabled={busy || choosing}
              placeholder="apps/web หรือ /Users/your-name/projects/api"
              hint="ใช้ path เต็ม หรือ relative จาก workspace หลัก แต่ละ Git repo ระบุเพียงครั้งเดียว" />
            <label>หน้าที่และข้อมูลประกอบ
              <textarea rows={2} maxLength={16000} value={repo.description || ""} onChange={(e) => setRepository(index, "description", e.target.value)} placeholder="เช่น Go/Fiber API; ดูสัญญา API ใน docs/api" />
            </label>
            <button type="button" onClick={() => setRepositories((old) => old.filter((_, i) => i !== index))}>นำ repository {index + 1} ออกจากโปรเจกต์</button>
          </fieldset>
        ))}
        <button type="button" disabled={repositories.length >= 16} onClick={() => setRepositories((old) => [...old, { id: crypto.randomUUID(), name: "", path: "", description: "" }])}>เพิ่ม repository</button>
        {!repositories.length && <p className="muted small">ยังไม่มี repository ใช้ทำงานทั่วไปได้ เพิ่ม repository ก่อนสร้างงานโค้ด</p>}
      </fieldset>
      </div>
      <footer>
        <SaveButton busy={busy} disabled={choosing} />
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
  const [memoryAgentId, setMemoryAgentId] = useState(memory ? memory.agentId || "" : agentId);
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
        <Select name="projectId" defaultValue={memory?.projectId || projectId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
          {state.projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
          </SelectContent>
        </Select>
      </label>
      <label>
        ใครใช้ความทรงจำนี้
        <input type="hidden" name="agentId" value={memoryAgentId} />
        <Select value={memoryAgentId || sharedMemoryValue} onValueChange={(value) => setMemoryAgentId(value === sharedMemoryValue ? "" : value)}>
          <SelectTrigger><SelectValue placeholder="ความรู้ร่วมของโปรเจกต์" /></SelectTrigger>
          <SelectContent>
          <SelectItem value={sharedMemoryValue}>ความรู้ร่วมของโปรเจกต์</SelectItem>
          {state.agents.map((a) => (
            <SelectItem value={a.id} key={a.id}>
              ส่วนตัวของ {a.name}
            </SelectItem>
          ))}
          </SelectContent>
        </Select>
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
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-start">
      <div className="form min-w-0">
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
          <Select
            name="projectId"
            defaultValue={schedule?.projectId || projectId}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
            {state.projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
            </SelectContent>
          </Select>
        </label>
        <label>
          สมาชิก
          <Select name="agentId" defaultValue={schedule?.agentId || agentId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
            {state.agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <div className="form-row">
        <label>
          ความถี่
          <Select
            name="frequency"
            value={frequency}
            onValueChange={(value) => setFrequency(value as Schedule["frequency"])}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="once">ครั้งเดียว</SelectItem>
              <SelectItem value="daily">ทุกวัน</SelectItem>
              <SelectItem value="weekly">ทุกสัปดาห์</SelectItem>
            </SelectContent>
          </Select>
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
          <Select name="weekday" defaultValue={String(schedule?.weekday ?? 1)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
            {[
              "อาทิตย์",
              "จันทร์",
              "อังคาร",
              "พุธ",
              "พฤหัสบดี",
              "ศุกร์",
              "เสาร์",
            ].map((day, i) => (
              <SelectItem key={i} value={String(i)}>
                {day}
              </SelectItem>
            ))}
            </SelectContent>
          </Select>
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
        <Select name="kind" defaultValue={schedule?.kind || "general"}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="general">งานทั่วไป</SelectItem>
            <SelectItem value="code">แก้โค้ดใน worktree</SelectItem>
          </SelectContent>
        </Select>
      </label>
      </div>
      <div className="form min-w-0">
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
        เปิดใช้งานหลังยืนยันแผนทำซ้ำ
      </label>
      <p className="note">
        ต้องเปิดเครื่องและเซิร์ฟเวอร์ไว้ เมื่อพลาดเวลา
        ระบบจะชดเชยหนึ่งงานโดยไม่ทำรอบเดิมซ้อนกัน
      </p>
      </div>
      </div>
      <footer>
        <SaveButton busy={busy} />
      </footer>
    </form>
  );
}
