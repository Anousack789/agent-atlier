"use client";
import { PlanReview } from "./PlanReview";
import { WorkflowReview } from "./WorkflowReview";
import { busyStatuses } from "../shared/types";
import { TaskFiles } from "./TaskFiles";
import { useEffect, useRef, useState } from "react";
import { Send, Users, MessageSquare, ImagePlus, X } from "lucide-react";
import type { Intake, Message, Snapshot, Task } from "../shared/types";
import { Avatar } from "./Avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import {
  imageMimeTypes,
  maxImageBytes,
  maxImages,
  messageImageUrl,
  type ImageUpload,
} from "../shared/images";

const noRecipientValue = "__no_recipient__";
type DraftImage = { id: string; file: File };
type Draft = { body: string; images: DraftImage[] };
const emptyDraft: Draft = { body: "", images: [] };

function IntakeRecovery({ turn, action }: {
  turn: Intake;
  action: (name: string, data?: unknown) => Promise<unknown>;
}) {
  const [manual, setManual] = useState(false);
  const [kind, setKind] = useState("general");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const retries = turn.intake.retries || 0;
  async function run(name: string, data: object) {
    setBusy(true);
    setError("");
    try { await action(name, { id: turn.id, ...data }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "ดำเนินการไม่ได้"); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-2 py-2">
    <p className="inline-error" role="status">ตีความข้อความไม่สำเร็จ</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void run("intake.retry", { retries })}>ลองตีความอีกครั้ง</button>
      {!!retries && <button type="button" aria-expanded={manual} disabled={busy} onClick={() => setManual(!manual)}>กรอกแผนเอง</button>}
    </div>
    {manual && <form className="form" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void run("intake.manualPlan", {
        kind,
        goal: String(form.get("goal")).trim(),
        steps: String(form.get("steps")).split("\n").map((line) => line.trim()).filter(Boolean),
        deliverable: String(form.get("deliverable")).trim(),
      });
    }}>
      <label>เป้าหมาย<textarea name="goal" defaultValue={turn.prompt} rows={2} maxLength={16000} required /></label>
      <label>ขั้นตอน (หนึ่งขั้นต่อบรรทัด สูงสุด 20 ขั้น)<textarea name="steps" rows={3} maxLength={16000} required /></label>
      <label>ผลลัพธ์ที่จะส่งมอบ<textarea name="deliverable" rows={2} maxLength={16000} required /></label>
      <div>
        <p>ประเภทงาน</p>
        <Select value={kind} onValueChange={setKind} disabled={busy}>
          <SelectTrigger aria-label="ประเภทงาน"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="general">งานทั่วไป</SelectItem><SelectItem value="code">แก้โค้ดใน worktree แยก</SelectItem></SelectContent>
        </Select>
      </div>
      <button type="submit" disabled={busy}>บันทึกแผนเพื่อรอยืนยัน</button>
    </form>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}

function DraftPreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <img src={url} alt={file.name} /> : null;
}
function ChatImage({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <p role="status">โหลดรูป {name} ไม่ได้</p>
  ) : (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`เปิดรูป ${name} ในแท็บใหม่`}
    >
      <img
        src={url}
        alt={name}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </a>
  );
}
function imageUpload(file: File): Promise<ImageUpload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`อ่านรูป ${file.name} ไม่ได้`));
    reader.onload = () =>
      resolve({
        name: file.name,
        mime: file.type as ImageUpload["mime"],
        base64: String(reader.result).split(",")[1],
      });
    reader.readAsDataURL(file);
  });
}
export function ChatPanel({
  state,
  projectId,
  initialChannel,
  action,
  sessionTask,
}: {
  state: Snapshot;
  sessionTask?: Task;
  projectId: string;
  initialChannel: string;
  action: (name: string, data?: unknown) => Promise<unknown>;
}) {
  const [channel, setChannel] = useState(initialChannel),
    [relatedTasks, setRelatedTasks] = useState<Record<string, string>>({}),
    [drafts, setDrafts] = useState<Record<string, Draft>>({}),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  const messageList = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const previousConversation = useRef("");
  const [showLatest, setShowLatest] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sending = useRef(false);
  const draftKey = JSON.stringify([projectId, channel]);
  const relatedTaskId = relatedTasks[draftKey] || "";
  const boss = state.agents.find((a) => a.boss);
  const ownerId = sessionTask?.agentId ?? (channel === "team" ? boss?.id : channel);
  const rounds = sessionTask ? [sessionTask, ...state.tasks.filter((t) => t.sessionRound && t.relatedTaskId === sessionTask.id)] : [];
  const sessionTasks = rounds.flatMap((t) => [t, ...state.tasks.filter((child) => child.parentTaskId === t.id)]);
  const sessionIds = new Set(sessionTasks.map((t) => t.id));
  const sessionIntakes = (turn: Snapshot["intakes"][number]) => !sessionTask || turn.intake.sessionTaskId === sessionTask.id ||
    sessionIds.has(turn.intake.targetTaskId || turn.intake.relatedTaskId || "");
  const relatedOptions = state.tasks.filter((task) => task.projectId === projectId && task.channel === channel && task.agentId === ownerId);
  const pendingIntakes = state.intakes.filter((turn) => turn.projectId === projectId && turn.channel === channel && sessionIntakes(turn) && busyStatuses.includes(turn.status));
  const failedIntakes = new Map(state.intakes.filter((turn) => turn.status === "failed" && turn.projectId === projectId &&
    turn.channel === channel && turn.channel === turn.agentId && sessionIntakes(turn) &&
    !turn.intake.targetTaskId && !turn.intake.directReply && turn.sourceMessageId).map((turn) => [turn.sourceMessageId, turn]));
  const draftTasks = state.tasks.filter((task) => task.projectId === projectId && task.channel === channel && task.status === "draft" && (!sessionTask || rounds.some((round) => round.id === task.id)));
  const error = errors[draftKey] || "";
  const setError = (message: string) =>
    setErrors((all) => ({ ...all, [draftKey]: message }));
  const { body, images } = drafts[draftKey] || emptyDraft;
  const updateDraft = (update: (draft: Draft) => Draft) =>
    setDrafts((all) => ({
      ...all,
      [draftKey]: update(all[draftKey] || emptyDraft),
    }));
  const addImages = (files: File[]) => {
    if (sending.current || !files.length) return;
    if (images.length + files.length > maxImages) {
      setError("แนบรูปได้สูงสุด 4 รูป");
      return;
    }
    if (
      files.some(
        (file) => !imageMimeTypes.includes(file.type as ImageUpload["mime"]),
      )
    ) {
      setError("รองรับเฉพาะ PNG, JPEG และ WebP แบบภาพนิ่ง");
      return;
    }
    if (
      files.some(
        (file) =>
          !file.size || file.size > maxImageBytes || file.name.length > 200,
      )
    ) {
      setError("รูปต้องมีข้อมูล ขนาดไม่เกิน 5 MiB และชื่อไม่เกิน 200 ตัวอักษร");
      return;
    }
    setError("");
    const added = files.map((file) => ({ id: crypto.randomUUID(), file }));
    updateDraft((draft) =>
      draft.images.length + added.length <= maxImages
        ? { ...draft, images: [...draft.images, ...added] }
        : draft,
    );
  };
  const messages: Message[] = state.messages.filter((m) => m.projectId === projectId && m.channel === channel &&
    (!sessionTask || sessionIds.has(m.taskId || "") || sessionTasks.some((t) => t.sourceMessageId === m.id)));
  for (const task of sessionTasks) {
    if (task.prompt && !messages.some((m) => m.from === "user" && m.body === task.prompt && (m.taskId === task.id || m.id === task.sourceMessageId)) && rounds.includes(task)) messages.push({
      id: `prompt-${task.id}`, projectId, channel, from: "user", body: task.prompt, createdAt: task.createdAt,
    });
    for (const delivery of task.deliveries || []) {
      if (!messages.some((m) => m.taskId === task.id && m.deliveryRevision === delivery.revision && m.body === delivery.output)) messages.push({
        id: `delivery-${task.id}-${delivery.revision}`, projectId, channel, taskId: task.id, from: task.agentId,
        body: delivery.output, deliveryRevision: delivery.revision, createdAt: delivery.createdAt,
      });
    }
    const delivery = task.deliveries?.at(-1);
    if (task.output && !messages.some((m) => m.taskId === task.id && m.from === task.agentId && (m.body === task.output || (!task.stage && task.output.endsWith(`\n\n${m.body}`))))) messages.push({
      id: `output-${task.id}`, projectId, channel, taskId: task.id, from: task.agentId, body: task.output,
      deliveryRevision: delivery?.output === task.output ? delivery.revision : undefined, createdAt: task.updatedAt,
    });
  }
  if (sessionTask) messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  useEffect(() => {
    setChannel(initialChannel);
  }, [initialChannel]);
  useEffect(() => {
    const list = messageList.current;
    if (!list) return;
    const conversation = JSON.stringify([projectId, channel, sessionTask?.id]);
    if (previousConversation.current !== conversation || nearBottom.current) {
      list.scrollTop = list.scrollHeight;
      nearBottom.current = true;
      setShowLatest(false);
    } else {
      setShowLatest(true);
    }
    previousConversation.current = conversation;
  }, [projectId, channel, sessionTask?.id, messages.length]);
  const agent = state.agents.find((a) => a.id === channel);
  return (
    <section className="panel chat-panel">
      <div className="chat-top">
        <div>
          <h2>{sessionTask ? "บทสนทนาของงาน" : agent ? `คุยกับ ${agent.name}` : "ห้องทีม"}</h2>
          {!sessionTask && channel === "team" && <p className="recipient"><Users size={14} />{boss ? `Boss · ${boss.name} ช่วยตีความและเสนอแผนก่อนเริ่มงาน` : "เลือก Boss ในหน้าตั้งค่าสมาชิกก่อนให้ช่วยในห้องรวม"}</p>}
        </div>
        {!sessionTask && <Select
          value={channel}
          onValueChange={setChannel}
        >
          <SelectTrigger aria-label="เลือกห้องสนทนา"><SelectValue /></SelectTrigger>
          <SelectContent>
          <SelectItem value="team">ห้องทีม</SelectItem>
          {state.agents.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              แชตส่วนตัว · {a.name}
            </SelectItem>
          ))}
          </SelectContent>
        </Select>}
      </div>
      <div className="chat-messages" ref={messageList} onScroll={(event) => {
        const list = event.currentTarget;
        nearBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        if (nearBottom.current) setShowLatest(false);
      }}>
        {!messages.length && (
          <div className="large-empty">
            <MessageSquare size={35} />
            <h3>เริ่มบทสนทนาแรก</h3>
            <p>ถามคำถาม แชร์ข้อมูล หรือชวนสมาชิกมาช่วยคิด</p>
          </div>
        )}
        {messages.map((message) => {
          const author = state.agents.find((a) => a.id === message.from);
          const to = state.agents.find((a) => a.id === message.to);
          const failedIntake = failedIntakes.get(message.id);
          const delivery = sessionTask && message.deliveryRevision
            ? sessionTasks.find((t) => t.id === message.taskId)?.deliveries?.find((d) => d.revision === message.deliveryRevision && d.output === message.body)
            : undefined;
          return (
            <article
              className={`chat-message ${message.from === "user" ? "user" : ""} ${message.from === "system" ? "system" : ""}`}
              key={message.id}
            >
              {author ? (
                <Avatar agent={author} size={34} />
              ) : (
                <div className="sender-initial">
                  {message.from === "user" ? "คุณ" : "i"}
                </div>
              )}
              <div>
                <header>
                  <strong>
                    {author?.name || (message.from === "user" ? "คุณ" : "ระบบ")}
                  </strong>
                  {to && <span>ถึง {to.name}</span>}
                  <time>
                    {new Date(message.createdAt).toLocaleTimeString("th-TH", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </header>
                {message.body && (
                  <div className="message-body">{message.body}</div>
                )}
                {message.taskDeleted && <p className="muted small">งานนี้ถูกลบแล้ว</p>}
                {message.taskId && !message.taskDeleted && message.from !== "user" && message.from !== "system" && (
                  <TaskFiles taskId={message.taskId} output={message.body} revision={message.deliveryRevision} />
                )}
                {!!delivery?.checks.length && <ul className="flex flex-col gap-2 py-2">{delivery.checks.map((check) => <li key={check.criterion} className="break-words">
                  <strong>{check.status === "passed" ? "agent รายงานว่าผ่าน" : check.status === "failed" ? "agent รายงานว่าไม่ผ่าน" : "ยังไม่ได้ตรวจ"} · {check.criterion}</strong>
                  <p className="whitespace-pre-wrap">{check.evidence}</p>
                </li>)}</ul>}
                {!!message.images?.length && (
                  <div className="chat-images">
                    {message.images.map((image) => (
                      <ChatImage
                        key={image.id}
                        url={messageImageUrl(message.id, image.id)}
                        name={image.name}
                      />
                    ))}
                  </div>
                )}
                {failedIntake && <IntakeRecovery key={failedIntake.id} turn={failedIntake} action={action} />}
              </div>
            </article>
          );
        })}
        {(sessionTask ? sessionTasks : state.tasks.filter((task) => task.projectId === projectId && task.channel === channel)).filter((task) => task.activityHistory?.length).map((task) => <details key={`activity-${task.id}`} className="border-t border-[var(--line)] py-3">
          <summary>กิจกรรมล่าสุด · {task.title} (สูงสุด 200 รายการ)</summary>
          <ol className="space-y-2 py-2">{task.activityHistory!.map((entry, index) => <li key={index} className="whitespace-pre-wrap break-words"><time className="muted small">{new Date(entry.at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</time> · {entry.text}</li>)}</ol>
        </details>)}
        {draftTasks.map((task) => <article className="border-t border-[var(--line)] py-5" key={task.id}><PlanReview key={`${task.id}:${task.planRevision}`} task={task} state={state} action={action} /></article>)}
        {!sessionTask && state.tasks.filter((task) => task.projectId === projectId && task.channel === channel && task.workflow && task.status !== "draft" && task.workflow.phase !== "closed").map((task) => <WorkflowReview key={task.id} task={task} state={state} action={action} />)}
        {!!pendingIntakes.length && <p className="muted" role="status">{sessionTask ? "รอเจ้าของงานรับข้อความ" : "กำลังตีความหรือรอสมาชิกว่าง"} · {pendingIntakes.length} ข้อความ</p>}
        {state.intakes.filter((turn) => turn.projectId === projectId && turn.channel === channel && sessionIntakes(turn) && turn.status === "interrupted").map((turn) => <p className="inline-error" key={turn.id}>การตีความ “{turn.prompt.slice(0, 80)}” ถูกขัดจังหวะ กรุณาส่งข้อความใหม่เมื่อพร้อม</p>)}
      </div>
      {showLatest && <button type="button" className="chat-latest" onClick={() => {
        const list = messageList.current;
        if (list) list.scrollTop = list.scrollHeight;
        nearBottom.current = true;
        setShowLatest(false);
      }}>ไปยังข้อความล่าสุด ↓</button>}
      <form
        className="chat-composer"
        onSubmit={async (e) => {
          e.preventDefault();
          if (sending.current || (!body.trim() && !images.length)) return;
          sending.current = true;
          nearBottom.current = true;
          if (messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight;
          setBusy(true);
          setError("");
          try {
            await action("message.send", {
              projectId,
              channel,
              to: ownerId,
              taskId: sessionTask?.id ?? (relatedOptions.some((task) => task.id === relatedTaskId) ? relatedTaskId : undefined),
              ...(sessionTask && { taskSession: true }),
              body,
              images: await Promise.all(
                images.map(({ file }) => imageUpload(file)),
              ),
            });
            setDrafts((all) => {
              const next = { ...all };
              delete next[draftKey];
              return next;
            });
          } catch (error) {
            setError(
              error instanceof Error ? error.message : "ส่งข้อความไม่ได้",
            );
          } finally {
            sending.current = false;
            setBusy(false);
          }
        }}
      >
        <div className="composer-tools">
        {!sessionTask && <label>คุยต่อเกี่ยวกับงานนี้
          <Select value={relatedOptions.some((task) => task.id === relatedTaskId) ? relatedTaskId : noRecipientValue} onValueChange={(value) => setRelatedTasks((all) => ({ ...all, [draftKey]: value === noRecipientValue ? "" : value }))}>
            <SelectTrigger aria-label="คุยต่อเกี่ยวกับงานนี้"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={noRecipientValue}>บทสนทนาใหม่ / ยังไม่ระบุงาน</SelectItem>{relatedOptions.map((task) => <SelectItem key={task.id} value={task.id}>{task.title}</SelectItem>)}</SelectContent>
          </Select>
        </label>}
        <div className="attachment-toolbar">
          <input
            ref={fileInput}
            type="file"
            accept={imageMimeTypes.join(",")}
            multiple
            hidden
            onChange={(e) => {
              addImages(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          <button
            type="button"
            title="PNG, JPEG, WebP · สูงสุด 4 รูป รูปละ 5 MiB"
            disabled={busy || images.length >= maxImages}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus size={18} /> แนบรูป
          </button>
          <span className="muted">
            PNG, JPEG, WebP · สูงสุด 4 รูป รูปละ 5 MiB
          </span>
        </div>
        </div>
        {!!images.length && (
          <div className="draft-images">
            {images.map(({ id, file }) => (
              <div className="draft-image" key={id}>
                <DraftPreview file={file} />
                <span title={file.name}>{file.name}</span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`ลบรูป ${file.name}`}
                  onClick={() => {
                    setError("");
                    updateDraft((draft) => ({
                      ...draft,
                      images: draft.images.filter((image) => image.id !== id),
                    }));
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
        {error && (
          <p className="attachment-error" role="alert">
            {error}
          </p>
        )}
        <div className="composer-row">
          <textarea
            aria-label="ข้อความ"
            rows={3}
            value={body}
            disabled={busy}
            onChange={(e) =>
              updateDraft((draft) => ({ ...draft, body: e.target.value }))
            }
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) {
                e.preventDefault();
                addImages(files);
              }
            }}
            maxLength={16000}
            placeholder="พิมพ์ข้อความของคุณ…"
          />
          <button
            className="primary"
            aria-label="ส่ง"
            disabled={busy || (!body.trim() && !images.length)}
          >
            <Send size={18} />
            <span>ส่ง</span>
          </button>
        </div>
      </form>
    </section>
  );
}
