"use client";
import { WorkflowReview } from "./WorkflowReview";
import { useRef, useState } from "react";
import { Check, GitMerge, Square, FileDiff } from "lucide-react";
import type { Approval, Snapshot, Task, TaskWorktree } from "../shared/types";
import { taskStatusLabel } from "./TaskBoard";
import { Dialog } from "./Dialog";
import { ChatPanel } from "./ChatPanel";
type Action = <T = unknown>(name: string, data?: unknown) => Promise<T>;
export function TaskDetail({
  task,
  state,
  action,
  remove,
  round = false,
}: {
  task: Task;
  state: Snapshot;
  round?: boolean;
  action: Action;
  remove: (task: Task) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState("");
  const [checked, setChecked] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const external = state.approvals.filter(a => a.taskId === task.id && a.type === "external");
  const unknown = external.filter(a => a.status === "unknown");
  const canPause = task.rootId === task.id && !task.parentTaskId && !task.workflow &&
    !task.stage && !task.plan?.assignments.length && !!task.approvedRevision;
  const run = async (name: string) => {
    setBusy(true);
    try {
      await action(name, { id: task.id, ...(name === "task.resume" ? { body, checked } : {}) });
      setBody("");
      setChecked(false);
    } catch {
    } finally {
      setBusy(false);
    }
  };
  const session = task.sessionRound ? state.tasks.find((t) => t.id === task.relatedTaskId) || task : task;
  const rounds = !round && state.tasks.filter((t) => t.sessionRound && t.relatedTaskId === session.id && t.id !== task.id);
  const children = state.tasks.filter((child) => child.parentTaskId === task.id);
  const reviewOwner = state.tasks.find((parent) => parent.id === task.parentTaskId) || task;
  const reviewCode = [task, ...children].filter((item) => item.worktrees?.length || item.branch);
  const decideReview = async (decision: "accept" | "close") => {
    setBusy(true);
    setReviewError("");
    try { await action("task.review", { id: task.id, decision, version: task.reviewVersion }); }
    catch (error) { setReviewError(error instanceof Error ? error.message : "ตรวจรับงานไม่ได้"); }
    finally { setBusy(false); }
  };
  const repositoryTasks = task.workflow
    ? state.tasks.filter((item) => task.workflow!.taskIds.includes(item.id))
    : children;
  const repositories = [task, ...repositoryTasks].flatMap((item) => {
    const owner = item === task ? reviewOwner : task;
    const canMerge = item === task && item.worktrees?.length && item.stage
      ? owner.workflow?.phase === "accepted"
      : item !== task && task.workflow
        ? task.workflow.phase === "accepted"
        : !owner.reviewVersion || owner.status === "accepted";
    const reviewVersion = item !== task && task.workflow ? undefined : owner.reviewVersion;
    const trees = item.worktrees?.length ? item.worktrees
      : item.branch && (item === task || !task.workflow) ? [undefined] : [];
    return trees.map((tree) => ({ task: item, tree, canMerge, reviewVersion }));
  });
  const needsReview = ({ task, tree }: (typeof repositories)[number]) =>
    canReviewDiff(task) && !(tree || task).mergedAt;
  repositories.sort((a, b) => Number(needsReview(b)) - Number(needsReview(a)));
  const pending = repositories.filter(needsReview).length;
  const reposId = `task-repos-${task.id}`;
  return (
    <div className="task-detail">
      <div className="detail-meta">
        <span className={`status-tag ${task.status}`}>
          {taskStatusLabel(task)}
        </span>
        <span>{state.agents.find((a) => a.id === task.agentId)?.name}</span>
        <span>{state.projects.find((p) => p.id === task.projectId)?.name}</span>
        {!!repositories.length && <button type="button" aria-controls={reposId} onClick={() => {
          const repos = document.getElementById(reposId);
          repos?.focus({ preventScroll: true });
          repos?.scrollIntoView({ block: "start" });
        }}>
          {pending ? `${pending} repo รอตรวจ diff / merge` : `Repos (${repositories.length})`}
        </button>}
      </div>
      <div className={repositories.length ? "grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : ""}>
        <div className="min-w-0 space-y-3">
          {(task.workflow || task.stage) && <WorkflowReview task={task} state={state} action={action} inTaskSession />}

          {task.status !== "draft" && task.plan && <details><summary>{task.approvedRevision ? `แผนที่ยืนยันแล้ว v${task.approvedRevision}` : "แผนที่ยังไม่ได้ยืนยัน"}</summary><p className="whitespace-pre-wrap">{task.plan.goal}</p><ol className="list-decimal pl-6">{task.plan.steps.map((step, i) => <li key={i}>{step}</li>)}</ol><p>{task.plan.deliverable}</p></details>}
          {state.tasks.some((t) => t.parentTaskId === task.id) && <ul>{state.tasks.filter((t) => t.parentTaskId === task.id).map((child) => <li key={child.id}>{child.title} · {taskStatusLabel(child)}</li>)}</ul>}
          {task.error && <p className="inline-error">{task.error}</p>}
          {task.resumeNotes?.map((note, index) => <p key={index} className="whitespace-pre-wrap">คำสั่งเพิ่มเติม: {note}</p>)}
          {task.status === "paused" && (
            <div className="space-y-2">
              <label className="block">คำสั่งเพิ่มเติม (เว้นว่างได้)
                <textarea className="block w-full" value={body} onChange={e => setBody(e.target.value)} maxLength={16000} />
              </label>
              {external.some(a => a.status === "executing") && <p role="status">กำลังรอผลการดำเนินการภายนอก</p>}
              {!!unknown.length && <div>
                {unknown.map(a => <p key={a.id}>{a.title} · ยังไม่ทราบผล</p>)}
                <label><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> ตรวจบริการปลายทางแล้ว</label>
              </div>}
              <div className="detail-toolbar">
                <button disabled={busy || (!!unknown.length && !checked) || external.some(a => a.status === "executing")} onClick={() => run("task.resume")}>ทำงานต่อ</button>
                <button className="danger-outline" disabled={busy} onClick={() => run("task.stop")}>ยกเลิกงาน</button>
              </div>
            </div>
          )}
          <div className="detail-toolbar empty:hidden">
            {["queued", "running", "waiting"].includes(task.status) && (
              <button
                className="danger-outline"
                disabled={busy}
                onClick={() => run(canPause ? "task.pause" : "task.stop")}
              >
                <Square size={15} />
                {canPause ? "พักงาน" : "หยุดงานนี้"}
              </button>
            )}
            {["failed", "interrupted", "cancelled"].includes(task.status) && (
              <><button
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
              </button><button className="danger-outline" onClick={() => remove(task)}>ลบงาน</button></>
            )}
          </div>
          {rounds && rounds.filter((item) => item.status !== "draft").map((item, index) => <details key={item.id} open>
            <summary>รอบแก้ไข {index + 1} · {item.title}</summary>
            <TaskDetail task={item} state={state} action={action} remove={remove} round />
          </details>)}
          {!round && <ChatPanel key={session.id} state={state} projectId={session.projectId} initialChannel={session.channel} sessionTask={session} action={action} />}
          {task.status === "reviewing" && <button className="primary" disabled={busy} onClick={() => void decideReview("accept")}>ตรวจรับงานฉบับล่าสุด</button>}
          {task.status === "accepted" && <button className="primary" disabled={busy || reviewCode.some((item) => !item.mergedAt)} onClick={() => void decideReview("close")}>ยืนยันปิดงานหลัง merge ครบ</button>}
          {reviewError && <p role="alert" className="inline-error">{reviewError}</p>}
        </div>
        {!!repositories.length && <aside id={reposId} tabIndex={-1} aria-label="Repositories" className="min-w-0 self-start rounded-lg border border-[var(--line)] p-3">
          <h2 className="mb-2 text-base font-semibold">Repos ({repositories.length})</h2>
          {repositories.map((repo) => <RepositoryChanges key={`${repo.task.id}:${repo.tree?.id ?? ""}`} {...repo} action={action} />)}
        </aside>}
      </div>
    </div>
  );
}
function canReviewDiff(task: Task) {
  return ["completed", "accepted", "reviewing"].includes(task.status);
}

function RepositoryChanges({ task, tree, action, canMerge = true, reviewVersion }: { task: Task; tree?: TaskWorktree; action: Action; canMerge?: boolean; reviewVersion?: string }) {
  const diffTrigger = useRef<HTMLButtonElement>(null);
  const [diff, setDiff] = useState<string>();
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffReady, setDiffReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState<string>();
  const [error, setError] = useState("");
  const change = tree || task;
  return (
    <details className="border-t border-[var(--line)] py-2">
      <summary className="cursor-pointer break-words py-1 font-medium">
        {tree?.name || "การเปลี่ยนแปลงโค้ด"}
        {change.mergedAt ? <span className="muted small"> · รวมแล้ว</span>
          : canReviewDiff(task) && <span className="muted small"> · {diffReady && canMerge && (!reviewVersion || version === reviewVersion) ? "รอ merge" : "รอตรวจ"}</span>}
      </summary>
      <div className="space-y-2 py-2">
          {tree && <p className="file-path break-all">ต้นทาง: {tree.path}</p>}
          <p className="break-all">
            <code>{change.branch}</code> → <code>{change.baseBranch}</code>
          </p>
          <p className="muted small break-all">พื้นที่ทำงาน: {change.workspace}</p>
          <button
            ref={diffTrigger}
            aria-disabled={busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setDiffReady(false);
              setDiff(undefined);
              setDiffOpen(true);
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
          {diffOpen && <Dialog title={`Diff · ${tree?.name || task.title}`} close={() => {
            setDiffOpen(false);
            requestAnimationFrame(() => diffTrigger.current?.focus({ preventScroll: true }));
          }} wide>
            {diff === undefined ? <p role="status">กำลังโหลด diff…</p>
              : diffReady ? <pre className="diff-output" tabIndex={0} aria-label="Git diff">{diff || "ไม่มีการเปลี่ยนแปลง"}</pre>
              : <p role="alert" className="inline-error">{diff}</p>}
          </Dialog>}
          {canReviewDiff(task) &&
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
                  disabled={busy || !diffReady || !canMerge || (!!reviewVersion && version !== reviewVersion)}
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
      </div>
    </details>
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
