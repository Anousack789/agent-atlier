"use client";
import { useState } from "react";
import { taskFileLinks, taskFileUrl } from "../shared/task-files";
import type { Task } from "../shared/types";
import type { Delivery } from "../shared/workflow";

function FilePreview({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <p role="status" className="inline-error">ไม่พบหรือแสดงรูป {name} ไม่ได้ ไฟล์อาจถูกย้ายหรือลบแล้ว</p> : (
    <a href={url} target="_blank" rel="noreferrer" aria-label={`เปิดรูป ${name}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={name} loading="lazy" onError={() => setFailed(true)} className="max-h-96 max-w-full rounded-lg object-contain" />
    </a>
  );
}

export function TaskFiles({ taskId, output, revision }: { taskId: string; output: string; revision?: number }) {
  const paths = taskFileLinks(output);
  if (!paths.length) return null;
  return <section aria-label="ไฟล์ผลงาน" className="mt-4 grid min-w-0 gap-4">
    <h3>ไฟล์ผลงาน</h3>
    {paths.map((path) => {
      const name = path.split("/").at(-1) || path;
      const url = taskFileUrl(taskId, path, false, revision);
      const image = /\.(png|jpe?g|webp|gif|avif)$/i.test(path);
      return <div key={path} className="grid min-w-0 gap-2 rounded-lg border border-gray-200 p-3">
        <span className="break-all">{name}</span>
        {image && <FilePreview key={url} url={url} name={name} />}
        <div className="flex flex-wrap gap-4">
          {(image || /\.(md|txt|csv|tsv)$/i.test(path)) && <a href={url} target="_blank" rel="noreferrer" className="underline">ดูตัวอย่าง <span className="sr-only">{name}</span></a>}
          <a href={taskFileUrl(taskId, path, true, revision)} download={name} className="underline">ดาวน์โหลด <span className="sr-only">{name}</span></a>
        </div>
      </div>;
    })}
  </section>;
}

export function HumanReviewEvidence({ delivery }: { delivery: Delivery }) {
  if (!delivery.humanReview) return null;
  return <ul aria-label={`ผลตรวจของผู้ใช้ · v${delivery.revision}`} className="list-disc break-words pl-5">
    {delivery.humanReview.checks.map((check) => <li key={check.criterion}>
      <strong>{check.outcome === "verified" ? "ผู้ใช้ตรวจยืนยันแล้ว" : "ผู้ใช้ยอมรับความเสี่ยง"}</strong> · {check.criterion}
      <p className="whitespace-pre-wrap">{check.evidence}</p>
    </li>)}
  </ul>;
}

export function SummarySources({ delivery, tasks }: { delivery: Delivery; tasks: Task[] }) {
  const sources = delivery.prerequisites.flatMap(({ taskId, revision }) => {
    const task = tasks.find((task) => task.id === taskId);
    const version = task?.deliveries?.find((item) => item.revision === revision);
    return task && version && (version.files.length || version.humanReview || task.worktrees?.length) ? [{ task, version }] : [];
  });
  if (!sources.length) return null;
  return <section aria-label="หลักฐานต้นทาง" className="mt-3 grid min-w-0 gap-3">
    <h5>หลักฐานต้นทาง</h5>
    {sources.map(({ task, version }) => <div key={task.id} className="break-words">
      <strong>{task.title} · v{version.revision}</strong>
      {!!version.files.length && <ul className="list-disc pl-5">
        {version.files.map(({ path }) => <li key={path}>
          <a className="break-all underline" href={taskFileUrl(task.id, path, false, version.revision)} target="_blank" rel="noreferrer">{path.split("/").at(-1)}</a>
        </li>)}
      </ul>}
      {!!task.worktrees?.length && <ul aria-label="สถานะ merge ล่าสุด" className="list-disc pl-5">
        {task.worktrees.map((tree) => <li key={tree.id}>{tree.name} · {tree.mergedAt ? "รวมแล้ว" : "ยังไม่บันทึกการ merge"}</li>)}
      </ul>}
      <HumanReviewEvidence delivery={version} />
    </div>)}
  </section>;
}
