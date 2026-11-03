"use client";
import dynamic from "next/dynamic";
import { projectRepositories } from "../shared/projects";
import Image from "next/image";
import { useEffect, useState } from "react";
import {
  Home,
  ClipboardList,
  MessageSquare,
  CalendarDays,
  BookOpen,
  CircleCheck,
  Folder,
  Link2,
  Laptop,
  Plus,
  LayoutGrid,
  UserPlus,
  Users,
  Square,
  Play,
  X,
  Trash2,
  Pencil,
  RefreshCw,
  Check,
  ShieldCheck,
  Clock3,
  HardDriveDownload,
  PanelLeftClose,
  PanelLeftOpen,
  Moon,
} from "lucide-react";
import type {
  Agent,
  Approval,
  Furniture,
  Memory,
  Project,
  Schedule,
  Task,
} from "../shared/types";
import { furnitureTypes } from "../shared/types";
import { canPlace, occupiedCells } from "../shared/room";
import { useOffice } from "./useOffice";
import { TaskBoard, taskStatusLabel } from "./TaskBoard";
import { latestScheduleTask, scheduleAttention } from "../shared/schedule-view";
import { Inspector } from "./Inspector";
import { ChatPanel } from "./ChatPanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const noFurnitureValue = "__no_furniture__";
import { Connections } from "./Connections";
import { Backups } from "./Backups";
import { FormPage } from "./FormPage";
import { Dialog } from "./Dialog";
import {
  AgentForm,
  TaskForm,
  ProjectForm,
  MemoryForm,
  ScheduleForm,
} from "./forms";
import { ApprovalDetail, TaskDetail } from "./Details";

const OfficeScene = dynamic(() => import("./OfficeScene"), {
  ssr: false,
  loading: () => <div className="scene-loading">กำลังเปิดออฟฟิศ…</div>,
});
const navigation = [
  { id: "office", label: "ออฟฟิศ", Icon: Home },
  { id: "tasks", label: "งาน", Icon: ClipboardList },
  { id: "chat", label: "ทีมแชต", Icon: MessageSquare },
  { id: "schedules", label: "ตารางงาน", Icon: CalendarDays },
  { id: "memories", label: "ความทรงจำ", Icon: BookOpen },
  { id: "approvals", label: "การอนุมัติ", Icon: CircleCheck },
  { id: "projects", label: "โปรเจกต์", Icon: Folder },
  { id: "connections", label: "เชื่อมต่อ", Icon: Link2 },
  { id: "backups", label: "สำรองข้อมูล", Icon: HardDriveDownload },
];
type Modal =
  | { type: "agent"; value?: Agent }
  | { type: "task" }
  | { type: "project"; value?: Project }
  | { type: "memory"; value?: Memory }
  | { type: "schedule"; value?: Schedule }
  | { type: "task-detail"; id: string }
  | { type: "approval"; id: string };
const furnitureNames: Record<Furniture["type"], string> = {
  desk: "โต๊ะทำงาน",
  chair: "เก้าอี้",
  plant: "ต้นไม้",
  meeting: "โต๊ะประชุม",
  sofa: "โซฟา",
  bookcase: "ชั้นหนังสือ",
};

