"use client";
import { PlanReview } from "./PlanReview";
import { WorkflowReview } from "./WorkflowReview";
import { useState } from "react";
import { Check, GitMerge, Square, FileDiff, ExternalLink } from "lucide-react";
import type { Approval, Snapshot, Task, TaskWorktree } from "../shared/types";
import { taskStatusLabel } from "./TaskBoard";
import { TaskFiles } from "./TaskFiles";
type Action = <T = unknown>(name: string, data?: unknown) => Promise<T>;
export function TaskDetail({
  task,
  state,
  action,
}: {
  task: Task;
  state: Snapshot;
  action: Action;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (name: string) => {
    setBusy(true);
    try {
      await action(name, { id: task.id });
    } catch {
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="task-detail">
      <div className="detail-meta">
        <span className={`status-tag ${task.status}`}>
          {taskStatusLabel(task)}
        </span>
        <span>{state.agents.find((a) => a.id === task.agentId)?.name}</span>
        <span>{state.projects.find((p) => p.id === task.projectId)?.name}</span>
      </div>
      <p className="task-prompt">{task.prompt}</p>
      {(task.workflow || task.stage) && <WorkflowReview task={task} state={state} action={action} />}
      {task.status === "draft" && <PlanReview task={task} state={state} action={action} />}
      {task.status !== "draft" && task.plan && <details><summary>{task.approvedRevision ? `แผนที่ยืนยันแล้ว v${task.approvedRevision}` : "แผนที่ยังไม่ได้ยืนยัน"}</summary><p className="whitespace-pre-wrap">{task.plan.goal}</p><ol className="list-decimal pl-6">{task.plan.steps.map((step, i) => <li key={i}>{step}</li>)}</ol><p>{task.plan.deliverable}</p></details>}
      {state.tasks.some((t) => t.parentTaskId === task.id) && <ul>{state.tasks.filter((t) => t.parentTaskId === task.id).map((child) => <li key={child.id}>{child.title} · {taskStatusLabel(child)}</li>)}</ul>}
      {task.error && <p className="inline-error">{task.error}</p>}
      <div className="detail-toolbar">
        {["queued", "running", "waiting"].includes(task.status) && (
          <button
            className="danger-outline"
            disabled={busy}
            onClick={() => run("task.stop")}
          >
            <Square size={15} />
            หยุดงานนี้
          </button>
        )}
        {["failed", "interrupted", "cancelled"].includes(task.status) && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await action("task.create", {
                  title: task.title,
                  prompt: task.prompt,
                  projectId: task.projectId,
                  agentId: task.agentId,
                  kind: task.kind,
                });
              } catch {
              } finally {
                setBusy(false);
              }
            }}
          >
            สร้างงานใหม่จากคำสั่งเดิม
          </button>
        )}
      </div>
      <h3>ผลงานและผลตรวจสอบ</h3>
      <pre className="task-output">
        {task.output ||
          (["running", "waiting"].includes(task.status)
            ? `${task.activity}…`
            : "ยังไม่มีผลงาน")}
      </pre>
      <TaskFiles taskId={task.id} output={task.output} />
      {task.worktrees?.length ? (
        <>
          <h3>การเปลี่ยนแปลงโค้ด · {task.worktrees.filter((r) => r.mergedAt).length}/{task.worktrees.length} repo รวมแล้ว</h3>
          {task.worktrees.map((tree) => <RepositoryChanges key={tree.id} task={task} tree={tree} action={action} canMerge={!task.stage || state.tasks.find((t) => t.id === task.parentTaskId)?.workflow?.phase === "accepted"} />)}
        </>
      ) : task.branch ? <RepositoryChanges task={task} action={action} /> : null}
      {task.workflow && state.tasks.filter((t) => task.workflow!.taskIds.includes(t.id)).flatMap((child) => (child.worktrees || []).map((tree) => <RepositoryChanges key={`${child.id}-${tree.id}`} task={child} tree={tree} action={action} canMerge={task.workflow!.phase === "accepted"} />))}
    </div>
  );
}
function RepositoryChanges({ task, tree, action, canMerge = true }: { task: Task; tree?: TaskWorktree; action: Action; canMerge?: boolean }) {
  const [diff, setDiff] = useState<string>();
  const [diffReady, setDiffReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState<string>();
  const [error, setError] = useState("");
  const change = tree || task;
  return (
        <section className="git-section">
          <h3>{tree?.name || "การเปลี่ยนแปลงโค้ด"}</h3>
          {tree && <p className="file-path break-all">ต้นทาง: {tree.path}</p>}
          <p className="break-all">
            <code>{change.branch}</code> → <code>{change.baseBranch}</code>
          </p>
          <p className="muted small break-all">พื้นที่ทำงาน: {change.workspace}</p>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setDiffReady(false);
              try {
                const response = await fetch(
                  `/api/task-diff?id=${encodeURIComponent(task.id)}${tree ? `&repositoryId=${encodeURIComponent(tree.id)}` : ""}`,
                );
                const data = await response.json();
                if (!response.ok) throw new Error(data.error);
                setDiff(data.diff);
                setVersion(data.version);
                setDiffReady(true);
              } catch (error) {
                setDiff(
                  error instanceof Error
                    ? error.message
                    : "โหลด diff ไม่สำเร็จ",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <FileDiff size={17} />
            ดู / อัปเดต diff
          </button>
          {diff !== undefined && <pre className="diff-output">{diff}</pre>}
          {task.status === "completed" &&
            (change.mergedAt ? (
              <p className="success-text">
                <Check size={17} />
                รวมงานแล้ว {new Date(change.mergedAt).toLocaleString("th-TH")}
              </p>
            ) : (
              <>
                <p className="note">
                  ตรวจ diff และผลทดสอบก่อนรวม แอปจะ commit ผลงานใน worktree และ
                  merge กลับ branch เดิม โดยไม่ push
                </p>
                <button
                  className="primary"
                  disabled={busy || !diffReady || !canMerge}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try { await action("task.merge", { id: task.id, repositoryId: tree?.id, version }); setDiffReady(false); }
                    catch (failure) { setError(failure instanceof Error ? failure.message : "รวมโค้ดไม่ได้"); } finally { setBusy(false); }
                  }}
                >
                  <GitMerge size={17} />
                  อนุมัติรวม branch {tree ? `เข้า ${tree.name}` : "เข้าโปรเจกต์"}
                </button>
              </>
            ))}
          {error && <p className="inline-error" role="alert">{error}</p>}
        </section>
  );
}
export function ApprovalDetail({
  approval,
  state,
  action,
  done,
}: {
  approval: Approval;
  state: Snapshot;
  action: Action;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [answers, setAnswers] = useState<Record<string, string>>({});
  const payload = approval.payload as Record<string, any>;
  const respond = async (approve: boolean) => {
    setBusy(true);
    try {
      await action("approval.decide", { id: approval.id, approve, answers });
      done();
    } catch {
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="approval-detail">
      <div
        className="approval-content"
        tabIndex={0}
        role="region"
        aria-label="รายละเอียดคำขอ"
      >
        {approval.type !== "command" && approval.type !== "file" && (
          <h3>{approval.title}</h3>
        )}
        <div className="detail-meta">
          <span>
            {state.agents.find((a) => a.id === approval.agentId)?.name || "คุณ"}
          </span>
          <span>
            {state.projects.find((p) => p.id === approval.projectId)?.name}
          </span>
          <span>{new Date(approval.createdAt).toLocaleString("th-TH")}</span>
        </div>
        {approval.type === "external" && payload.action === "gmail_send" ? (
          <div className="email-preview">
            <label>จากบัญชี</label>
            <p>{payload.accountEmail || state.google.email}</p>
            <label>ถึง</label>
            <p>{payload.to.join(", ")}</p>
            <label>หัวข้อ</label>
            <h3>{payload.subject}</h3>
            <label>เนื้อหา</label>
            <div className="message-body">{payload.body}</div>
          </div>
        ) : approval.type === "external" &&
          payload.action === "calendar_write" ? (
          <div className="event-preview">
            <h3>{payload.summary}</h3>
            {payload.previous && (
              <div className="note">
                นัดหมายเดิม: {payload.previous.summary}
                <br />
                เริ่ม:{" "}
                {payload.previous.start?.dateTime || payload.previous.start?.date}
                <br />
                สิ้นสุด:{" "}
                {payload.previous.end?.dateTime || payload.previous.end?.date}
                <br />
                ผู้เข้าร่วมเดิม:{" "}
                {payload.previous.attendees.join(", ") || "ไม่มี"}
              </div>
            )}
            <dl>
              <dt>การเปลี่ยนแปลง</dt>
              <dd>{payload.eventId ? "แก้ไขนัดหมายเดิม" : "สร้างนัดหมายใหม่"}</dd>
              <dt>เริ่ม</dt>
              <dd>
                {new Date(payload.start).toLocaleString("th-TH", {
                  timeZone: payload.timezone,
                })}
              </dd>
              <dt>สิ้นสุด</dt>
              <dd>
                {new Date(payload.end).toLocaleString("th-TH", {
                  timeZone: payload.timezone,
                })}
              </dd>
              <dt>เขตเวลา</dt>
              <dd>{payload.timezone}</dd>
              <dt>ผู้เข้าร่วม</dt>
              <dd>
                {payload.attendees.join(", ") || "ไม่มีผู้เข้าร่วมเพิ่มเติม"}
              </dd>
            </dl>
            <p className="note">
              Google จะส่งการแจ้งเตือนไปยังผู้เข้าร่วมเมื่อบันทึก
            </p>
          </div>
        ) : (
          <pre className="approval-preview">{approval.details}</pre>
        )}
        {approval.type === "input" && (
          <div className="form">
            {(payload.questions || []).map((question: any) => (
              <label key={question.id}>
                {question.question}
                <textarea
                  rows={2}
                  value={answers[question.id] || ""}
                  onChange={(e) =>
                    setAnswers((previous) => ({
                      ...previous,
                      [question.id]: e.target.value,
                    }))
                  }
                  placeholder="คำตอบของคุณ"
                />
              </label>
            ))}
          </div>
        )}
        {approval.result && <p className="note">ผล: {approval.result}</p>}
      </div>
      {approval.status === "pending" ? (
        <footer className="decision-actions">
          <button disabled={busy} onClick={() => respond(false)}>
            ไม่อนุมัติ
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              (approval.type === "input" &&
                (payload.questions || []).some(
                  (question: any) => !answers[question.id]?.trim(),
                ))
            }
            onClick={() => respond(true)}
          >
            <Check size={17} />
            {busy
              ? "กำลังดำเนินการ…"
              : approval.type === "conversation"
                ? "อนุญาตให้คุยต่อ"
                : "อนุมัติและดำเนินการ"}
          </button>
        </footer>
      ) : (
        <p className="note approval-status">
          สถานะ:{" "}
          {approval.status === "approved"
            ? "อนุมัติแล้ว"
            : approval.status === "declined"
              ? "ไม่อนุมัติ"
              : approval.status === "unknown"
                ? "ต้องตรวจบริการปลายทางก่อนทำซ้ำ"
                : approval.status}
        </p>
      )}
    </div>
  );
}
