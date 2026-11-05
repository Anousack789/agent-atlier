"use client";
import { deliveryCheckLabel } from "../shared/workflow";
import { PlanReview } from "./PlanReview";
import { WorkflowReview } from "./WorkflowReview";
import { busyStatuses, conversationWorktrees } from "../shared/types";
import { HumanReviewEvidence, SummarySources, TaskFiles } from "./TaskFiles";
import { useEffect, useRef, useState } from "react";
import { Send, Users, MessageSquare, ImagePlus, X } from "lucide-react";
import type { ChatMode, Conversation, HandoffReference, Intake, Message, Repository, Snapshot, Task } from "../shared/types";
import { ConversationHandoff } from "./ConversationHandoff";
import { Dialog } from "./Dialog";
import { projectRepositories } from "../shared/projects";
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
type Draft = { body: string; images: DraftImage[]; mode?: ChatMode; permission?: "read-only" | "workspace-write"; editRepositories?: Pick<Repository, "id" | "path">[]; handoff?: HandoffReference; handoffFiles?: { path: string; revision?: number }[] };
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
  initialConversationId,
  action,
  sessionTask,
  openTask,
  openApproval,
}: {
  state: Snapshot;
  sessionTask?: Task;
  openTask?: (task: Task) => void;
  openApproval?: (id: string) => void;
  projectId: string;
  initialChannel: string;
  initialConversationId?: string;
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
  const contextToggle = useRef<HTMLButtonElement>(null);
  const [showContext, setShowContext] = useState(false);
  const [mobileList, setMobileList] = useState(!initialConversationId);
  const [selected, select] = useState<Record<string, string>>({});
  const [repositoryPicker, setRepositoryPicker] = useState("");
  const [handoff, setHandoff] = useState("");
  const [recording, setRecording] = useState("");
  const [recordPending, setRecordPending] = useState(false);
  const [query, setQuery] = useState("");
  const [showArchive, setShowArchive] = useState(false);
  const [renaming, setRenaming] = useState("");
  const roomKey = JSON.stringify([projectId, channel]);
  const roomConversations = (state.conversations || []).filter((item) => item.projectId === projectId && item.channel === channel);
  const conversation = sessionTask ? undefined : roomConversations.find((item) => item.id === selected[roomKey]);
  const conversationId = conversation?.id;
  const conversations = roomConversations.filter((item) => !!item.archivedAt === showArchive &&
    item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  useEffect(() => {
    if (initialConversationId && channel === initialChannel) {
      select((all) => ({ ...all, [roomKey]: initialConversationId }));
      return;
    }
    try {
      const saved = localStorage.getItem("atelier-conversation:" + roomKey);
      if (saved) select((all) => ({ ...all, [roomKey]: saved }));
    } catch { /* Storage may be disabled. */ }
  }, [roomKey, initialConversationId, initialChannel, channel]);
  const selectConversation = (id: string) => {
    setMobileList(false);
    select((all) => ({ ...all, [roomKey]: id }));
    setRenaming("");
    try { localStorage.setItem("atelier-conversation:" + roomKey, id); }
    catch { /* Storage may be disabled. */ }
  };
  const draftKey = JSON.stringify([projectId, channel, conversationId]);
  const relatedTaskId = relatedTasks[draftKey] || "";
  const boss = state.agents.find((a) => a.boss);
  const ownerId = sessionTask?.agentId ?? (channel === "team" ? boss?.id : channel);
  const rounds = sessionTask ? [sessionTask, ...state.tasks.filter((t) => t.sessionRound && t.relatedTaskId === sessionTask.id)] : [];
  const sessionTasks = rounds.flatMap((t) => [t, ...state.tasks.filter((child) => child.parentTaskId === t.id)]);
  const sessionIds = new Set(sessionTasks.map((t) => t.id));
  const sourceConversation = (task: Task) => state.messages.find((message) => message.id === task.sourceMessageId)?.conversationId;
  const inConversation = (task: Task) => !!sessionTask || sourceConversation(task) === conversationId;
  const sessionIntakes = (turn: Snapshot["intakes"][number]) => !turn.intake.handoffDraft && (!sessionTask ? inConversation(turn) : turn.intake.sessionTaskId === sessionTask.id ||
    sessionIds.has(turn.intake.targetTaskId || turn.intake.relatedTaskId || ""));
  const relatedOptions = state.tasks.filter((task) => !task.archivedAt && task.projectId === projectId && task.channel === channel && task.agentId === ownerId && !sourceConversation(task));
  const pendingIntakes = state.intakes.filter((turn) => turn.projectId === projectId && turn.channel === channel && sessionIntakes(turn) && busyStatuses.includes(turn.status));
  const failedIntakes = new Map(state.intakes.filter((turn) => turn.status === "failed" && turn.projectId === projectId &&
    turn.channel === channel && turn.channel === turn.agentId && sessionIntakes(turn) &&
    !turn.intake.targetTaskId && !turn.intake.directReply && turn.sourceMessageId).map((turn) => [turn.sourceMessageId, turn]));
  const draftTasks = state.tasks.filter((task) => task.projectId === projectId && task.channel === channel && task.status === "draft" && inConversation(task) && (!sessionTask || rounds.some((round) => round.id === task.id)));
  const error = errors[draftKey] || "";
  const setError = (message: string) =>
    setErrors((all) => ({ ...all, [draftKey]: message }));
  const { body, images, mode = "auto", permission = "read-only", editRepositories = [], handoff: reference, handoffFiles } = drafts[draftKey] || emptyDraft;
  const project = state.projects.find((item) => item.id === projectId);
  const worktrees = conversationWorktrees(conversation);
  const editRepos = project ? projectRepositories(project).filter((repo) =>
    !worktrees.some((tree) => tree.id === repo.id && tree.path !== repo.path)) : [];
  const canEdit = state.agents.some((agent) => agent.id === ownerId && agent.permission === "workspace-write");
  const wantsEdit = !sessionTask && !!conversationId && mode === "chat" && permission === "workspace-write";
  const unavailableRepos = editRepositories.filter((selection) => !editRepos.some((repo) =>
    repo.id === selection.id && repo.path === selection.path));
  const editError = wantsEdit && (!canEdit ? "สมาชิกไม่มีสิทธิ์แก้ไฟล์ กรุณาเลือกอ่านอย่างเดียว"
    : unavailableRepos.length ? "ตรวจ repository ที่ไม่พร้อมใช้งานก่อนส่ง"
    : !editRepositories.length ? "เลือกอย่างน้อยหนึ่ง repository ก่อนส่ง" : "");
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
  const channelTasks = state.tasks.filter((task) => task.projectId === projectId && task.channel === channel && inConversation(task));
  const tasksById = new Map(channelTasks.map((task) => [task.id, task]));
  const lastArchive = !sessionTask && state.messages.reduce((latest, message) =>
    message.projectId === projectId && message.archivedAt && message.archivedAt > latest ? message.archivedAt : latest, "");
  const messages: Message[] = state.messages.filter((m) => {
    if (m.projectId !== projectId || m.channel !== channel || (!sessionTask && (m.archivedAt || m.conversationId !== conversationId)) ||
        (sessionTask && !sessionIds.has(m.taskId || "") && !sessionTasks.some((t) => t.sourceMessageId === m.id))) return false;
    const task = tasksById.get(m.taskId || "");
    if (m.from !== task?.agentId) return true;
    if (task.stage && m.deliveryRevision !== undefined)
      return m.deliveryRevision === task.deliveries?.at(-1)?.revision;
    if (task.workflow) return !channelTasks.some((child) => child.parentTaskId === task.id &&
      child.stage?.kind === "summary" && child.deliveries?.some((delivery) => delivery.output === m.body));
    return true;
  });
  for (const task of sessionTasks) {
    if (task.prompt && !messages.some((m) => m.from === "user" && m.body === task.prompt && (m.taskId === task.id || m.id === task.sourceMessageId)) && rounds.includes(task)) messages.push({
      id: `prompt-${task.id}`, projectId, channel, from: "user", body: task.prompt, createdAt: task.createdAt,
    });
  }
  for (const task of sessionTask ? sessionTasks : channelTasks) {
    const delivery = task.deliveries?.at(-1);
    if (delivery && (!lastArchive || delivery.createdAt > lastArchive) && !messages.some((m) => m.taskId === task.id && m.deliveryRevision === delivery.revision)) messages.push({
      id: `delivery-${task.id}-${delivery.revision}`, projectId, channel, taskId: task.id, from: task.agentId,
      body: delivery.output, deliveryRevision: delivery.revision, createdAt: delivery.createdAt,
    });
    if (!sessionTask) continue;
    if (!task.stage && !task.workflow && task.output && !messages.some((m) => m.taskId === task.id && m.from === task.agentId && (m.body === task.output || (!task.stage && task.output.endsWith(`\n\n${m.body}`))))) messages.push({
      id: `output-${task.id}`, projectId, channel, taskId: task.id, from: task.agentId, body: task.output,
      deliveryRevision: delivery?.output === task.output ? delivery.revision : undefined, createdAt: task.updatedAt,
    });
  }
  messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  useEffect(() => {
    setChannel(initialChannel);
  }, [initialChannel]);
  useEffect(() => {
    const list = messageList.current;
    if (!list) return;
    const conversation = JSON.stringify([projectId, channel, conversationId, sessionTask?.id]);
    if (previousConversation.current !== conversation || nearBottom.current) {
      list.scrollTop = list.scrollHeight;
      nearBottom.current = true;
      setShowLatest(false);
    } else {
      setShowLatest(true);
    }
    previousConversation.current = conversation;
  }, [projectId, channel, conversationId, sessionTask?.id, messages.length, mobileList]);
  const agent = state.agents.find((a) => a.id === channel);
  const sendButton = (
    <button
      className="primary"
      aria-label="ส่ง"
      disabled={busy || !!editError || (!body.trim() && !images.length)}
    >
      <Send size={18} />
      <span>ส่ง</span>
    </button>
  );
  const messageField = (
    <textarea
      aria-label="ข้อความ"
      rows={sessionTask ? 3 : 2}
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
  );
  return (
    <section className={sessionTask ? "panel chat-panel" : "panel chat-panel chat-workbench"}
      onKeyDown={(event) => {
        if (event.defaultPrevented || !showContext || event.key !== "Escape") return;
        setShowContext(false);
        contextToggle.current?.focus();
      }}>
      <div className="chat-top">
        <div>
          <h2 className="flex items-center gap-2">{!sessionTask && agent && <Avatar agent={agent} size={34} />}{sessionTask ? "บทสนทนาของงาน" : agent ? `คุยกับ ${agent.name}` : "ห้องทีม"}</h2>
          {!sessionTask && channel === "team" && <p className="recipient"><Users size={14} />{boss ? `Boss · ${boss.name} ช่วยตีความและเสนอแผนก่อนเริ่มงาน` : "เลือก Boss ในหน้าตั้งค่าสมาชิกก่อนให้ช่วยในห้องรวม"}</p>}
        </div>
        {!sessionTask && <button type="button" ref={contextToggle} className="chat-context-toggle" aria-expanded={showContext}
          aria-controls="chat-work-context" onClick={() => setShowContext(!showContext)}>งานและสมาชิก</button>}
      </div>
      <div className={"chat-split" + (!sessionTask ? " chat-with-list" : "") + (mobileList ? " chat-show-list" : "")}>
      {!sessionTask && <nav className="chat-conversation-list" aria-label="บทสนทนา">
        <h3>บทสนทนา</h3>
        <button type="button" className="primary" onClick={async () => {
          try {
            const next = await action("conversation.create", { projectId, channel }) as Conversation;
            setShowArchive(false);
            setQuery("");
            selectConversation(next.id);
          } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        }}>+ แชตใหม่</button>
        <input aria-label="ค้นหาบทสนทนา" placeholder="ค้นหาบทสนทนา" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button type="button" aria-pressed={!conversationId} onClick={() => selectConversation("")}>ประวัติห้อง</button>
        <button type="button" aria-pressed={showArchive} onClick={() => setShowArchive(!showArchive)}>คลังบทสนทนา</button>
        {error && mobileList && <p className="inline-error" role="alert">{error}</p>}
        {!conversations.length && <p className="muted">ไม่พบบทสนทนา</p>}
        {conversations.toReversed().map((item) => <button type="button" key={item.id} aria-pressed={conversationId === item.id}
          onClick={() => selectConversation(item.id)}>{item.title || "บทสนทนาใหม่"}</button>)}
      </nav>}
      <div className="chat-thread">
      {!sessionTask && <button type="button" className="chat-back" onClick={() => setMobileList(true)}>← บทสนทนา</button>}
      {conversation && <div className="chat-conversation-heading flex flex-wrap items-center gap-2 border-b border-[var(--line)] p-3">
        <strong className="break-all">{conversation.title || "บทสนทนาใหม่"}</strong>
        <button type="button" onClick={() => setRenaming(conversation.id)}>เปลี่ยนชื่อ</button>
        <button type="button" onClick={async () => {
          try {
            await action("conversation.update", { id: conversation.id, archived: !conversation.archivedAt });
          } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        }}>{conversation.archivedAt ? "นำออกจากคลัง" : "เก็บเข้าคลัง"}</button>
        {renaming === conversation.id && <form key={conversation.id} className="flex flex-wrap gap-2" onSubmit={async (event) => {
          event.preventDefault();
          const title = new FormData(event.currentTarget).get("title");
          try {
            await action("conversation.update", { id: conversation.id, title });
            setRenaming("");
          } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        }}>
          <input aria-label="ชื่อบทสนทนา" name="title" defaultValue={conversation.title} maxLength={128} required />
          <button type="submit">บันทึกชื่อ</button>
          <button type="button" onClick={() => setRenaming("")}>ยกเลิก</button>
        </form>}
        {conversation.archivedAt && <p className="muted">บทสนทนาในคลัง · อ่านอย่างเดียว</p>}
        {conversation.archivedAt && error && <p className="inline-error" role="alert">{error}</p>}
      </div>}
      {wantsEdit && repositoryPicker === draftKey && <Dialog title="เลือก repository" close={() => setRepositoryPicker("")}>
        <fieldset className="chat-repository-picker" disabled={busy || !canEdit}>
          <legend className="small">เลือก worktree ที่อนุญาตให้แก้</legend>
          {unavailableRepos.map((repo) => <label key={repo.id}>
            <input type="checkbox" checked onChange={() => updateDraft((draft) => ({
              ...draft, editRepositories: (draft.editRepositories || []).filter((item) => item.id !== repo.id),
            }))} />
            <span>ไม่พร้อมใช้งาน · {repo.id}<small>{repo.path}</small></span>
          </label>)}
          {editRepos.map((repo) => <label key={repo.id}>
            <input type="checkbox" checked={editRepositories.some((item) => item.id === repo.id && item.path === repo.path)}
              onChange={(event) => {
                const checked = event.target.checked;
                updateDraft((draft) => {
                  const remaining = (draft.editRepositories || []).filter((item) => item.id !== repo.id);
                  return { ...draft, editRepositories: checked ? [...remaining, { id: repo.id, path: repo.path }] : remaining };
                });
              }} />
            <span>{repo.name}<small>{repo.path}</small></span>
          </label>)}
        </fieldset>
        <button type="button" className="primary mt-3" onClick={() => setRepositoryPicker("")}>เสร็จ</button>
      </Dialog>}
      {conversation && recording === conversation.id && <Dialog title="บันทึกงานที่เสร็จแล้ว" close={() => { if (!recordPending) setRecording(""); }}>
        <form className="form" onSubmit={async (event) => {
          event.preventDefault();
          if (recordPending) return;
          const form = new FormData(event.currentTarget);
          setRecordPending(true);
          setError("");
          try {
            const task = await action("conversation.recordCompleted", { id: conversation.id, title: form.get("title"), output: form.get("output") }) as Task;
            setRecording("");
            openTask?.(task);
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
          } finally {
            setRecordPending(false);
          }
        }}>
          <label>ชื่องาน<input name="title" defaultValue={conversation.title} maxLength={160} required /></label>
          <label>สรุปผลงาน<textarea name="output" rows={5} maxLength={16000} required /></label>
          {error && <p className="inline-error" role="alert">{error}</p>}
          <button type="submit" disabled={recordPending}>บันทึกเป็นงานเสร็จแล้ว</button>
        </form>
      </Dialog>}
      {conversationId && handoff === conversationId && <ConversationHandoff
        state={state} action={action} projectId={projectId} destinationId={conversationId} availableImages={maxImages - images.length} close={() => setHandoff("")}
        attach={(snapshot, handoff, files, handoffFiles) => {
          const combined = [body.trim(), snapshot].filter(Boolean).join("\n\n");
          if (combined.length > 16000 || images.length + files.length > maxImages) return false;
          updateDraft((draft) => ({ ...draft, body: combined, handoff, handoffFiles, images: [...draft.images, ...files.map((file) => ({ id: crypto.randomUUID(), file }))] }));
          return true;
        }} />}
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
          const reference = message.handoff;
          const sourceTask = reference?.kind === "task" ? state.tasks.find((task) => task.id === reference.id && task.projectId === projectId) : undefined;
          const sourceChat = reference?.kind === "conversation" ? state.conversations.find((chat) => chat.id === reference.id && chat.projectId === projectId) : undefined;
          const author = state.agents.find((a) => a.id === message.from);
          const to = state.agents.find((a) => a.id === message.to);
          const failedIntake = failedIntakes.get(message.id);
          const deliveryTask = message.deliveryRevision ? state.tasks.find((task) => task.id === message.taskId) : undefined;
          const delivery = message.deliveryRevision && (sessionTask || deliveryTask?.stage?.kind === "summary")
            ? deliveryTask?.deliveries?.find((d) => d.revision === message.deliveryRevision && d.output === message.body)
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
                {sourceTask && openTask && <button type="button" onClick={() => openTask(sourceTask)}>เปิดงานต้นทาง · {sourceTask.title}</button>}
                {sourceChat && !sessionTask && <button type="button" onClick={() => {
                  const sourceRoom = JSON.stringify([projectId, sourceChat.channel]);
                  try { localStorage.setItem("atelier-conversation:" + sourceRoom, sourceChat.id); }
                  catch { /* Storage may be disabled. */ }
                  select((all) => ({ ...all, [sourceRoom]: sourceChat.id }));
                  setChannel(sourceChat.channel);
                  setMobileList(false);
                }}>เปิดบทสนทนาต้นทาง · {sourceChat.title}</button>}
                {reference && !sourceTask && !sourceChat && <p className="muted small">ไม่พบรายการต้นทาง</p>}
                {message.handoffFiles?.map((file, index) => <a key={index} className="block break-all underline"
                  href={`/api/messages/${encodeURIComponent(message.id)}/handoff-files/${index}`} download={file.name}>{file.name}</a>)}
                {message.taskDeleted && <p className="muted small">งานนี้ถูกลบแล้ว</p>}
                {message.taskId && !message.taskDeleted && message.from !== "user" && message.from !== "system" && (
                  <TaskFiles taskId={message.taskId} output={message.body} revision={message.deliveryRevision} />
                )}
                {!!delivery?.checks.length && <ul className="flex flex-col gap-2 py-2">{delivery.checks.map((check) => <li key={check.criterion} className="break-words">
                  <strong>{deliveryCheckLabel(deliveryTask!, delivery, check)} · {check.criterion}</strong>
                  <p className="whitespace-pre-wrap">{check.evidence}</p>
                </li>)}</ul>}
                {delivery && <HumanReviewEvidence delivery={delivery} />}
                {delivery && deliveryTask?.stage?.kind === "summary" && <>
                  <SummarySources delivery={delivery} tasks={state.tasks} />
                  {openTask && deliveryTask.id !== sessionTask?.id &&
                    <button type="button" onClick={() => openTask(deliveryTask)}>เปิดขั้นสรุปของ Boss</button>}
                </>}
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
                {failedIntake && !conversation?.archivedAt && <IntakeRecovery key={failedIntake.id} turn={failedIntake} action={action} />}
              </div>
            </article>
          );
        })}
        {sessionTask && state.approvals.filter((approval) => approval.taskId === sessionTask.id && approval.status === "pending").map((approval) =>
          openApproval && <button key={approval.id} type="button" onClick={() => openApproval(approval.id)}>เปิดคำขออนุมัติ · {approval.title}</button>)}
        {sessionTask?.status === "paused" && state.approvals.some((approval) => approval.taskId === sessionTask.id && approval.type === "external" && approval.status === "unknown") &&
          <a className="underline" href={`#resume-${sessionTask.id}`}>ตรวจบริการปลายทางก่อนทำงานต่อ</a>}
        {(sessionTask ? sessionTasks : channelTasks).filter((task) => task.activityHistory?.length || (task.deliveries?.length ?? 0) > 1).map((task) => <details key={`activity-${task.id}`} className="border-t border-[var(--line)] py-3">
          <summary>กิจกรรมล่าสุด · {task.title} (สูงสุด 200 รายการ)</summary>
          <ol className="space-y-2 py-2">
            {task.activityHistory?.map((entry, index) => <li key={index} className="whitespace-pre-wrap break-words"><time className="muted small">{new Date(entry.at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</time> · {entry.text}</li>)}
            {task.deliveries?.slice(0, -1).map((delivery) => <li key={`v${delivery.revision}`} className="break-words">
              <details><summary>ฉบับส่งมอบ v{delivery.revision}</summary><p className="whitespace-pre-wrap">{delivery.output}</p>
                <TaskFiles taskId={task.id} output={delivery.output} revision={delivery.revision} />
              </details>
            </li>)}
          </ol>
        </details>)}
        {!conversation?.archivedAt && draftTasks.map((task) => <article className="border-t border-[var(--line)] py-5" key={task.id}><PlanReview key={`${task.id}:${task.planRevision}`} task={task} state={state} action={action} /></article>)}
        {sessionTask && (sessionTask.stage || sessionTask.workflow) && <WorkflowReview task={sessionTask} state={state} action={action} inTaskSession />}
        {!sessionTask && !conversation?.archivedAt && state.tasks.filter((task) => !task.archivedAt && task.projectId === projectId && task.channel === channel && inConversation(task) && task.workflow && task.status !== "draft" && task.workflow.phase !== "closed").map((task) => <WorkflowReview key={task.id} task={task} state={state} action={action} />)}
        {!!pendingIntakes.length && <p className="muted" role="status">{sessionTask ? "รอเจ้าของงานรับข้อความ" : "กำลังตีความหรือรอสมาชิกว่าง"} · {pendingIntakes.length} ข้อความ</p>}
        {state.intakes.filter((turn) => turn.projectId === projectId && turn.channel === channel && sessionIntakes(turn) && turn.status === "interrupted" && (!lastArchive || turn.updatedAt > lastArchive)).map((turn) => <p className="inline-error" key={turn.id}>การตีความ “{turn.prompt.slice(0, 80)}” ถูกขัดจังหวะ กรุณาส่งข้อความใหม่เมื่อพร้อม</p>)}
      </div>
      {showLatest && <button type="button" className="chat-latest" onClick={() => {
        const list = messageList.current;
        if (list) list.scrollTop = list.scrollHeight;
        nearBottom.current = true;
        setShowLatest(false);
      }}>ไปยังข้อความล่าสุด ↓</button>}
      {!sessionTask?.archivedAt && !conversation?.archivedAt && <form
        className="chat-composer"
        onSubmit={async (e) => {
          e.preventDefault();
          if (sending.current || editError || (!body.trim() && !images.length)) return;
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
              conversationId,
              handoff: reference,
              handoffFiles,
              mode: conversationId ? mode : undefined,
              editRepositories: wantsEdit ? editRepositories : undefined,
              taskId: sessionTask?.id ?? (!conversationId && relatedOptions.some((task) => task.id === relatedTaskId) ? relatedTaskId : undefined),
              ...(sessionTask && { taskSession: true }),
              body,
              images: await Promise.all(
                images.map(({ file }) => imageUpload(file)),
              ),
            });
            setDrafts((all) => {
              const next = { ...all };
              next[draftKey] = { ...emptyDraft, mode, permission, editRepositories };
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
        {!sessionTask && messageField}
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
        <div className="composer-tools">
        {handoffFiles?.map((file) => <span key={file.path} className="break-all">{file.path.split("/").at(-1)}</span>)}
        {reference && <button type="button" onClick={() => updateDraft((draft) => ({ ...draft, handoff: undefined, handoffFiles: undefined }))}>เอาลิงก์ต้นทางออก</button>}
        {conversationId && <button type="button" disabled={busy || !!reference} onClick={() => setHandoff(conversationId)}>อ้างอิงงาน</button>}
        {conversationId && <div className="composer-mode">
          <Select value={mode} disabled={busy} onValueChange={(value) => updateDraft((draft) => ({ ...draft, mode: value as ChatMode }))}>
            <SelectTrigger aria-label="โหมดแชต"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">ไม่ระบุ</SelectItem>
              <SelectItem value="chat">คุย</SelectItem>
              <SelectItem value="assign">สั่งงาน</SelectItem>
            </SelectContent>
          </Select>
          {!sessionTask && mode === "chat" && <Select value={permission} disabled={busy}
            onValueChange={(value) => updateDraft((draft) => ({ ...draft, permission: value as Draft["permission"] }))}>
            <SelectTrigger aria-label="สิทธิ์แก้ไข"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="read-only">อ่านอย่างเดียว</SelectItem>
              <SelectItem value="workspace-write" disabled={!canEdit || (!editRepos.length && !wantsEdit)}>อนุญาตให้แก้</SelectItem>
            </SelectContent>
          </Select>}
          {wantsEdit && <button type="button" aria-haspopup="dialog" disabled={busy || !canEdit}
            onClick={() => setRepositoryPicker(draftKey)}>Repository · {editRepositories.length} รายการ</button>}

        </div>}
        {!sessionTask && !conversationId && <label>คุยต่อเกี่ยวกับงานนี้
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
        {!sessionTask && sendButton}
          {editError && <p className="chat-permission-hint muted small" role="status">{editError}</p>}
          {wantsEdit && !editError && <p className="chat-permission-hint muted small">กดส่งเพื่ออนุญาตให้แก้เฉพาะใน worktree ที่เลือก</p>}
        </div>
        {sessionTask && <div className="composer-row">{messageField}{sendButton}</div>}
      </form>}
      </div>
      {!sessionTask && <aside id="chat-work-context" className={"chat-work-context" + (showContext ? " chat-context-open" : "")} aria-label="งานและสมาชิก">
        <h3>งานที่เกี่ยวข้อง</h3>
        {conversation ? <div className="chat-linked-work">
          <strong>{conversation.title || "บทสนทนาใหม่"}</strong>
        {worktrees.map((tree) => tree.mergedAt
          ? <span key={tree.id} className="muted">รวมแล้ว · {tree.name}</span>
          : <a key={tree.id} className="chat-diff-link" target="_blank" rel="noreferrer"
              href={"/diff?" + new URLSearchParams({ conversationId: conversation.id, repositoryId: tree.id })}>ตรวจ diff · {tree.name}</a>)}
        {!conversation.archivedAt && ownerId && messages.some((message) => message.from === "user") &&
          <button type="button" onClick={() => { setError(""); setRecording(conversation.id); }}>บันทึกงานที่เสร็จแล้ว</button>}
        {openTask && channelTasks.filter((task) => task.status === "completed").map((task) =>
          <button key={task.id} type="button" onClick={() => openTask(task)}>เปิดงาน · {task.title}</button>)}
        {!!conversation.abandonedWorktrees?.length && <details className="min-w-0">
          <summary>รอบที่ยกเลิก ({conversation.abandonedWorktrees.length})</summary>
          <ul>{conversation.abandonedWorktrees.map((tree) => <li key={tree.branch} className="break-all">
            {tree.name} · {tree.branch} · {tree.workspace}
          </li>)}</ul>
        </details>}
        </div> : <p className="muted">ยังไม่ได้เลือกบทสนทนา</p>}
        <h3>สลับห้อง</h3>
        <div className="chat-room-switcher" role="group" aria-label="เลือกห้องสนทนา">
          <button type="button" aria-pressed={channel === "team"} onClick={() => { setChannel("team"); setMobileList(true); setShowContext(false); contextToggle.current?.focus(); }}><Users size={18} /> ห้องรวม</button>
          {state.agents.map((member) => <button key={member.id} type="button" aria-pressed={channel === member.id} onClick={() => { setChannel(member.id); setMobileList(true); setShowContext(false); contextToggle.current?.focus(); }}>
            <Avatar agent={member} size={26} /> {member.name}
          </button>)}
        </div>
      </aside>}
      </div>
    </section>
  );
}