export default function OfficeApp() {
  const { state, connected, error, setError, action } = useOffice();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatInspectorOpen, setChatInspectorOpen] = useState(false);
  const [theme, setTheme] = useState("system");
  const [view, setView] = useState("office"),
    [projectId, setProjectId] = useState("default"),
    [selectedAgent, setSelectedAgent] = useState("atlas");
  const [modal, setModal] = useState<Modal | null>(null),
    [chatChannel, setChatChannel] = useState("team");
  const [deleteTask, setDeleteTask] = useState<Task | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [editing, setEditing] = useState(false),
    [draftFurniture, setDraftFurniture] = useState<Furniture[]>([]),
    [draftAgents, setDraftAgents] = useState<Agent[]>([]),
    [selectedFurniture, setSelectedFurniture] = useState(""),
    [newFurniture, setNewFurniture] = useState<Furniture["type"]>("desk"),
    [savingRoom, setSavingRoom] = useState(false);
  useEffect(() => {
    if (
      new URLSearchParams(window.location.search).get("google") === "connected"
    )
      setView("connections");
    const savedTheme = document.documentElement.dataset.theme;
    if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
    const stored = localStorage.getItem("agent-office-project");
    if (stored) setProjectId(stored);
  }, []);
  useEffect(() => {
    if (state && !state.projects.some((p) => p.id === projectId))
      setProjectId(state.projects[0]?.id || "default");
  }, [state, projectId]);
  useEffect(() => {
    if (!state) return;
    if (!state.agents.some((a) => a.id === selectedAgent)) setSelectedAgent(state.agents[0].id);
    if (chatChannel !== "team" && !state.agents.some((a) => a.id === chatChannel)) setChatChannel("team");
    if (modal?.type === "task-detail" && !state.tasks.some((t) => t.id === modal.id)) setModal(null);
    if (modal?.type === "approval" && !state.approvals.some((a) => a.id === modal.id)) setModal(null);
    const editedId = modal && "value" in modal ? modal.value?.id : undefined;
    if (editedId && modal?.type === "agent" && !state.agents.some((a) => a.id === editedId)) setModal(null);
    if (editedId && modal?.type === "project" && !state.projects.some((p) => p.id === editedId)) setModal(null);
    if (editedId && modal?.type === "memory" && !state.memories.some((m) => m.id === editedId)) setModal(null);
    if (editedId && modal?.type === "schedule" && !state.schedules.some((s) => s.id === editedId)) setModal(null);
  }, [state, selectedAgent, chatChannel, modal]);
  if (!state)
    return (
      <main className="app-loading">
        <div className="brand-mark">
          <Image src="/assets/logo.png" alt="" width={54} height={54} priority />
        </div>
        <h1>Agent Atelier</h1>
        <p>กำลังเปิดพื้นที่ทำงานของคุณ…</p>
        {!connected && (
          <small>หากใช้เวลานาน โปรดตรวจว่าเซิร์ฟเวอร์ยังทำงานอยู่</small>
        )}
      </main>
    );
  const agent =
    state.agents.find((a) => a.id === selectedAgent) || state.agents[0];
  const project =
    state.projects.find((p) => p.id === projectId) || state.projects[0];
  const tasks = state.tasks.filter((t) => t.projectId === projectId);
  const latestRounds = new Map(tasks.flatMap((t) => t.sessionRound && t.relatedTaskId ? [[t.relatedTaskId, t] as const] : []));
  const boardTasks = tasks.filter((t) => !t.sessionRound).map((t) => {
    const latest = latestRounds.get(t.id);
    return latest ? { ...latest, title: t.title } : t;
  });
  const approvals = state.approvals.filter((a) => a.status === "pending");
  const attention = scheduleAttention(projectId, state.tasks, state.approvals);
  const failedSchedules = state.schedules.filter((schedule) => schedule.projectId === projectId && schedule.lastError);
  const attentionCount = attention.tasks.length + attention.approvals.length + failedSchedules.length;
  const activeTasks = state.tasks.filter(
    (t) => t.status === "running" || t.status === "waiting",
  );
  const openTask = (task: Task) =>
    setModal({ type: "task-detail", id: task.sessionRound ? task.relatedTaskId || task.id : task.id });
  const requestDeleteTask = (task: Task) => { setDeleteError(""); setDeleteTask(task); };
  const close = () => setModal(null);
  const selectAgent = (id: string) => {
    setSelectedAgent(id);
    if (!editing && window.innerWidth <= 1000)
      requestAnimationFrame(() =>
        document
          .querySelector(".inspector")
          ?.scrollIntoView({
            block: "start",
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "instant"
              : "smooth",
          }),
      );
  };
  const changeView = (next: string) => {
    if (editing) {
      setError("บันทึกหรือยกเลิกการจัดห้องก่อนเปลี่ยนหน้า");
      return;
    }
    setView(next);
  };
  const fire = (name: string, data?: unknown) => {
    void action(name, data).catch(() => {});
  };
  const addFurniture = () => {
    for (let y = 3; y <= 15; y++)
      for (let x = 2; x <= 27; x++) {
        const item: Furniture = {
          id: crypto.randomUUID(),
          type: newFurniture,
          x,
          y,
        };
        if (
          canPlace(item, draftFurniture) &&
          !occupiedCells(item).some((p) =>
            draftAgents.some((a) => a.seat.x === p.x && a.seat.y === p.y),
          )
        ) {
          setDraftFurniture((items) => [...items, item]);
          setSelectedFurniture(item.id);
          return;
        }
      }
    setError("ไม่มีพื้นที่ว่างสำหรับเฟอร์นิเจอร์ชิ้นนี้");
  };
  const title =
    view === "office"
      ? "ออฟฟิศของคุณ"
      : navigation.find((n) => n.id === view)?.label || "";
  const activeModalTask =
    modal?.type === "task-detail"
      ? state.tasks.find((t) => t.id === modal.id)
      : undefined;
  const activeApproval =
    modal?.type === "approval"
      ? state.approvals.find((a) => a.id === modal.id)
      : undefined;
  const finishPage = () => window.dispatchEvent(new Event("office-form-saved"));
  const isFormPage = !!activeModalTask || modal?.type === "agent" || modal?.type === "task" ||
    modal?.type === "project" || modal?.type === "schedule" || activeApproval?.type === "input";
  return (
    <>
    <div hidden={isFormPage} style={isFormPage ? { display: "none" } : undefined} className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}${view === "chat" ? ` chat-view${chatInspectorOpen ? " inspector-open" : ""}` : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
        <button className="brand" aria-label="Agent Atelier" onClick={() => changeView("office")}>
          <span className="brand-mark">
            <Image src="/assets/logo.png" alt="" width={32} height={32} />
          </span>
          <strong>Agent Atelier</strong>
        </button>
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          aria-label={sidebarCollapsed ? "ขยายเมนู" : "ย่อเมนู"}
          aria-expanded={!sidebarCollapsed}
          aria-controls="sidebar-navigation"
          title={sidebarCollapsed ? "ขยายเมนู" : "ย่อเมนู"}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
        </button>
        </div>
          <label className="project-select">
            <span>โปรเจกต์</span>
            <Select
              value={projectId}
              onValueChange={(value) => {
                setProjectId(value);
                localStorage.setItem("agent-office-project", value);
              }}
            >
              <SelectTrigger aria-label={`เลือกโปรเจกต์: ${project.name}`} title={project.name}><Folder className="project-icon" size={18} aria-hidden="true" /><SelectValue /></SelectTrigger>
              <SelectContent>
              {state.projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
              </SelectContent>
            </Select>
          </label>
        <nav id="sidebar-navigation" aria-label="เมนูหลัก">
          {navigation.map(({ id, label, Icon }, index) => (
            <button
              key={id}
              className={`${view === id ? "active" : ""} ${index === 6 ? "nav-divider" : ""}`}
              aria-label={id === "approvals" && approvals.length > 0 ? `${label} ${approvals.length} รายการ` : id === "schedules" && attentionCount ? `${label} ${attentionCount} รายการต้องดำเนินการ` : label}
              title={label}
              onClick={() => changeView(id)}
            >
              <Icon size={22} strokeWidth={1.8} />
              <span>{label}</span>
              {id === "schedules" && attentionCount > 0 && <b className="nav-count">{attentionCount}</b>}
              {id === "approvals" && approvals.length > 0 && (
                <b className="nav-count">{approvals.length}</b>
              )}
            </button>
          ))}
        </nav>
        <label className="theme-select">
          <span>ธีม</span>
          <Select value={theme} onValueChange={(value) => {
            setTheme(value);
            document.documentElement.dataset.theme = value;
            try { localStorage.setItem("agent-atelier-theme", value); } catch {}
          }}>
            <SelectTrigger aria-label="เลือกธีม" title="เลือกธีม"><Moon className="theme-icon" size={18} aria-hidden="true" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="system">ตามระบบ</SelectItem>
              <SelectItem value="light">สว่าง</SelectItem>
              <SelectItem value="dark">มืด</SelectItem>
            </SelectContent>
          </Select>
        </label>
          <small className="codex-status" title={state.codex.state === "ready" ? "Codex พร้อมใช้งาน" : "Codex ยังไม่พร้อม"}>
            <i className={`dot ${state.codex.state === "ready" ? "ready" : "waiting"}`} />
            {state.codex.state === "ready" ? "Codex พร้อมใช้งาน" : "Codex ยังไม่พร้อม"}
          </small>
        <div className="sidebar-bottom">
          <span>
            <Laptop size={20} />
            ทำงานในเครื่อง
          </span>
          <small>
            <i className={`dot ${connected ? "ready" : "waiting"}`} />
            {connected ? "เชื่อมต่อพื้นที่ทำงานแล้ว" : "กำลังเชื่อมต่อเว็บใหม่"}
          </small>
          <button
            className={state.paused ? "resume-team" : "stop-team"}
            aria-label={state.paused ? "เปิดทีมทำงานต่อ" : "หยุดทั้งทีม"}
            title={state.paused ? "เปิดทีมทำงานต่อ" : "หยุดทั้งทีม"}
            onClick={() => fire(state.paused ? "team.resume" : "team.stop")}
          >
            {state.paused ? <Play size={15} /> : <Square size={14} />}
            <span>{state.paused ? "เปิดทีมทำงานต่อ" : "หยุดทั้งทีม"}</span>
          </button>
        </div>
      </aside>
      <main className="main-content">
        {state.codex.state !== "ready" && (
          <div className="connection-banner">
            <span>
              {state.codex.state === "connecting"
                ? "กำลังเชื่อมต่อ Codex…"
                : `Codex ยังไม่พร้อม: ${state.codex.error}`}
            </span>
            <button onClick={() => fire("codex.reconnect")}>
              <RefreshCw size={14} />
              ลองใหม่
            </button>
          </div>
        )}
        {state.paused && (
          <div className="connection-banner">
            ทีมหยุดอยู่ งานใหม่จะรอในคิวจนกว่าคุณจะเปิดทีมทำงานต่อ
            <button onClick={() => fire("team.resume")}>
              <Play size={14} />
              ทำงานต่อ
            </button>
          </div>
        )}
        <div className="workspace-toolbar">
          <h1>{title}</h1>
          {view === "chat" && <button aria-expanded={chatInspectorOpen} aria-controls="chat-inspector" onClick={() => setChatInspectorOpen((open) => !open)}><Users size={18} />{chatInspectorOpen ? "ซ่อนข้อมูลสมาชิก" : "ข้อมูลสมาชิก"}</button>}
          {view === "tasks" && (
            <button onClick={() => setModal({ type: "task" })}><Plus size={18} />สร้างงาน</button>
          )}
          {view === "office" && (
            <div className="toolbar-actions">
              <button
                disabled={!editing && activeTasks.length > 0}
                title={
                  activeTasks.length
                    ? "รอให้งานจบหรือหยุดทีมก่อนจัดห้อง"
                    : undefined
                }
                onClick={() => {
                  if (editing) {
                    setEditing(false);
                    return;
                  }
                  setDraftFurniture(structuredClone(state.layout.furniture));
                  setDraftAgents(structuredClone(state.agents));
                  setEditing(true);
                  setSelectedFurniture("");
                }}
              >
                <LayoutGrid size={17} />
                {editing ? "ยกเลิกจัดห้อง" : "จัดห้อง"}
              </button>
              <button
                disabled={editing}
                onClick={() => setModal({ type: "agent" })}
              >
                <UserPlus size={18} />
                เพิ่มสมาชิก
              </button>
            </div>
          )}
        </div>
        {view === "office" && (
          <>
            <div className="office-area">
              {editing && (
                <div className="room-editor">
                  <Select
                    value={newFurniture}
                    onValueChange={(value) =>
                      setNewFurniture(value as Furniture["type"])
                    }
                  >
                    <SelectTrigger aria-label="ประเภทเฟอร์นิเจอร์"><SelectValue /></SelectTrigger>
                    <SelectContent>
                    {furnitureTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {furnitureNames[type]}
                      </SelectItem>
                    ))}
                    </SelectContent>
                  </Select>
                  <button onClick={addFurniture}>
                    <Plus size={15} />
                    เพิ่ม
                  </button>
                  <button
                    aria-label="ลบเฟอร์นิเจอร์ที่เลือก"
                    disabled={!selectedFurniture}
                    onClick={() => {
                      setDraftFurniture((items) =>
                        items.filter((f) => f.id !== selectedFurniture),
                      );
                      setSelectedFurniture("");
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                  <button
                    className="primary"
                    disabled={savingRoom}
                    onClick={async () => {
                      setSavingRoom(true);
                      try {
                        await action("room.save", {
                          furniture: draftFurniture,
                          seats: draftAgents.map((a) => ({
                            id: a.id,
                            ...a.seat,
                          })),
                        });
                        setEditing(false);
                      } catch {
                      } finally {
                        setSavingRoom(false);
                      }
                    }}
                  >
                    <Check size={16} />
                    {savingRoom ? "กำลังบันทึก…" : "บันทึกห้อง"}
                  </button>
                </div>
              )}
              {editing && (
                <div className="room-properties">
                  <label>
                    เฟอร์นิเจอร์
                    <Select
                      value={selectedFurniture || noFurnitureValue}
                      onValueChange={(value) => setSelectedFurniture(value === noFurnitureValue ? "" : value)}
                    >
                      <SelectTrigger aria-label="เลือกเฟอร์นิเจอร์ในห้อง"><SelectValue placeholder="เลือกชิ้นที่ต้องการย้าย" /></SelectTrigger>
                      <SelectContent>
                      <SelectItem value={noFurnitureValue}>เลือกชิ้นที่ต้องการย้าย</SelectItem>
                      {draftFurniture.map((item, index) => (
                        <SelectItem value={item.id} key={item.id}>
                          {index + 1}. {furnitureNames[item.type]}
                        </SelectItem>
                      ))}
                      </SelectContent>
                    </Select>
                  </label>
                  {draftFurniture
                    .filter((f) => f.id === selectedFurniture)
                    .map((item) => (
                      <div className="room-coordinates" key={item.id}>
                        {(["x", "y"] as const).map((axis) => (
                          <label key={axis}>
                            {axis.toUpperCase()}
                            <input
                              aria-label={`ตำแหน่งเฟอร์นิเจอร์ ${axis.toUpperCase()}`}
                              type="number"
                              min={1}
                              max={axis === "x" ? 28 : 16}
                              value={item[axis]}
                              onChange={(e) =>
                                setDraftFurniture((items) =>
                                  items.map((f) =>
                                    f.id === item.id
                                      ? { ...f, [axis]: Number(e.target.value) }
                                      : f,
                                  ),
                                )
                              }
                            />
                          </label>
                        ))}
                      </div>
                    ))}
                </div>
              )}
              <OfficeScene
                state={state}
                furniture={editing ? draftFurniture : state.layout.furniture}
                agents={editing ? draftAgents : state.agents}
                editing={editing}
                selectedAgent={agent.id}
                selectedFurniture={selectedFurniture}
                onSelectAgent={selectAgent}
                onSelectFurniture={setSelectedFurniture}
                onFurniture={setDraftFurniture}
                onSeat={(id, seat) =>
                  setDraftAgents((agents) =>
                    agents.map((a) => (a.id === id ? { ...a, seat } : a)),
                  )
                }
                onError={setError}
              />
            </div>
            <TaskBoard tasks={boardTasks} agents={state.agents} open={openTask} remove={requestDeleteTask} />
          </>
        )}
        {view === "tasks" && (
          <TaskBoard tasks={boardTasks} agents={state.agents} open={openTask} remove={requestDeleteTask} />
        )}
        {view === "chat" && (
          <ChatPanel
            state={state}
            projectId={projectId}
            initialChannel={chatChannel}
            action={action}
          />
        )}
        {view === "schedules" && (
          <section className="panel">
            <div className="section-heading">
              <h2>ตารางงานประจำ</h2>
              <button onClick={() => setModal({ type: "schedule" })}>
                <Plus size={17} />
                เพิ่มตารางงาน
              </button>
            </div>
            <p className="muted">
              ยืนยันแผนทำซ้ำก่อนเปิดตาราง · พลาดเวลาแล้วชดเชยหนึ่งครั้ง
            </p>
            {attentionCount > 0 && <div className="entity-list" aria-label="รายการที่ต้องดำเนินการ">
              <h3>รายการที่ต้องดำเนินการ ({attentionCount})</h3>
              {failedSchedules.map((schedule) => <button className="approval-row" key={schedule.id} onClick={() => setModal({ type: "schedule", value: schedule })}><span>{schedule.name}</span><span>พักเพราะเกิดข้อผิดพลาด</span></button>)}
              {attention.tasks.map((task) => <button className="approval-row" key={task.id} onClick={() => openTask(task)}><span>{task.title}</span><span>{taskStatusLabel(task)}</span></button>)}
              {attention.approvals.map((approval) => <button className="approval-row" key={approval.id} onClick={() => setModal({ type: "approval", id: approval.id })}><span>{approval.title}</span><span>รออนุมัติ</span></button>)}
            </div>}
            {state.schedules.filter((s) => s.projectId === projectId).length ? (
              <div className="entity-list">
                {state.schedules
                  .filter((s) => s.projectId === projectId)
                  .map((schedule) => {
                    const latest = latestScheduleTask(schedule, tasks);
                    return <article className="entity-row" key={schedule.id}>
                      <div className="entity-icon">
                        <CalendarDays size={23} />
                      </div>
                      <div className="entity-main">
                        <h3>{schedule.name}</h3>
                        <p>
                          {
                            state.agents.find((a) => a.id === schedule.agentId)
                              ?.name
                          }{" "}
                          ·{" "}
                          {schedule.frequency === "once"
                            ? "ครั้งเดียว"
                            : schedule.frequency === "daily"
                              ? "ทุกวัน"
                              : "ทุกสัปดาห์"}{" "}
                          {schedule.time} · {schedule.timezone}
                        </p>
                        <small>{schedule.enabled ? "เปิดใช้งาน" : "พักตารางงานแล้ว"} · {schedule.nextRun && schedule.enabled ? `รอบถัดไป: ${new Date(schedule.nextRun).toLocaleString("th-TH", { timeZone: schedule.timezone })} (${schedule.timezone})` : "ไม่มีรอบถัดไป"}</small>
                        <p>{schedule.lastRun ? `รอบล่าสุด: ${new Date(schedule.lastRun).toLocaleString("th-TH", { timeZone: schedule.timezone })} (${schedule.timezone})` : "ยังไม่เคยรัน"}{latest ? ` · ${taskStatusLabel(latest)}` : schedule.lastRun ? " · ไม่พบ Task ของรอบนี้" : ""}</p>
                        {schedule.lastError && <p>เหตุที่พัก: {schedule.lastError}</p>}
                        {latest?.error && <p>{latest.error}</p>}
                        {latest && <button onClick={() => openTask(latest)}>เปิด Task รอบล่าสุด</button>}
                      </div>
                      {schedule.planTaskId && state.tasks.find((task) => task.id === schedule.planTaskId)?.status === "draft" && <button onClick={() => setModal({ type: "task-detail", id: schedule.planTaskId! })}>ตรวจแผนทำซ้ำ</button>}
                      {!schedule.approvedPlan && state.tasks.find((task) => task.id === schedule.planTaskId)?.status !== "draft" && <button onClick={() => fire("schedule.save", { ...schedule, enabled: true })}>เตรียมแผนทำซ้ำ</button>}
                      <button
                        aria-label={`แก้ไข ${schedule.name}`}
                        onClick={() =>
                          setModal({ type: "schedule", value: schedule })
                        }
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        aria-label={`ลบ ${schedule.name}`}
                        onClick={() =>
                          fire("schedule.delete", { id: schedule.id })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </article>;
                  })}
              </div>
            ) : (
              <Empty
                Icon={CalendarDays}
                title="ให้ทีมดูแลงานประจำ"
                text="ตั้งเวลาให้สมาชิกสรุปข้อมูล ค้นคว้า หรือติดตามโปรเจกต์แทนคุณ"
              />
            )}
            <p className="note">
              schedule ทำงานเมื่อเปิดเครื่องและเซิร์ฟเวอร์ไว้ แม้ปิดแท็บเว็บแล้ว
              เขตเวลาเริ่มต้นคือ Asia/Vientiane
            </p>
          </section>
        )}
        {view === "memories" && (
          <section className="panel">
            <div className="section-heading">
              <h2>ความรู้และความทรงจำ</h2>
              <button onClick={() => setModal({ type: "memory" })}>
                <Plus size={17} />
                เพิ่มข้อมูล
              </button>
            </div>
            <p className="muted">
              ข้อมูลของโปรเจกต์นี้เท่านั้น
              ความทรงจำส่วนตัวจะส่งให้เจ้าของความทรงจำอ่าน
            </p>
            {state.memories.filter((m) => m.projectId === projectId).length ? (
              <div className="memory-list">
                {state.memories
                  .filter((m) => m.projectId === projectId)
                  .map((memory) => (
                    <article key={memory.id} className="memory-item">
                      <header>
                        <span>
                          <BookOpen size={16} />
                          {memory.agentId
                            ? `ส่วนตัว · ${state.agents.find((a) => a.id === memory.agentId)?.name}`
                            : "ความรู้ร่วมของโปรเจกต์"}
                        </span>
                        <div>
                          <button
                            aria-label="แก้ไขความทรงจำ"
                            onClick={() =>
                              setModal({ type: "memory", value: memory })
                            }
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            aria-label="ลบความทรงจำ"
                            onClick={() =>
                              fire("memory.delete", { id: memory.id })
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </header>
                      <p>{memory.text}</p>
                      <small>
                        {new Date(memory.updatedAt).toLocaleString("th-TH")}
                      </small>
                    </article>
                  ))}
              </div>
            ) : (
              <Empty
                Icon={BookOpen}
                title="พื้นที่สำหรับสิ่งที่ทีมควรจำ"
                text="เพิ่มกติกา ข้อมูลอ้างอิง หรือให้สมาชิกบันทึกสิ่งที่เรียนรู้จากงาน"
              />
            )}
          </section>
        )}
        {view === "approvals" && (
          <section className="panel">
            <div className="section-heading">
              <h2>ศูนย์อนุมัติ</h2>
              <span className="muted">รวมทุกโปรเจกต์</span>
            </div>
            <p className="muted">
              ตรวจรายละเอียดก่อนให้ทีมลงมือ การกดซ้ำจะไม่ดำเนินการซ้ำ
            </p>
            {approvals.length ? (
              <div className="entity-list">
                {approvals.map((approval) => (
                  <button
                    className="approval-row"
                    key={approval.id}
                    onClick={() =>
                      setModal({ type: "approval", id: approval.id })
                    }
                  >
                    <div className="entity-icon">
                      <ShieldCheck size={24} />
                    </div>
                    <div>
                      <strong>{approval.title}</strong>
                      <p>
                        {state.agents.find((a) => a.id === approval.agentId)
                          ?.name || "คุณ"}{" "}
                        ·{" "}
                        {
                          state.projects.find(
                            (p) => p.id === approval.projectId,
                          )?.name
                        }
                      </p>
                    </div>
                    <span>ตรวจคำขอ →</span>
                  </button>
                ))}
              </div>
            ) : (
              <Empty
                Icon={CircleCheck}
                title="ไม่มีคำขอที่รอคุณอยู่"
                text="Approve for me ตรวจคำขอใช้สิทธิ์ให้แล้ว คำขอส่งต่องานและเขียนข้อมูลภายนอกยังรอคุณอนุมัติที่นี่"
              />
            )}
            {state.approvals.some((a) => a.status !== "pending") && (
              <>
                <h3 className="history-heading">ประวัติคำขอ</h3>
                <div className="entity-list">
                  {state.approvals
                    .filter((a) => a.status !== "pending")
                    .slice()
                    .reverse()
                    .map((approval) => (
                      <button
                        className="history-row"
                        key={approval.id}
                        onClick={() =>
                          setModal({ type: "approval", id: approval.id })
                        }
                      >
                        <span>{approval.title}</span>
                        <span>
                          {approval.status === "approved"
                            ? "อนุมัติแล้ว"
                            : approval.status === "declined"
                              ? "ไม่อนุมัติ"
                              : approval.status === "unknown"
                                ? "ตรวจผลปลายทาง"
                                : approval.status === "expired"
                                  ? "หมดอายุ"
                                  : approval.status}
                        </span>
                      </button>
                    ))}
                </div>
              </>
            )}
          </section>
        )}
        {view === "projects" && (
          <section className="panel">
            <div className="section-heading">
              <h2>โปรเจกต์ของคุณ</h2>
              <button onClick={() => setModal({ type: "project" })}>
                <Plus size={17} />
                เพิ่มโปรเจกต์
              </button>
            </div>
            <div className="entity-list">
              {state.projects.map((item) => (
                <article className="entity-row" key={item.id}>
                  <div className="entity-icon">
                    <Folder size={24} />
                  </div>
                  <div className="entity-main">
                    <h3>{item.name}</h3>
                    {item.description && <p className="whitespace-pre-wrap break-words">{item.description}</p>}
                    <p className="file-path">{item.path}</p>
                    {projectRepositories(item).map((repo) => (
                      <div key={repo.id} className="mt-3 min-w-0">
                        <strong>{repo.name}</strong>
                        <p className="file-path">{repo.path}</p>
                        {repo.description && <p className="whitespace-pre-wrap break-words">{repo.description}</p>}
                        <button onClick={() => fire("git.initialize", { id: item.id, repositoryId: repo.id })}>
                          เริ่ม Git… {repo.name}
                        </button>
                      </div>
                    ))}
                    {!projectRepositories(item).length && <small>งานทั่วไป · ยังไม่มี repository</small>}
                  </div>
                  <button
                    aria-label={`แก้ไข ${item.name}`}
                    onClick={() => setModal({ type: "project", value: item })}
                  >
                    <Pencil size={16} />
                  </button>
                </article>
              ))}
            </div>
            <p className="note">
              งานโค้ดใช้ branch และ worktree แยกทุก repo แต่ละ repo ต้องมี initial commit
              และไม่มีไฟล์ค้างที่ยังไม่ commit ก่อนเริ่มงาน ตรวจ diff และอนุมัติรวมแยกกันได้
            </p>
          </section>
        )}
        {view === "connections" && (
          <Connections state={state} action={action} />
        )}
        {view === "backups" && <Backups state={state} restored={() => {
          setModal(null); setEditing(false); setChatChannel("team");
          setSelectedAgent(""); setProjectId(""); setError("");
          localStorage.removeItem("agent-office-project");
        }} />}
      </main>
      <div id="chat-inspector" className="inspector-container" hidden={view === "chat" && !chatInspectorOpen}>
      {view === "chat" && <button className="chat-inspector-close" onClick={() => setChatInspectorOpen(false)} aria-label="ปิดข้อมูลสมาชิก"><X size={18} /></button>}
      <Inspector
        key={agent.id}
        agent={agent}
        state={state}
        projectId={projectId}
        configure={() => setModal({ type: "agent", value: agent })}
        send={async (body) => {
          await action("message.send", {
            projectId,
            channel: agent.id,
            to: agent.id,
            body,
          });
        }}
        openTask={openTask}
        openChat={() => {
          setChatChannel(agent.id);
          changeView("chat");
        }}
      />
      </div>
      {error && (
        <div role="alert" className="toast">
          <span>{error}</span>
          <button aria-label="ปิดข้อความแจ้งเตือน" onClick={() => setError("")}>
            <X size={17} />
          </button>
        </div>
      )}
      {modal?.type === "memory" && (
        <Dialog
          title={modal.value ? "แก้ไขความทรงจำ" : "เพิ่มความทรงจำ"}
          close={close}
        >
          <MemoryForm
            memory={modal.value}
            state={state}
            projectId={projectId}
            agentId={agent.id}
            action={action}
            done={close}
          />
        </Dialog>
      )}
      {activeApproval && activeApproval.type !== "input" && (
        <Dialog title="ตรวจคำขออนุมัติ" close={close} wide>
          <ApprovalDetail
            approval={activeApproval}
            state={state}
            action={action}
            done={close}
          />
        </Dialog>
      )}
    </div>
      {activeModalTask && (
        <FormPage title={activeModalTask.title} close={close}>
          <TaskDetail task={activeModalTask} state={state} action={action} remove={requestDeleteTask} />
        </FormPage>
      )}
      {deleteTask && <Dialog title="ยืนยันการลบงาน" close={() => { if (!deletingTask) setDeleteTask(null); }}>
        <p>ลบงาน “{deleteTask.title}” ออกจากประวัติหรือไม่? ไฟล์ผลงานและ Git worktree จะยังอยู่</p>
        {deleteError && <p role="alert" className="inline-error">{deleteError}</p>}
        <div className="detail-toolbar">
          <button disabled={deletingTask} onClick={() => setDeleteTask(null)}>ยกเลิก</button>
          <button className="danger-outline" disabled={deletingTask} onClick={async () => {
            setDeletingTask(true); setDeleteError("");
            try { await action("task.delete", { id: deleteTask.id }); setDeleteTask(null); }
            catch (error) { setDeleteError(error instanceof Error ? error.message : "ลบงานไม่ได้"); }
            finally { setDeletingTask(false); }
          }}>ยืนยันลบงาน</button>
        </div>
      </Dialog>}
      {modal?.type === "agent" && (
        <FormPage
          title={modal.value ? `ตั้งค่า ${modal.value.name}` : "เพิ่มสมาชิกทีม"}
          close={close}
        >
          <AgentForm
            agent={modal.value}
            state={state}
            action={action}
            done={finishPage}
          />
        </FormPage>
      )}
      {modal?.type === "task" && (
        <FormPage title="มอบหมายงานใหม่" close={close}>
          <TaskForm
            state={state}
            projectId={projectId}
            agentId={agent.id}
            action={action}
            done={finishPage}
            openTask={(id) => setModal({ type: "task-detail", id })}
          />
        </FormPage>
      )}
      {modal?.type === "project" && (
        <FormPage
          title={modal.value ? "แก้ไขโปรเจกต์" : "เพิ่มโปรเจกต์"}
          close={close}
        >
          <ProjectForm project={modal.value} action={action} done={finishPage} />
        </FormPage>
      )}
      {modal?.type === "schedule" && (
        <FormPage
          title={modal.value ? "แก้ไขตารางงาน" : "ตั้งตารางงาน"}
          close={close}
        >
          <ScheduleForm
            schedule={modal.value}
            state={state}
            projectId={projectId}
            agentId={agent.id}
            action={action}
            done={finishPage}
          />
        </FormPage>
      )}
      {activeApproval?.type === "input" && (
        <FormPage title="ตรวจคำขออนุมัติ" close={close}>
          <ApprovalDetail
            approval={activeApproval}
            state={state}
            action={action}
            done={finishPage}
          />
        </FormPage>
      )}
    {isFormPage && error && <div role="alert" className="toast">{error}</div>}
    </>
  );
}
function Empty({
  Icon,
  title,
  text,
}: {
  Icon: typeof Home;
  title: string;
  text: string;
}) {
  return (
    <div className="large-empty">
      <Icon size={37} strokeWidth={1.5} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
