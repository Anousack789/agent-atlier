import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Task } from "../shared/types";
import { taskFileLinks } from "../shared/task-files";

const imageTypes: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif",
};
const allowedExtensions = new Set([
  ...Object.keys(imageTypes), ".svg", ".pdf", ".md", ".txt", ".csv", ".tsv",
  ".figcraft", ".fig", ".docx", ".xlsx", ".pptx", ".zip", ".html",
]);
const textExtensions = new Set([".md", ".txt", ".csv", ".tsv"]);
const maxFileBytes = 50 * 1024 * 1024;

export async function readTaskFile(task: Task | undefined, path: string) {
  if (!task?.workspace || !taskFileLinks(task.output).includes(path))
    throw new Error("ไม่พบไฟล์ที่อ้างอิงในผลงาน หรือพื้นที่ทำงานไม่พร้อมใช้งาน");
  const workspace = resolve(task.workspace);
  const local = relative(workspace, resolve(workspace, path));
  const parts = local.split(sep);
  const extension = extname(local).toLowerCase();
  if (!local || isAbsolute(local) || parts.some((part) =>
    part.startsWith(".") || /(?:credential|secret|token|password|id_rsa|id_ed25519)/i.test(part),
  ) || !allowedExtensions.has(extension))
    throw new Error("ไม่อนุญาตให้เปิดไฟล์นี้");
  const root = await realpath(workspace);
  let filePath = root;
  for (const part of parts) {
    filePath = resolve(filePath, part);
    if ((await lstat(filePath)).isSymbolicLink()) throw new Error("ไม่อนุญาต symbolic link");
  }
  const canonical = await realpath(filePath);
  if (canonical !== filePath || !canonical.startsWith(root + sep))
    throw new Error("ไฟล์อยู่นอกพื้นที่ทำงาน");
  const file = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxFileBytes) throw new Error("ไฟล์ต้องมีขนาดไม่เกิน 50 MiB");
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error("ไฟล์เปลี่ยนระหว่างอ่าน กรุณาลองใหม่");
      offset += bytesRead;
    }
    return {
      bytes, name: basename(local),
      mime: imageTypes[extension] || (textExtensions.has(extension) ? "text/plain; charset=utf-8" : "application/octet-stream"),
      preview: !!imageTypes[extension] || textExtensions.has(extension),
    };
  } finally { await file.close(); }
}
