"use client";
import {
  CircleCheck,
  Circle,
  Clock3,
  FileText,
  LoaderCircle,
  MessageSquare,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import type { Agent, Task } from "../shared/types";
export const statusLabel: Record<Task["status"], string> = {
  paused: "พักงานแล้ว",
  pausing: "กำลังหยุด",
  draft: "รอยืนยันแผน",
  queued: "รอเริ่ม",
  running: "กำลังทำ",
  waiting: "รออนุมัติ",
  completed: "เสร็จแล้ว",
  failed: "มีข้อผิดพลาด",
  cancelled: "หยุดแล้ว",
  interrupted: "ถูกขัดจังหวะ",
};
export const taskStatusLabel = (task: Task) => task.workflow
  ? ({ active: "กำลังดำเนินงาน", acceptance: "รอตรวจรับ", accepted: "ตรวจรับแล้ว รอ merge", closed: "ปิดงานแล้ว", replanning: "รอแผนแก้ไข", interrupted: "ถูกขัดจังหวะ" }[task.workflow.phase])
  : task.stage?.reviewRequired && task.status === "completed" && !task.deliveries?.at(-1)?.approvedAt ? "รออนุมัติผลงาน"
  : task.status === "waiting" && task.plan?.assignments.length && task.approvedRevision ? "รอผลทีม" : statusLabel[task.status];
export function TaskBoard({
  tasks,
  agents,
  open,
  remove,
}: {
  tasks: Task[];
  agents: Agent[];
  open: (task: Task) => void;
  remove: (task: Task) => void;
}) {
  const columns = [
    {
      label: "แผนและคิวงาน",
      statuses: ["draft", "queued", "paused"],
      Icon: Clock3,
      empty: "ยังไม่มีงานในคิวนี้",
      hint: "สร้างงานใหม่เพื่อเริ่มต้น",
      color: "neutral",
    },
    {
      label: "กำลังทำ",
      statuses: ["running", "waiting", "pausing"],
      Icon: LoaderCircle,
      empty: "ยังไม่มีงานที่กำลังทำ",
      hint: "งานจากทีมจะเริ่มที่นี่",
      color: "blue",
    },
    {
      label: "เสร็จแล้ว",
      statuses: ["completed"],
      Icon: CircleCheck,
      empty: "ยังไม่มีงานที่เสร็จแล้ว",
      hint: "งานที่เสร็จแล้วจะแสดงที่นี่",
      color: "green",
    },
  ];
  const issues = tasks.filter((t) =>
    ["failed", "cancelled", "interrupted"].includes(t.status),
  );
  return (
    <section className="task-board">
      <div className="section-heading">
        <h2>งานในทีม</h2>
        <span className="muted">
          {tasks.length ? `${tasks.length} งาน` : ""}
        </span>
      </div>
      <div className="board-columns">
        {columns.map((column) => {
          const items = tasks.filter((t) => column.statuses.includes(t.stage?.reviewRequired && t.status === "completed" && !t.deliveries?.at(-1)?.approvedAt ? "waiting" : t.status));
          return (
            <div key={column.label} className="board-column">
              <h3>
                <i className={`dot ${column.color}`} />
                {column.label}
                {items.length ? <span>{items.length}</span> : null}
              </h3>
              {items.length ? (
                <div className="task-list">
                  {items
                    .slice()
                    .reverse()
                    .map((task) => (
                      <button
                        className="task-card"
                        key={task.id}
                        onClick={() => open(task)}
                      >
                        <div className="task-card-top">
                          <span>
                            {task.kind === "code" ? "โค้ด" : "งานทั่วไป"}
                          </span>
                          {task.status === "waiting" && (
                            <span className="waiting-text">{taskStatusLabel(task)}</span>
                          )}
                          {task.status === "draft" && <span className="waiting-text">รอยืนยันแผน</span>}
                        </div>
                        <strong>{task.title}</strong>
                        <p>{task.activity}</p>
                        <footer>
                          <Circle size={12} />
                          {agents.find((a) => a.id === task.agentId)?.name ||
                            task.agentId}
                        </footer>
                      </button>
                    ))}
                </div>
              ) : (
                <div className="board-empty">
                  <column.Icon size={29} strokeWidth={1.5} />
                  <p>{column.empty}</p>
                  <small>{column.hint}</small>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {issues.length > 0 && (
        <div className="issue-tasks">
          <h3>
            <AlertTriangle size={16} />
            งานที่หยุดหรือมีข้อผิดพลาด
          </h3>
          {issues
            .slice()
            .reverse()
            .map((task) => (
              <div key={task.id} className="flex items-center gap-2">
                <button className="issue-row" onClick={() => open(task)}>
                  <FileText size={16} />
                  <strong>{task.title}</strong>
                  <span>{statusLabel[task.status]}</span>
                </button>
                <button className="icon-button" aria-label={`ลบงาน ${task.title}`} onClick={() => remove(task)}><Trash2 size={16} /></button>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
