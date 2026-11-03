"use client";
import { useState } from "react";
import { taskFileLinks, taskFileUrl } from "../shared/task-files";

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
