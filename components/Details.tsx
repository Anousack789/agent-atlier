"use client";
import { canRecoverTaskCode, blockedWorkDelivery, incompleteDeliveryError, deliveryCheckLabel, pendingVerification, reviewableWorkDelivery } from "../shared/workflow";
import { TemplateSave } from "./TemplateSave";
import { WorkflowReview } from "./WorkflowReview";
import { useState } from "react";
import { Check, Square, FileDiff } from "lucide-react";
import type { Approval, Snapshot, Task, TaskWorktree } from "../shared/types";
import { FailureInfo, taskStatusLabel } from "./TaskBoard";
import { Dialog } from "./Dialog";
import { ChatPanel } from "./ChatPanel";
import { TaskFiles } from "./TaskFiles";
type Action = <T = unknown>(name: string, data?: unknown) => Promise<T>;
export function TaskDetail({
  task,
  state,
  action,
  remove,
  openTask,
  openApproval,
  round = false,
}: {
  task: Task;
  state: Snapshot;
  round?: boolean;
  action: Action;
  remove: (task: Task) => void;
  openTask?: (task: Task) => void;
  openApproval?: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState("");
  const [checked, setChecked] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [resumeError, setResumeError] = useState("");
  const waitingForChecks = task.status === "paused" && !!pendingVerification(task);
  const waitingForInput = task.status === "paused" && !!blockedWorkDelivery(task);
  const external = state.approvals.filter(a => a.taskId === task.id && a.type === "external");
  const unknown = external.filter(a => a.status === "unknown");
  const canPause = task.rootId === task.id && !task.parentTaskId && !task.workflow &&
    !task.stage && !task.plan?.assignments.length && !!task.approvedRevision;
  const run = async (name: string) => {
    setBusy(true);
    setResumeError("");
    try {
      await action(name, { id: task.id, ...(name === "task.resume" ? { body, checked } : {}) });
      setBody("");
      setChecked(false);
    } catch (error) {
      if (name === "task.resume") setResumeError(error instanceof Error ? error.message : "ทำงานต่อไม่ได้");
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
    const trees = item.worktrees?.length ? item.worktrees
      : item.branch && (item === task || !task.workflow) ? [undefined] : [];
    const recoveryAllowed = canRecoverTaskCode(item, item === task ? reviewOwner : task);
    return trees.map((tree) => {
      const change = tree || item;
      const recovery = recoveryAllowed && !!(change.workspace && change.branch && change.baseBranch && change.baseCommit);
      return { task: item, tree, recovery };
    });
  });
  const needsReview = ({ task, tree, recovery }: (typeof repositories)[number]) =>
    (canReviewDiff(task) || recovery) && !(tree || task).mergedAt;
  repositories.sort((a, b) => Number(needsReview(b)) - Number(needsReview(a)));
  const pending = repositories.filter(needsReview).length;
  const reposId = `task-repos-${task.id}`;
  const evidence = [task, ...repositoryTasks].flatMap((item) => {
    const delivery = item.deliveries?.at(-1);
    return (delivery?.checks || []).filter((check) => check.evidence?.trim()).map((check) => ({ item, delivery: delivery!, check }));
  });
  return (
    <div className="task-detail">
      <div className="detail-meta">
        <span className={`status-tag ${task.status}`}>
          {taskStatusLabel(task)}
        </span>
        {task.archivedAt && <span className="status-tag">อยู่ในคลัง</span>}
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
          <TemplateSave task={task} action={action} />

          <section aria-label="สถานะและขั้นตอนถัดไป" className="space-y-2">
            <h3>สถานะและขั้นตอนถัดไป</h3>
            {task.conversationCode && <p className="break-all">
              โค้ดจากบทสนทนา · {task.conversationCode.repositoryName} · {task.conversationCode.branch} · {task.conversationCode.mergedAt ? "รวมแล้ว" : "ยังไม่รวม"}
            </p>}
            <p>สถานะล่าสุด: {taskStatusLabel(task)}{task.status !== "interrupted" && task.activity ? ` · ${task.activity}` : ""}</p>
            <p>{task.status === "interrupted" ? "งานถูกขัดจังหวะ ตรวจ diff และผลงานก่อนสร้างงานใหม่ ระบบไม่เริ่มงานหรือ merge เอง" :
              waitingForChecks ? "เมื่อพร้อมแล้ว กดตรวจต่อเพื่อทำรายการที่ยังค้าง" :
              reviewableWorkDelivery(task) ? "ตรวจข้อจำกัดและเลือกคำตัดสินสำหรับผลงานฉบับล่าสุด" :
              waitingForInput ? "คุยกับเจ้าของงานในแชตด้านล่าง แล้วกดทำงานต่อเมื่อพร้อม" :
              task.status === "paused" ? "ตรวจผลงานและเลือกทำงานต่อเมื่อพร้อม" :
              task.status === "reviewing" || task.workflow?.phase === "acceptance" ? "ตรวจ diff ผลงาน และหลักฐานก่อนตรวจรับ" :
              task.status === "accepted" || task.workflow?.phase === "accepted" ? "ตรวจ diff และอนุมัติ merge ทีละ repo ที่ยังรอ ก่อนยืนยันปิดงาน" :
              "ตรวจสถานะและผลงานด้านล่าง"}</p>
            {task.autoContinuation && <p>ใช้รอบทำต่ออัตโนมัติแล้ว {task.autoContinuation.count}/2</p>}
          </section>
          {[task, ...repositoryTasks].filter((item) => item.status === "failed" || (item.status === "paused" && (blockedWorkDelivery(item) || pendingVerification(item)))).map((item) => {
            const delivery = item.deliveries?.at(-1);
            const waiting = item.status === "paused";
            const incomplete = waiting ? pendingVerification(item) || blockedWorkDelivery(item) :
              item.error === incompleteDeliveryError || item.error === "เกณฑ์ตรวจรับยังไม่ผ่านครบ โปรดตรวจผลและปรับแผนแก้ไข" ? delivery : undefined;
            const blocked = !delivery && item.dependsOn?.some((id) => state.tasks.some((dependency) => dependency.id === id && ["failed", "cancelled", "interrupted"].includes(dependency.status)));
            return <section key={item.id} aria-label={`เหตุที่ ${item.title} หยุด`} className="space-y-2 break-words">
              <h3>{item.title} · {waiting || delivery?.checks.some((check) => check.status === "failed") ? taskStatusLabel(item) : incomplete ? "สมาชิกส่งงานไม่ครบ" : blocked ? "รอขั้นก่อนหน้า" : "งานขัดข้อง"}</h3>
              {incomplete ? incomplete.incomplete ? <dl className="space-y-1 whitespace-pre-wrap">
                <div><dt className="font-semibold">เหตุผลที่หยุด</dt><dd>{incomplete.incomplete.reason}</dd></div>
                <div><dt className="font-semibold">ทำแล้ว</dt><dd>{incomplete.incomplete.completed}</dd></div>
                <div><dt className="font-semibold">ยังต้องทำ</dt><dd>{incomplete.incomplete.remaining}</dd></div>
                <div><dt className="font-semibold">{incomplete.incomplete.waitingForUser === true ? "สิ่งที่ต้องการจากคุณ" : "สิ่งที่ต้องการเพื่อทำต่อ"}</dt><dd>{incomplete.incomplete.needed}</dd></div>
              </dl> : <p>ไม่ทราบสาเหตุ: ผลงานฉบับนี้ไม่ได้บันทึกเหตุผลแยก โปรดดูหลักฐานด้านล่าง</p>
                : <p className="whitespace-pre-wrap">{item.error || "ไม่ทราบสาเหตุ"}</p>}
              {waiting ? item.id !== task.id && openTask && <button onClick={() => openTask(item)}>{pendingVerification(item) ? "เปิดงานเพื่อตรวจต่อ" : "คุยกับเจ้าของขั้น"} {item.title}</button>
                : reviewableWorkDelivery(item) ? <p>ขั้นต่อไป: บันทึกผลตรวจหรือข้อยกเว้นในการ์ดผลงานแล้วกดยืนยันส่งต่อ</p>
                : <p>ขั้นต่อไป: ตรวจผลงานและให้ Boss เสนอแผนแก้ก่อนยืนยันทำต่อ</p>}
            </section>;
          })}
          <section aria-label="หลักฐานการตรวจ" className="space-y-2">
            <h3>หลักฐานการตรวจ</h3>
            {evidence.length ? evidence.map(({ item, delivery, check }, index) => <div key={`${item.id}:${delivery.revision}:${index}`} className="break-words">
              <p><strong>{item.title} · {check.criterion}</strong> · {deliveryCheckLabel(item, delivery, check)}</p>
              <p className="muted small">ที่มา: รายงานจาก agent · ผลงาน v{delivery.revision} ระบบไม่ได้ยืนยันผลคำสั่งแยก</p>
              <p className="whitespace-pre-wrap">{check.evidence}</p>
              <TaskFiles taskId={item.id} output={check.evidence} revision={delivery.revision} />
            </div>) : <p className="muted">ยังไม่มีหลักฐานการตรวจ</p>}
          </section>

          {task.status !== "draft" && task.plan && <details><summary>{task.approvedRevision ? `แผนที่ยืนยันแล้ว v${task.approvedRevision}` : "แผนที่ยังไม่ได้ยืนยัน"}</summary><p className="whitespace-pre-wrap">{task.plan.goal}</p><ol className="list-decimal pl-6">{task.plan.steps.map((step, i) => <li key={i}>{step}</li>)}</ol><p>{task.plan.deliverable}</p></details>}
          {task.status === "failed" && <FailureInfo task={task} agents={state.agents} />}
          {task.error && <p className="inline-error">{task.error}</p>}
          {task.resumeNotes?.map((note, index) => <p key={index} className="whitespace-pre-wrap">คำสั่งเพิ่มเติม: {note}</p>)}
          {task.status === "paused" && (
            <div className="space-y-2" id={`resume-${task.id}`} tabIndex={-1}>
              <label className="block">คำสั่งเพิ่มเติม (เว้นว่างได้)
                <textarea className="block w-full" value={body} onChange={e => setBody(e.target.value)} maxLength={16000} />
              </label>
              {external.some(a => a.status === "executing") && <p role="status">กำลังรอผลการดำเนินการภายนอก</p>}
              {!!unknown.length && <div>
                {unknown.map(a => <p key={a.id}>{a.title} · ยังไม่ทราบผล</p>)}
                <label><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> ตรวจบริการปลายทางแล้ว</label>
              </div>}
              <div className="detail-toolbar">
                <button className={waitingForInput || waitingForChecks ? "primary" : undefined} disabled={busy || (!!unknown.length && !checked) || external.some(a => a.status === "executing")} onClick={() => run("task.resume")}>{waitingForChecks ? "ตรวจต่อ" : "ทำงานต่อ"}</button>
                <button className="danger-outline" disabled={busy} onClick={() => run("task.stop")}>ยกเลิกงาน</button>
              </div>
              {resumeError && <p role="alert" className="inline-error">{resumeError}</p>}
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
            {!task.archivedAt && ["failed", "interrupted", "cancelled"].includes(task.status) && (
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
          {!round && <ChatPanel key={session.id} state={state} projectId={session.projectId} initialChannel={session.channel} sessionTask={session} action={action} openTask={openTask} openApproval={openApproval} />}
          {task.status === "reviewing" && <button className="primary" disabled={busy} onClick={() => void decideReview("accept")}>ตรวจรับงานฉบับล่าสุด</button>}
          {task.status === "accepted" && <button className="primary" disabled={busy || reviewCode.some((item) => !item.mergedAt)} onClick={() => void decideReview("close")}>ยืนยันปิดงานหลัง merge ครบ</button>}
          {reviewError && <p role="alert" className="inline-error">{reviewError}</p>}
        </div>
        {!!repositories.length && <aside id={reposId} tabIndex={-1} aria-label="Repositories" className="min-w-0 self-start rounded-lg border border-[var(--line)] p-3">
          <h2 className="mb-2 text-base font-semibold">Repos ({repositories.length})</h2>
          {repositories.map((repo) => <RepositoryChanges
            key={`${repo.task.id}:${repo.tree?.id ?? ""}:${repo.recovery}`}
            {...repo}
            sourcePath={repo.tree?.path || state.projects.find((project) => project.id === repo.task.projectId)?.path}
          />)}
        </aside>}
        {!repositories.length && task.kind === "code" && <p className="muted">ยังไม่มีข้อมูล repository หรือ worktree สำหรับดู diff และ merge</p>}
      </div>
    </div>
  );
}
function canReviewDiff(task: Task) {
  return ["completed", "accepted", "reviewing"].includes(task.status);
}

function RepositoryChanges({ task, tree, sourcePath, recovery }: { recovery: boolean; task: Task; tree?: TaskWorktree; sourcePath?: string }) {
  const change = tree || task;
  const recovering = recovery && !change.mergedAt;
  const query = new URLSearchParams(task.sharedConversationId ? { conversationId: task.sharedConversationId } : { id: task.id });
  if (tree) query.set("repositoryId", tree.id);
  if (recovering && !task.sharedConversationId) query.set("recovery", "true");
  return <details open={recovery || undefined} className="border-t border-[var(--line)] py-2">
    <summary className="cursor-pointer break-words py-1 font-medium">
      {tree?.name || (recovery ? "Repo หลัก" : "การเปลี่ยนแปลงโค้ด")}
      <span className="muted small"> · {change.mergedAt ? "รวมแล้ว" : recovering ? "กู้โค้ด" : "ยังไม่ merge"}</span>
    </summary>
    <div className="space-y-2 py-2">
      {recovery && <p className="break-words">งานเจ้าของ worktree: {task.title}</p>}
      {sourcePath && (tree || recovery) && <p className="file-path break-all">Repo ปลายทาง: {sourcePath}</p>}
      <p className="break-all"><code>{change.branch}</code> → <code>{change.baseBranch}</code></p>
      <p className="muted small break-all">พื้นที่ทำงาน: {change.workspace}</p>
      <a className="diff-link" href={`/diff?${query}`} target="_blank" rel="noopener noreferrer"><FileDiff size={17} /> ดู diff และ merge</a>
    </div>
  </details>;
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
