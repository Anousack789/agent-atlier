"use client";
import { PlanReview } from "./PlanReview";
import { WorkflowReview } from "./WorkflowReview";
import { busyStatuses } from "../shared/types";
import { TaskFiles } from "./TaskFiles";
import { useEffect, useRef, useState } from "react";
import { Send, Users, MessageSquare, ImagePlus, X } from "lucide-react";
import type { Snapshot } from "../shared/types";
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
}: {
  state: Snapshot;
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
  const fileInput = useRef<HTMLInputElement>(null);
  const sending = useRef(false);
  const draftKey = JSON.stringify([projectId, channel]);
  const relatedTaskId = relatedTasks[draftKey] || "";
  const boss = state.agents.find((a) => a.boss);
  const ownerId = channel === "team" ? boss?.id : channel;
  const relatedOptions = state.tasks.filter((task) => task.projectId === projectId && task.channel === channel && task.agentId === ownerId);
  const pendingIntakes = state.intakes.filter((turn) => turn.projectId === projectId && turn.channel === channel && busyStatuses.includes(turn.status));
  const draftTasks = state.tasks.filter((task) => task.projectId === projectId && task.channel === channel && task.status === "draft");
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
  const messages = state.messages.filter(
    (m) => m.projectId === projectId && m.channel === channel,
  );
  useEffect(() => {
    setChannel(initialChannel);
  }, [initialChannel]);
  useEffect(() => {
    const list = messageList.current;
    list?.scrollTo({
      top: list.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [projectId, channel, messages.length]);
  const agent = state.agents.find((a) => a.id === channel);
  return (
    <section className="panel chat-panel">
      <div className="chat-top">
        <div>
          <h2>{agent ? `คุยกับ ${agent.name}` : "ห้องทีม"}</h2>
          <p className="muted">
            บทสนทนาของโปรเจกต์{" "}
            {state.projects.find((p) => p.id === projectId)?.name}
          </p>
        </div>
        <Select
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
        </Select>
      </div>
      <div className="chat-messages" ref={messageList}>
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
                {message.taskId && message.from !== "user" && message.from !== "system" && (
                  <TaskFiles taskId={message.taskId} output={message.body} revision={message.deliveryRevision} />
                )}
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
              </div>
            </article>
          );
        })}
        {draftTasks.map((task) => <article className="border-t border-[var(--line)] py-5" key={task.id}><PlanReview task={task} state={state} action={action} /></article>)}
        {state.tasks.filter((task) => task.projectId === projectId && task.channel === channel && task.workflow && task.status !== "draft" && task.workflow.phase !== "closed").map((task) => <WorkflowReview key={task.id} task={task} state={state} action={action} />)}
        {!!pendingIntakes.length && <p className="muted" role="status">กำลังตีความหรือรอสมาชิกว่าง · {pendingIntakes.length} ข้อความ · ยังไม่เริ่มงาน</p>}
        {state.intakes.filter((turn) => turn.projectId === projectId && turn.channel === channel && turn.status === "interrupted").map((turn) => <p className="inline-error" key={turn.id}>การตีความ “{turn.prompt.slice(0, 80)}” ถูกขัดจังหวะ กรุณาส่งข้อความใหม่เมื่อพร้อม</p>)}
      </div>
      <form
        className="chat-composer"
        onSubmit={async (e) => {
          e.preventDefault();
          if (sending.current || (!body.trim() && !images.length)) return;
          sending.current = true;
          setBusy(true);
          setError("");
          try {
            await action("message.send", {
              projectId,
              channel,
              to: ownerId,
              taskId: relatedOptions.some((task) => task.id === relatedTaskId) ? relatedTaskId : undefined,
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
        {channel === "team" && <p className="recipient"><Users size={16} />{boss ? `Boss · ${boss.name} ช่วยตีความและเสนอแผนก่อนเริ่มงาน` : "เลือก Boss ในหน้าตั้งค่าสมาชิกก่อนให้ช่วยในห้องรวม"}</p>}
        <label>คุยต่อเกี่ยวกับงานนี้
          <Select value={relatedOptions.some((task) => task.id === relatedTaskId) ? relatedTaskId : noRecipientValue} onValueChange={(value) => setRelatedTasks((all) => ({ ...all, [draftKey]: value === noRecipientValue ? "" : value }))}>
            <SelectTrigger aria-label="คุยต่อเกี่ยวกับงานนี้"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={noRecipientValue}>บทสนทนาใหม่ / ยังไม่ระบุงาน</SelectItem>{relatedOptions.map((task) => <SelectItem key={task.id} value={task.id}>{task.title}</SelectItem>)}</SelectContent>
          </Select>
        </label>
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
            disabled={busy || images.length >= maxImages}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus size={18} /> แนบรูป
          </button>
          <span className="muted">
            PNG, JPEG, WebP · สูงสุด 4 รูป รูปละ 5 MiB
          </span>
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
