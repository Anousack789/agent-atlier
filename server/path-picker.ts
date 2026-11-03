import childProcess from "node:child_process";
import os from "node:os";
import { isAbsolute } from "node:path";

const script = `with timeout of 300 seconds
  try
    return POSIX path of (choose folder with prompt "เลือกโฟลเดอร์")
  on error number -128
    return ""
  end try
end timeout`;
let choosing = false;

export async function choosePath(): Promise<{ path: string | null }> {
  if (os.platform() !== "darwin")
    throw new Error("เลือกโฟลเดอร์อัตโนมัติรองรับเฉพาะ macOS กรุณาพิมพ์ path เอง");
  if (choosing) throw new Error("มีหน้าต่างเลือกโฟลเดอร์เปิดอยู่ กรุณาเลือกหรือยกเลิกหน้าต่างเดิมก่อน");
  choosing = true;
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      childProcess.execFile("/usr/bin/osascript", ["-e", script], {
        encoding: "utf8", timeout: 310000, maxBuffer: 64 * 1024,
      }, (error, stdout) => error ? reject(error) : resolve(stdout));
    });
    const path = stdout.replace(/\r?\n$/, "");
    if (path && !isAbsolute(path)) throw new Error("Invalid folder path");
    return { path: path || null };
  } catch (cause) {
    throw new Error("เปิดหน้าต่างเลือกโฟลเดอร์ไม่สำเร็จ กรุณาลองใหม่หรือพิมพ์ path เอง", { cause });
  } finally {
    choosing = false;
  }
}
