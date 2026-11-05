"use client";

import { useEffect, useMemo, useState } from "react";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import { canRecoverTaskCode } from "../shared/workflow";
import { Dialog } from "./Dialog";
import { conversationWorktrees } from "../shared/types";
import { useOffice } from "./useOffice";

type DiffResult = { diff: string; patch: string; files: { path: string; content: string }[]; version?: string };

export function DiffPage() {
  const { state, action } = useOffice();
  const [query, setQuery] = useState<URLSearchParams>();
  const [result, setResult] = useState<DiffResult>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [abandoned, setAbandoned] = useState(false);
  const [merged, setMerged] = useState(false);
  const [view, setView] = useState<"unified" | "split">("unified");
  const [reload, setReload] = useState(0);
  useEffect(() => { setQuery(new URLSearchParams(window.location.search)); }, []);
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    setLoading(true); setError(""); setResult(undefined);
    const endpoint = query.has("conversationId") ? "/api/conversation-diff" : "/api/task-diff";
    fetch(`${endpoint}?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "โหลด diff ไม่สำเร็จ");
        setResult(data);
      })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "โหลด diff ไม่สำเร็จ"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, reload]);
  const parsed = useMemo(() => {
    if (!result?.patch) return [];
    try {
      const files = parseDiff(result.patch);
      return files.length ? files : null;
    } catch { return null; }
  }, [result]);
  const task = state?.tasks.find((item) => item.id === query?.get("id"));
  const conversation = state?.conversations.find((item) => item.id === query?.get("conversationId"));
  const parent = state?.tasks.find((item) => item.id === task?.parentTaskId);
  const repositoryId = query?.get("repositoryId");
  const chatTrees = conversationWorktrees(conversation);
  const tree = conversation ? (repositoryId ? chatTrees.find((item) => item.id === repositoryId) : chatTrees[0])
    : task?.worktrees?.find((item) => item.id === repositoryId);
  const change = tree || task;
  const recovery = query?.get("recovery") === "true";
  const deliveryReview = query?.has("deliveryFingerprint");
  const owner = parent || task;
  const eligible = conversation ? !!tree && !tree.mergedAt && !!(result?.patch || result?.files.length) : !!task && (recovery ? canRecoverTaskCode(task, parent) :
    ["completed", "accepted", "reviewing"].includes(task.status) && (task.stage ? parent?.workflow?.phase === "accepted" : !owner?.reviewVersion || owner.status === "accepted"));
  const versionMatches = conversation ? !!result?.version : recovery ? !!result?.version : task?.stage ? !!result?.version : !owner?.reviewVersion || result?.version === owner.reviewVersion;
  const merge = async () => {
    if ((!task && !conversation) || !result) return;
    setBusy(true); setError("");
    try {
      if (conversation) await action("conversation.merge", { id: conversation.id, repositoryId: tree?.id, version: result.version });
      else if (task) await action("task.merge", { id: task.id, repositoryId: tree?.id, version: result.version, recovery: recovery || undefined });
      setMerged(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "รวมโค้ดไม่ได้");
      if (recovery || conversation) setResult(undefined);
    } finally { setBusy(false); }
  };
  const abandon = async () => {
    if (!conversation || !result?.version || busy) return;
    setBusy(true);
    setError("");
    try {
      await action("conversation.abandon", { id: conversation.id, repositoryId: tree?.id, version: result.version });
      setAbandoned(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "ยกเลิกรอบไม่ได้");
    } finally {
      setConfirmAbandon(false);
      setBusy(false);
      setResult(undefined);
    }
  };
  return <main className="diff-page">
    <a href="/">← กลับไป Agent Atelier</a>
    <header className="space-y-2">
      <h1>ตรวจ Git diff · {tree?.name || task?.title || "Repository"}</h1>
      {(task || conversation) && <p>{task?.title || conversation?.title}</p>}
      {change && <p className="break-all"><code>{change.branch}</code> → <code>{change.baseBranch}</code></p>}
      {tree?.path && <p className="muted break-all">Repo ปลายทาง: {tree.path}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setReload((value) => value + 1)} disabled={loading || busy}>อัปเดต diff</button>
        <button type="button" aria-pressed={view === "unified"} onClick={() => setView("unified")}>Unified</button>
        <button type="button" aria-pressed={view === "split"} onClick={() => setView("split")}>Split</button>
      </div>
    </header>
    {abandoned && <p role="status">ยกเลิกรอบแล้ว เก็บ branch และไฟล์ไว้ใน worktree เดิม</p>}
    {confirmAbandon && tree && <Dialog title="ยืนยันการยกเลิกรอบ" close={() => { if (!busy) setConfirmAbandon(false); }}>
      <p>เก็บการเปลี่ยนแปลงที่แสดงใน diff ไว้ใน branch <code>{tree.branch}</code></p>
      <p className="break-all">ตำแหน่งไฟล์ · {tree.workspace}</p>
      <button type="button" disabled={busy} onClick={() => void abandon()}>ยืนยันและเก็บไฟล์ไว้</button>
    </Dialog>}
    {loading && <p role="status">กำลังโหลด diff…</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
    {result && <>
      {!result.patch && !result.files.length && <p>ไม่มีการเปลี่ยนแปลง</p>}
      {parsed === null ? <section><h2>Git diff</h2><p>แสดง raw diff เนื่องจากอ่านรูปแบบ diff ไม่ได้</p><pre className="diff-raw" tabIndex={0}>{result.patch}</pre></section> : parsed.map((file, index) => <section className="diff-file" key={`${file.oldPath}:${file.newPath}:${index}`}>
        <h2 className="break-all">{file.oldPath !== file.newPath ? `${file.oldPath} → ${file.newPath}` : file.newPath}</h2>
        {file.hunks.length ? <div className="diff-scroll" tabIndex={0} aria-label={`Diff ${file.newPath}`}><Diff viewType={view} diffType={file.type} hunks={file.hunks}>{(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}</Diff></div> : <pre className="diff-raw">{file.isBinary ? "ไฟล์ binary เปลี่ยนแปลง — กรุณาตรวจใน worktree" : "ข้อมูลไฟล์เปลี่ยนแปลง — กรุณาตรวจ raw diff"}</pre>}
      </section>)}
      {result.patch && <details><summary>ดู raw Git diff</summary><pre className="diff-raw" tabIndex={0}>{result.patch}</pre></details>}
      {result.files.map((file) => <section className="diff-file" key={file.path}><h2 className="break-all">{file.path} · ไฟล์ใหม่</h2><pre className="diff-raw" tabIndex={0}>{file.content}</pre></section>)}
      {!deliveryReview && (task || conversation) && change && <section className="diff-approval space-y-2">
        {change.mergedAt || merged ? <p>รวมงานแล้ว {change.mergedAt && new Date(change.mergedAt).toLocaleString("th-TH")}</p> : <>
          <p>{recovery ? "ตรวจ diff ก่อนกู้โค้ด แอปจะ commit งานค้างใน worktree และ merge เข้า branch ปลายทาง" : "ตรวจ diff และผลทดสอบก่อนรวม แอปจะ commit ผลงานใน worktree และ merge กลับ branch เดิม โดยไม่ push"}</p>
          {!eligible ? <p className="note">สถานะงานยังไม่รองรับการ merge หรือต้องตรวจรับงานก่อน</p> : !versionMatches ? <p className="note">diff เปลี่ยนจากฉบับที่ตรวจรับ กรุณาตรวจใหม่</p> : null}
          {conversation && result.version && <button type="button" disabled={busy} onClick={() => setConfirmAbandon(true)}>ยกเลิกรอบและเก็บไฟล์</button>}
          <button type="button" className="primary" disabled={busy || !eligible || !versionMatches} onClick={() => void merge()}>{recovery ? "อนุมัติ merge โค้ดจากงานที่หยุด" : "อนุมัติ merge repository"}</button>
        </>}
      </section>}
    </>}
  </main>;
}
