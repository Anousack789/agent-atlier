"use client";

import { useState } from "react";
import type { HandoffReference, Intake, Snapshot } from "../shared/types";
import { imageMimeTypes, maxImageBytes, maxImages, messageImageUrl } from "../shared/images";
import { taskFileLinks, taskFileUrl } from "../shared/task-files";
import { Dialog } from "./Dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export function ConversationHandoff({ state, projectId, destinationId, availableImages, close, attach, action }: {
  state: Snapshot;
  action: (name: string, data?: unknown) => Promise<unknown>;
  projectId: string;
  destinationId: string;
  availableImages: number;
  close: () => void;
  attach: (body: string, reference: HandoffReference, files: File[], artifacts: { path: string; revision?: number }[]) => boolean;
}) {
  const [source, setSource] = useState("");
  const [draftId, setDraftId] = useState("");
  const [requestingDraft, setRequestingDraft] = useState(false);
  const [summary, setSummary] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [selectedTextFiles, setSelectedTextFiles] = useState<string[]>([]);
  const [downloads, setDownloads] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const tasks = state.tasks.filter((task) => task.projectId === projectId && task.output.trim());
  const conversations = state.conversations.filter((item) => item.projectId === projectId && item.id !== destinationId);
  const task = tasks.find((item) => source === "task:" + item.id);
  const conversation = conversations.find((item) => source === "chat:" + item.id);
  const messages = conversation ? state.messages.filter((message) =>
    message.projectId === projectId && message.conversationId === conversation.id) : [];
  const title = task?.title || conversation?.title || "บทสนทนา";
  const excerpts = messages.filter((message) => selected.includes(message.id));
  const content = [summary.trim(), ...excerpts.map((message) => message.body)].filter(Boolean).join("\n\n");

  const delivery = task?.deliveries?.at(-1);
  const artifacts = task ? taskFileLinks(delivery?.output ?? task.output).map((path) => ({
    id: path,
    name: path.split("/").at(-1) || path,
    url: taskFileUrl(task.id, path, false, delivery?.revision),
  })) : [];
  const images = task ? artifacts.filter((file) => /\.(png|jpe?g|webp)$/i.test(file.name))
    : messages.flatMap((message) => (message.images || []).map((image) => ({
      id: image.id, name: image.name, url: messageImageUrl(message.id, image.id),
    })));
  const textFiles = artifacts.filter((file) => /\.(md|txt|csv|tsv)$/i.test(file.name));
  const filesToCopy = images.filter((image) => selectedImages.includes(image.id));
  const textToCopy = textFiles.filter((file) => selectedTextFiles.includes(file.id));
  const downloadFiles = artifacts.filter((file) => /\.(pdf|svg)$/i.test(file.name));
  const selectedDownloads = downloadFiles.filter((file) => downloads.includes(file.id));
  const draft = state.intakes.find((turn) => turn.id === draftId);
  const drafting = requestingDraft || (!!draftId && (!draft || ["queued", "running", "waiting", "pausing"].includes(draft.status)));
  const canAttach = !!source && (!!content || !!filesToCopy.length || !!textToCopy.length || !!selectedDownloads.length);

  return <Dialog title="อ้างอิงงานจากทีม" close={() => { if (!pending) close(); }} wide>
    <form className="form" onSubmit={async (event) => {
      event.preventDefault();
      if (pending || !canAttach || (!task && !conversation)) return;
      const reference: HandoffReference = task ? { kind: "task", id: task.id } : { kind: "conversation", id: conversation!.id };
      setPending(true);
      setError("");
      try {
        const files = await Promise.all(filesToCopy.map(async (image) => {
          const response = await fetch(image.url);
          if (!response.ok) throw new Error("คัดลอกรูป " + image.name + " ไม่ได้");
          if (Number(response.headers.get("Content-Length")) > maxImageBytes)
            throw new Error("รูปเกิน 5 MiB: " + image.name);
          const blob = await response.blob();
          if (!blob.size || blob.size > maxImageBytes || !imageMimeTypes.some((mime) => mime === blob.type))
            throw new Error("รองรับ PNG, JPEG และ WebP ขนาดไม่เกิน 5 MiB: " + image.name);
          return new File([blob], image.name, { type: blob.type });
        }));
        const textSnapshots: string[] = [];
        let remaining = 16000 - content.length;
        for (const file of textToCopy) {
          const response = await fetch(file.url);
          if (!response.ok || !response.headers.get("Content-Type")?.startsWith("text/plain"))
            throw new Error("อ่านไฟล์ " + file.name + " ไม่ได้");
          const length = Number(response.headers.get("Content-Length"));
          if (!length || length > remaining * 4)
            throw new Error("ไฟล์ยาวเกินพื้นที่ที่เหลือในข้อความ: " + file.name);
          const bytes = await response.arrayBuffer();
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          const snapshot = "ไฟล์ " + file.name + "\n" + text;
          remaining -= snapshot.length + 2;
          if (remaining < 0) throw new Error("ไฟล์ยาวเกินพื้นที่ที่เหลือในข้อความ: " + file.name);
          textSnapshots.push(snapshot);
        }
        if (attach([`อ้างอิงจาก ${title}`, content, ...textSnapshots].filter(Boolean).join("\n\n"), reference, files, selectedDownloads.map((file) => ({ path: file.id, revision: delivery?.revision })))) close();
        else setError(`แนบไม่ได้ ข้อความรวมต้องไม่เกิน 16,000 ตัวอักษร และรูปไม่เกิน ${maxImages} รูป`);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setPending(false);
      }
    }}>
      <Select disabled={pending || drafting} value={source} onValueChange={(value) => {
        setSource(value);
        setDraftId("");
        setSelected([]);
        setSelectedImages([]);
        setSelectedTextFiles([]);
        setDownloads([]);
        setError("");
        setSummary(tasks.find((item) => value === "task:" + item.id)?.output || "");
      }}>
        <SelectTrigger aria-label="แหล่งอ้างอิง"><SelectValue placeholder="เลือกงานหรือบทสนทนา" /></SelectTrigger>
        <SelectContent>
          {tasks.map((item) => <SelectItem key={item.id} value={"task:" + item.id}>งาน · {item.title}</SelectItem>)}
          {conversations.map((item) => <SelectItem key={item.id} value={"chat:" + item.id}>แชต · {item.title || "บทสนทนาใหม่"}</SelectItem>)}
        </SelectContent>
      </Select>
      {source && <label>สรุปสำหรับส่งต่อ<textarea disabled={pending} value={summary} maxLength={16000} rows={4}
        onChange={(event) => setSummary(event.target.value)} /></label>}
      {messages.some((message) => message.body.trim()) && <fieldset disabled={pending} className="max-h-52 overflow-auto">
        <legend>ข้อความที่จะส่งต่อ</legend>
        {messages.filter((message) => message.body.trim()).map((message) => <label key={message.id} className="flex items-start gap-2">
          <input type="checkbox" checked={selected.includes(message.id)} onChange={(event) => {
            const checked = event.target.checked;
            setSelected((all) => checked ? [...all, message.id] : all.filter((id) => id !== message.id));
          }} />
          <span className="whitespace-pre-wrap break-all">{message.body}</span>
        </label>)}
      </fieldset>}
      {!!images.length && <fieldset disabled={pending} className="max-h-52 overflow-auto">
        <legend>รูปที่จะส่งต่อ (เลือกได้อีก {availableImages} รูป)</legend>
        {images.map((image) => <label key={image.id} className="flex items-center gap-2">
          <input type="checkbox" checked={selectedImages.includes(image.id)}
            disabled={!selectedImages.includes(image.id) && selectedImages.length >= availableImages}
            onChange={(event) => {
              const checked = event.target.checked;
              setSelectedImages((all) => checked ? [...all, image.id] : all.filter((id) => id !== image.id));
            }} />
          <img src={image.url} alt="" loading="lazy" className="size-12 object-contain" />
          <span>{image.name}</span>
        </label>)}
      </fieldset>}
      {!!textFiles.length && <fieldset disabled={pending} className="max-h-40 overflow-auto">
        <legend>ไฟล์ข้อความที่จะคัดลอกลงแชต</legend>
        {textFiles.map((file) => <label key={file.id} className="flex items-center gap-2">
          <input type="checkbox" checked={selectedTextFiles.includes(file.id)} onChange={(event) => {
            const checked = event.target.checked;
            setSelectedTextFiles((all) => checked ? [...all, file.id] : all.filter((id) => id !== file.id));
          }} />
          <span className="break-all">{file.name}</span>
        </label>)}
      </fieldset>}
      {!!downloadFiles.length && <fieldset disabled={pending} className="max-h-40 overflow-auto">
        <legend>ไฟล์ดาวน์โหลด (สูงสุด 2 ไฟล์ ไฟล์ละ 1 MiB)</legend>
        {downloadFiles.map((file) => <label key={file.id} className="flex items-center gap-2">
          <input type="checkbox" checked={downloads.includes(file.id)} disabled={!downloads.includes(file.id) && downloads.length >= 2}
            onChange={(event) => {
              const checked = event.target.checked;
              setDownloads((all) => checked ? [...all, file.id] : all.filter((id) => id !== file.id));
            }} />
          <span className="break-all">{file.name}</span>
        </label>)}
      </fieldset>}
      {source && <button type="button" disabled={pending || drafting || !content || content.length > 16000} onClick={async () => {
        setRequestingDraft(true);
        setDraftId("");
        setError("");
        try {
          const turn = await action("conversation.draftHandoff", { id: destinationId, text: content }) as Intake;
          setDraftId(turn.id);
        } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        finally { setRequestingDraft(false); }
      }}>{drafting ? "กำลังร่างสรุป…" : "ให้สมาชิกช่วยร่างสรุป"}</button>}
      {draft?.status === "completed" && <div>
        <p className="whitespace-pre-wrap break-words">{draft.output}</p>
        <button type="button" onClick={() => { setSummary(draft.output); setDraftId(""); }}>ใช้ร่างนี้</button>
      </div>}
      {draft && !drafting && draft.status !== "completed" && <p role="alert">{draft.error || "ร่างสรุปถูกขัดจังหวะ"}</p>}
      <p className="muted">ตรวจข้อความและรูปในช่องแชตก่อนกดส่ง</p>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={pending || !canAttach}>{pending ? "กำลังคัดลอกไฟล์" : "แนบในแชต"}</button>
    </form>
  </Dialog>;
}
