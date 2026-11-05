"use client";
import {
  CircleCheck,
  ClipboardCheck,
  Circle,
  Clock3,
  FileText,
  LoaderCircle,
  MessageSquare,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { groupTasks } from "../shared/task-groups";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import type { Agent, Task } from "../shared/types";
import { blockedWorkDelivery, defectsFound, incompleteDeliveryError, pendingVerification, reviewableWorkDelivery, readyWithLimitations, waitingForPrerequisite, waitingForVerification, waitingForWorkInput } from "../shared/workflow";
export const statusLabel: Record<Task["status"], string> = {
  paused: "พักงานแล้ว",
  pausing: "กำลังหยุด",
  draft: "รอยืนยันแผน",
  queued: "รอเริ่ม",
  running: "กำลังทำ",
  waiting: "รออนุมัติ",
  reviewing: "รอคุณตรวจรับ",
  accepted: "ตรวจรับแล้ว รอ merge",
  completed: "เสร็จแล้ว",
  failed: "มีข้อผิดพลาด",
  cancelled: "หยุดแล้ว",
  interrupted: "ถูกขัดจังหวะ",
};
function needsStageApproval(task: Task) {
  const delivery = task.deliveries?.at(-1);
  return task.status === "completed" && task.stage?.reviewRequired && !!delivery && !delivery.approvedAt;
}
export const taskStatusLabel = (task: Task) => task.workflow
  ? ({ active: "กำลังดำเนินงาน", acceptance: "รอตรวจรับ", accepted: "ตรวจรับแล้ว รอ merge", closed: "ปิดงานแล้ว", replanning: "รอแผนแก้ไข", interrupted: "ถูกขัดจังหวะ" }[task.workflow.phase])
  : task.status === "queued" && task.activity === waitingForPrerequisite ? waitingForPrerequisite
  : task.status === "paused" && pendingVerification(task) ? waitingForVerification
  : task.status === "failed" && task.error === incompleteDeliveryError && task.deliveries?.at(-1)?.checks.some((check) => check.status === "failed") ? defectsFound
  : reviewableWorkDelivery(task) ? readyWithLimitations
  : task.status === "paused" && blockedWorkDelivery(task) ? waitingForWorkInput
  : needsStageApproval(task) ? "รออนุมัติผลงาน"
  : task.status === "waiting" && task.plan?.assignments.length && task.approvedRevision ? "รอผลทีม" : statusLabel[task.status];
const boardDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Vientiane", year: "numeric", month: "2-digit", day: "2-digit" });
const failureDate = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Vientiane", dateStyle: "medium", timeStyle: "short" });

export function FailureInfo({ task, agents }: { task: Task; agents: Agent[] }) {
  const timestamp = task.failedAt || task.updatedAt;
  return <small className="muted block break-words">
    {agents.find((agent) => agent.id === task.agentId)?.name || task.agentId} · {task.failedAt ? "ล้มเหลว" : "อัปเดตล่าสุด"}{" "}
    <time dateTime={timestamp}>{failureDate.format(new Date(timestamp))}</time>
  </small>;
}

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
  const [dateFilter, setDateFilter] = useState("all");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const today = boardDate.format(new Date());
  const firstDay = new Date(`${today}T00:00:00Z`);
  firstDay.setUTCDate(firstDay.getUTCDate() - 6);
  const from = dateFilter === "today" ? today : dateFilter === "week" ? firstDay.toISOString().slice(0, 10) : dateFilter === "range" ? start : "";
  const to = dateFilter === "today" || dateFilter === "week" ? today : dateFilter === "range" ? end : "";
  const invalidRange = !!from && !!to && from > to;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const groups = groupTasks(tasks);
  const visibleTasks = [...groups].flatMap(([id, group]) => {
    const root = byId.get(id)!;
    const created = boardDate.format(new Date(root.createdAt));
    if (root.archivedAt || invalidRange || (from && created < from) || (to && created > to)) return [];
    return [group.findLast((task) => task.sessionRound && task.relatedTaskId === root.id) || root];
  });
  const progress = (task: Task) => {
    const children = (groups.get(task.sessionRound ? task.relatedTaskId || task.id : task.id) || [])
      .filter((child) => child.id !== task.id && !child.sessionRound && (child.parentTaskId || child.rootId !== child.id));
    const failed = children.filter((child) => child.status === "failed").length;
    return children.length ? `เสร็จ ${children.filter((child) => child.status === "completed" && !needsStageApproval(child)).length}/${children.length}${failed ? ` · Failed ${failed}` : ""}` : "";
  };
  const title = (task: Task) => (task.sessionRound && byId.get(task.relatedTaskId || "")?.title) || task.title;
  const pendingStages = new Set(tasks.filter(needsStageApproval).map((task) => task.id));
  const pendingWorkflowApproval = (task: Task) => task.status === "waiting" && task.workflow?.phase === "active" &&
    task.workflow.taskIds.some((id) => pendingStages.has(id));
  const boardStatus = (task: Task) => {
    if (pendingStages.has(task.id) || (task.status === "waiting" &&
      (task.workflow?.phase === "acceptance" || task.workflow?.phase === "accepted" || pendingWorkflowApproval(task)))) return "reviewing";
    return task.status;
  };
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
      label: "รอตรวจรับ",
      statuses: ["reviewing", "accepted"],
      Icon: ClipboardCheck,
      empty: "ยังไม่มีงานรอตรวจรับ",
      hint: "งานที่ต้องตรวจรับหรืออนุมัติจะแสดงที่นี่",
      color: "waiting",
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
  const issues = visibleTasks.filter((t) =>
    ["failed", "cancelled", "interrupted"].includes(t.status),
  );
  return (
    <section className="task-board">
      <div className="section-heading">
        <h2>งานในทีม</h2>
        <span className="muted">
          {visibleTasks.length ? `${visibleTasks.length} งาน` : ""}
        </span>
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger aria-label="กรองตามวันที่สร้างงาน" className="w-auto"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกวันที่สร้าง</SelectItem>
            <SelectItem value="today">วันนี้</SelectItem>
            <SelectItem value="week">7 วันล่าสุด</SelectItem>
            <SelectItem value="range">ช่วงวันที่</SelectItem>
          </SelectContent>
        </Select>
        {dateFilter === "range" && <>
          <label className="grid gap-1 text-sm">ตั้งแต่<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
          <label className="grid gap-1 text-sm">ถึง<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        </>}
        {invalidRange && <p role="alert" className="inline-error">วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด</p>}
      </div>
      <div className="board-columns">
        {columns.map((column) => {
          const items = visibleTasks.filter((t) => column.statuses.includes(boardStatus(t)));
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
                          {["waiting", "reviewing", "accepted"].includes(boardStatus(task)) && (
                            <span className="waiting-text">{pendingWorkflowApproval(task) ? "รออนุมัติผลงาน" : taskStatusLabel(task)}</span>
                          )}
                          {task.status === "draft" && <span className="waiting-text">รอยืนยันแผน</span>}
                        </div>
                        <strong>{title(task)}</strong>
                        <p>{task.activity}</p>
                        {progress(task) && <small>{progress(task)}</small>}
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
                <button className="issue-row min-w-0 flex-wrap text-left" onClick={() => open(task)}>
                  <FileText size={16} />
                  <div className="min-w-0 break-words">
                    <strong>{title(task)}</strong>
                    {progress(task) && <small className="block">{progress(task)}</small>}
                    {task.status === "failed" && <FailureInfo task={task} agents={agents} />}
                  </div>
                  <span>{taskStatusLabel(task)}</span>
                </button>
                {groups.get(task.id)?.length === 1 && <button className="icon-button" aria-label={`ลบงาน ${task.title}`} onClick={() => remove(task)}><Trash2 size={16} /></button>}
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
