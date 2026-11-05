"use client";

import { useState } from "react";
import type { Message, Project, Snapshot, Task } from "../shared/types";
import { messageImageUrl } from "../shared/images";
import { groupTasks } from "../shared/task-groups";
import { Dialog } from "./Dialog";
import { TaskFiles } from "./TaskFiles";
import { taskStatusLabel } from "./TaskBoard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type Kind = "tasks" | "chats";
type Preview = { count: number; remaining: number; blocked: boolean; token: string };
type Action = <T = unknown>(name: string, data?: unknown) => Promise<T>;
const dateLabel = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Vientiane" });

export function HistorySettings({ project, state, action, openTask }: {
  project: Project;
  state: Snapshot;
  action: Action;
  openTask: (task: Task) => void;
}) {
  const [theme, setTheme] = useState(() => typeof document === "undefined" ? "system" : document.documentElement.dataset.theme || "system");
  const [palette, setPalette] = useState(() => typeof document === "undefined" ? "neutral" : document.documentElement.dataset.palette || "neutral");
  const [preview, setPreview] = useState<(Preview & { kind: Kind }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const tasks = state.tasks.filter((task) => task.projectId === project.id);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const archivedTasks = [...groupTasks(tasks).keys()].flatMap((id) => {
    const task = byId.get(id);
    return task?.archivedAt ? [task] : [];
  });
  const chats = new Map<string, Message[]>();
  for (const message of state.messages) {
    if (message.projectId !== project.id || !message.archivedAt) continue;
    const key = JSON.stringify([message.archivedAt, message.channel]);
    const messages = chats.get(key) || [];
    messages.push(message);
    chats.set(key, messages);
  }

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ดำเนินการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return <div className="grid gap-4 lg:grid-cols-2">
    <section className="panel flex flex-col items-start gap-3 lg:col-span-2" aria-label="หน้าตาแอป">
      <h2>หน้าตาแอป</h2>
      <p>ตั้งค่าสำหรับเบราว์เซอร์นี้</p>
      <div className="flex w-full flex-wrap gap-4">
        <label className="flex w-full max-w-60 flex-col gap-1">
          <span>ชุดสี</span>
          <Select value={palette} onValueChange={(value) => {
            setPalette(value);
            document.documentElement.dataset.palette = value;
            try { localStorage.setItem("agent-atelier-palette", value); } catch {}
          }}>
            <SelectTrigger aria-label="ชุดสี"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="neutral">โทนกลาง</SelectItem><SelectItem value="green">เขียวเดิม</SelectItem></SelectContent>
          </Select>
        </label>
        <label className="flex w-full max-w-60 flex-col gap-1">
          <span>โหมด</span>
          <Select value={theme} onValueChange={(value) => {
            setTheme(value);
            document.documentElement.dataset.theme = value;
            try { localStorage.setItem("agent-atelier-theme", value); } catch {}
          }}>
            <SelectTrigger aria-label="โหมด"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="system">ตามระบบ</SelectItem><SelectItem value="light">สว่าง</SelectItem><SelectItem value="dark">มืด</SelectItem></SelectContent>
          </Select>
        </label>
      </div>
    </section>
    <section className="panel flex flex-col items-start gap-3 lg:col-span-2" aria-label="จัดการประวัติ">
      <h2>จัดการประวัติ · {project.name}</h2>
      <p>เก็บงานที่จบแล้วหรือแชตของโปรเจกต์นี้เข้าคลัง</p>
      <div className="flex flex-wrap gap-2">
        {(["tasks", "chats"] as const).map((kind) => <button key={kind} type="button" disabled={busy} onClick={() => void run(async () => {
          const result = await action<Preview>("history.archive", { projectId: project.id, kind });
          setPreview({ ...result, kind });
        })}>เก็บ {kind === "tasks" ? "Tasks" : "Chats"} เข้าคลัง</button>)}
      </div>
      {error && !preview && <p role="alert" className="inline-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
    <section className="panel flex flex-col gap-3" aria-label="คลัง Tasks">
      <h2>คลัง Tasks</h2>
      {!archivedTasks.length && <p className="muted">ยังไม่มีงานในคลัง</p>}
      {archivedTasks.map((task) => <article key={task.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-[var(--line)] pt-3">
        <div className="min-w-0 break-words">
          <button type="button" className="whitespace-normal text-left" onClick={() => openTask(task)}>{task.title}</button>
          <p className="muted small">{taskStatusLabel(task)} · {dateLabel.format(new Date(task.archivedAt!))}</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void run(async () => {
          await action("history.restoreTask", { projectId: project.id, taskId: task.id });
          setNotice("นำชุดงานกลับไปที่ Kanban แล้ว");
        })}>นำชุดงานกลับ</button>
      </article>)}
    </section>
    <section className="panel flex flex-col gap-3" aria-label="คลัง Chats">
      <h2>คลัง Chats</h2>
      {!chats.size && <p className="muted">ยังไม่มีแชตในคลัง</p>}
      {[...chats].reverse().map(([key, messages]) => {
        const first = messages[0];
        const channel = first.channel === "team" ? "ทีมแชต" : state.agents.find((agent) => agent.id === first.channel)?.name || first.channel;
        return <details key={key} className="border-t border-[var(--line)] pt-3">
          <summary className="cursor-pointer break-words">{channel} · {dateLabel.format(new Date(first.archivedAt!))} · {messages.length} ข้อความ</summary>
          <div className="mt-3 flex flex-col gap-3">
            {messages.map((message) => {
              const task = message.taskId ? byId.get(message.taskId) : undefined;
              const author = message.from === "user" ? "คุณ" : state.agents.find((agent) => agent.id === message.from)?.name || "ระบบ";
              return <article key={message.id} className="min-w-0 break-words border-t border-[var(--line)] pt-2">
                <p><strong>{author}</strong> · <time dateTime={message.createdAt}>{dateLabel.format(new Date(message.createdAt))}</time></p>
                <p className="whitespace-pre-wrap">{message.body}</p>
                {message.images?.map((image) => <a key={image.id} href={messageImageUrl(message.id, image.id)} target="_blank" rel="noreferrer" className="block underline">{image.name}</a>)}
                {task && <button type="button" className="whitespace-normal" onClick={() => openTask(task)}>เปิดงาน {task.title}</button>}
                {task && <TaskFiles taskId={task.id} output={message.body} revision={message.deliveryRevision} />}
              </article>;
            })}
          </div>
        </details>;
      })}
    </section>
    {preview && <Dialog title={preview.kind === "tasks" ? "เก็บ Tasks เข้าคลัง" : "เก็บ Chats เข้าคลัง"} close={() => { if (!busy) setPreview(null); }}>
      <div className="flex flex-col items-start gap-3">
        <p>{project.name} · {preview.count} {preview.kind === "tasks" ? "ชุดงาน" : "ข้อความ"}ที่จะเก็บ</p>
        {preview.remaining > 0 && <p>{preview.remaining} ชุดงานยังอยู่บน Kanban เพราะมีขั้นตอนค้างหรือมีโค้ดที่ยังต้องจัดการ</p>}
        {preview.blocked && <p role="status">กรุณารอให้การทำงานปัจจุบันเสร็จ แล้วเปิดรายการใหม่</p>}
        {error && <p role="alert" className="inline-error">{error}</p>}
        <button className="primary" type="button" disabled={busy || preview.blocked || !preview.count || !!error} onClick={() => void run(async () => {
          await action("history.archive", { projectId: project.id, kind: preview.kind, confirmation: preview.token });
          setPreview(null);
          setNotice("เก็บเข้าคลังแล้ว");
        })}>ยืนยันเก็บเข้าคลัง</button>
      </div>
    </Dialog>}
  </div>;
}
