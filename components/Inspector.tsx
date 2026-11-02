"use client";
import { useState } from "react";
import { Settings2, Send, FileText, Clock3, MessageSquare } from "lucide-react";
import type { Agent, Snapshot, Task } from "../shared/types";
import { Avatar } from "./Avatar";
export function Inspector({
  agent,
  state,
  projectId,
  configure,
  send,
  openTask,
  openChat,
}: {
  agent: Agent;
  state: Snapshot;
  projectId: string;
  configure: () => void;
  send: (body: string) => Promise<void>;
  openTask: (task: Task) => void;
  openChat: () => void;
}) {
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false);
  const task = state.tasks.find(
    (t) =>
      t.agentId === agent.id &&
      (t.status === "running" || t.status === "waiting"),
  );
  const recent = state.tasks
    .filter((t) => t.agentId === agent.id && t.projectId === projectId)
    .slice(-3)
    .reverse();
  const model =
    state.models.find((m) => m.model === agent.model)?.displayName ||
    agent.model ||
    "Codex default";
  return (
    <aside className="inspector">
      <h2>ข้อมูลสมาชิก</h2>
      <div className="agent-heading">
        <Avatar agent={agent} size={100} />
        <div>
          <h3>{agent.name}</h3>
          <p>{agent.role}</p>
          <span className="agent-status">
            <i className={`dot ${task?.status || "ready"}`} />
            {task?.status === "waiting"
              ? "รออนุมัติ"
              : task
                ? "กำลังทำงาน"
                : "พร้อมทำงาน"}
          </span>
        </div>
      </div>
      <button className="primary full" onClick={configure}>
        <Settings2 size={17} />
        ตั้งค่าสมาชิก
      </button>
      <section>
        <label className="field-title">Model</label>
        <div className="display-field">{model}</div>
        <label className="field-title">งานปัจจุบัน</label>
        {task ? (
          <button className="current-task" onClick={() => openTask(task)}>
            <FileText size={21} />
            <span>
              {task.title}
              <small>{task.activity}</small>
            </span>
          </button>
        ) : (
          <div className="current-task muted">
            <FileText size={23} />
            ยังไม่มีงาน
          </div>
        )}
      </section>
      <section>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return;
            setBusy(true);
            try {
              await send(text);
              setText("");
            } catch {
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field-title" htmlFor="inspector-message">
            ข้อความถึง {agent.name}
          </label>
          <textarea
            id="inspector-message"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            required
            maxLength={16000}
            placeholder={`พิมพ์ข้อความถึง ${agent.name}…`}
          />
          <button className="primary full" disabled={busy || !text.trim()}>
            <Send size={17} />
            {busy ? "กำลังส่ง…" : "ส่งข้อความ"}
          </button>
        </form>
        <button className="text-button full" onClick={openChat}>
          <MessageSquare size={15} />
          เปิดบทสนทนา
        </button>
      </section>
      <section className="activity">
        <h3>กิจกรรมล่าสุด</h3>
        {recent.length ? (
          recent.map((item) => (
            <button
              className="activity-row"
              key={item.id}
              onClick={() => openTask(item)}
            >
              <Clock3 size={17} />
              <span>
                {item.title}
                <small>{item.activity}</small>
              </span>
            </button>
          ))
        ) : (
          <div className="inspector-empty">
            <Clock3 size={30} strokeWidth={1.5} />
            <strong>ยังไม่มีกิจกรรม</strong>
            <small>การสนทนาและการดำเนินงานจะแสดงที่นี่</small>
          </div>
        )}
      </section>
    </aside>
  );
}
