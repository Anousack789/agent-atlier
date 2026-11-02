"use client";
import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { maxBackupBytes, type BackupKind, type BackupPreview } from "../shared/backup";
import type { Snapshot } from "../shared/types";
import { busyStatuses } from "../shared/types";
import { Dialog } from "./Dialog";

const labels: Record<BackupKind, string> = {
  agents: "สมาชิก", projects: "โปรเจกต์", tasks: "งาน", messages: "ข้อความ",
  memories: "ความทรงจำ", schedules: "ตารางงาน", approvals: "ประวัติการอนุมัติ",
};
export function Backups({ state, restored }: { state: Snapshot; restored: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [preview, setPreview] = useState<BackupPreview>();
  const fileText = useRef("");
  const pending = useRef(false);
  const unavailable = state.tasks.some((t) => busyStatuses.includes(t.status)) ||
    state.approvals.some((a) => a.status === "executing");
  const run = async (fn: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setResult("");
    try { await fn(); }
    catch (error) { setError(error instanceof Error ? error.message : "เชื่อมต่อไม่ได้"); }
    finally { pending.current = false; setBusy(false); }
  };
  const request = async (path: string, text?: string, token?: string) => {
    const response = await fetch(`/api/backup/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "X-Backup-Token": token } : {}) },
      body: text,
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "ดำเนินการไม่สำเร็จ");
    }
    return response;
  };
  return (
    <section className="panel backup-panel" aria-busy={busy}>
      <div className="section-heading"><h2>สำรองข้อมูล office</h2></div>
      <p>สำรองห้อง สมาชิก โปรเจกต์ งาน แชตพร้อมรูป ความทรงจำ ตารางงาน และประวัติการอนุมัติ เป็นไฟล์ JSON สูงสุด 100 MiB</p>
      <p className="note">ไม่รวมไฟล์โค้ด Git/worktree, Codex login หรือ Google credentials ไฟล์มีข้อความและความทรงจำส่วนตัว โปรดเก็บไว้ในที่ปลอดภัย</p>
      {unavailable && <p className="note">รอให้งานและการดำเนินการจบ หรือกดหยุดทั้งทีมก่อนสำรอง/นำเข้าข้อมูล</p>}
      <div className="backup-actions">
        <button disabled={busy || unavailable} onClick={() => void run(async () => {
          const response = await request("export");
          const blob = await response.blob();
          if (blob.size > maxBackupBytes) throw new Error("ไฟล์สำรองเกิน 100 MiB");
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url; link.download = `agent-atelier-${new Date().toISOString().slice(0, 10)}.json`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          setResult("ส่งไฟล์สำรองให้ browser ดาวน์โหลดแล้ว");
        })}><Download size={17} />Export office</button>
        <label className="backup-file">
          <span><Upload size={17} />เลือกไฟล์เพื่อนำเข้า office</span>
          <input type="file" accept=".json,application/json" disabled={busy || unavailable}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void run(async () => {
                setPreview(undefined); fileText.current = "";
                if (file.size > maxBackupBytes) throw new Error("ไฟล์สำรองเกิน 100 MiB");
                const text = await file.text();
                const response = await request("preview", text);
                const data: BackupPreview = await response.json();
                fileText.current = text; setPreview(data);
              });
            }} />
        </label>
      </div>
      <div role="status" aria-live="polite">{busy ? "กำลังดำเนินการ…" : result}</div>
      {error && <p role="alert" className="inline-error">{error}</p>}
      {preview && <Dialog title="ตรวจไฟล์ก่อนแทนที่ office" close={() => {
        if (!pending.current) { setPreview(undefined); fileText.current = ""; }
      }}>
        <p>สำรองเมื่อ {new Date(preview.exportedAt).toLocaleString("th-TH", { timeZone: "Asia/Vientiane" })}</p>
        <dl className="backup-counts">
          {(Object.keys(labels) as BackupKind[]).map((kind) => <div key={kind}><dt>{labels[kind]}</dt><dd>{preview.counts[kind]}</dd></div>)}
          <div><dt>รูปในแชต</dt><dd>{preview.imageCount}</dd></div>
        </dl>
        {preview.missingPaths.length > 0 && <>
          <p className="note">หาโฟลเดอร์เหล่านี้ไม่พบ ต้องแก้ path ในหน้าโปรเจกต์หลังนำเข้า:</p>
          <ul>{preview.missingPaths.map((project) => <li key={project.path + project.name}>{project.name}: <span className="file-path">{project.path}</span></li>)}</ul>
        </>}
        <p className="note">ข้อมูล office ปัจจุบันจะถูกแทนที่ทั้งหมด ระบบจะเก็บไฟล์สำรองเดิมก่อนนำเข้า หากสำรองไม่สำเร็จจะไม่แทนที่ข้อมูล</p>
        <p>งานค้างจะเป็น interrupted ตารางงานจะปิด ทีมจะพัก และคำขออนุมัติที่ค้างจะหมดอายุ งานโค้ดที่นำเข้าใช้อ่านประวัติได้ แต่กด merge ไม่ได้ เพราะไม่มีไฟล์ worktree</p>
        <p>การเชื่อม Google ของเครื่องนี้ยังคงเดิม แต่สิทธิ์ Google ของสมาชิกที่นำเข้าจะปิดไว้ ไม่รวมไฟล์โปรเจกต์หรือข้อมูล login ในไฟล์สำรอง</p>
        <div className="form-actions">
          <button disabled={busy} onClick={() => { setPreview(undefined); fileText.current = ""; }}>ยกเลิก</button>
          <button className="primary" disabled={busy || unavailable} onClick={() => void run(async () => {
            try {
              const response = await request("import", fileText.current, preview.token);
              const data: { backupPath: string } = await response.json();
              restored();
              setResult(`นำเข้าแล้ว ทีมกำลังพัก ไฟล์สำรองก่อนนำเข้า: ${data.backupPath}`);
            } finally {
              setPreview(undefined); fileText.current = "";
            }
          })}>ยืนยันแทนที่ office</button>
        </div>
      </Dialog>}
    </section>
  );
}
