import { randomUUID } from "node:crypto";
import { constants, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { open, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { ImageUpload, MessageImage } from "../shared/images";
import { maxImageBytes } from "../shared/images";
import type { Message } from "../shared/types";

const formats = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
} as const;
const ownedFile =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpeg|webp)$/;

function animatedPng(bytes: Buffer) {
  // libvips can decode only the first frame of APNG without reporting pages.
  for (
    let offset = 8;
    offset + 12 <= bytes.length;
    offset += bytes.readUInt32BE(offset) + 12
  )
    if (bytes.toString("ascii", offset + 4, offset + 8) === "acTL") return true;
  return false;
}

export class Images {
  readonly dir: string;
  constructor(dataDir: string, messages: Message[]) {
    this.dir = join(dataDir, "attachments");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const referenced = new Set(
      messages.flatMap((m) => (m.images || []).map((i) => this.filename(i))),
    );
    // Only this feature's UUID files are eligible for crash cleanup.
    for (const entry of readdirSync(this.dir, { withFileTypes: true }))
      if (
        entry.isFile() &&
        ownedFile.test(entry.name) &&
        !referenced.has(entry.name)
      )
        unlinkSync(join(this.dir, entry.name));
  }
  private filename(image: MessageImage) {
    return `${z.string().uuid().parse(image.id)}.${formats[image.mime]}`;
  }
  path(image: MessageImage) {
    return join(this.dir, this.filename(image));
  }
  async read(image: MessageImage) {
    const file = await open(
      this.path(image),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > maxImageBytes)
        throw new Error("ไฟล์รูปไม่ถูกต้อง");
      return await file.readFile();
    } finally {
      await file.close();
    }
  }
  async save(input: ImageUpload): Promise<MessageImage> {
    const bytes = Buffer.from(input.base64, "base64");
    if (
      !bytes.length ||
      bytes.length > maxImageBytes ||
      bytes.toString("base64") !== input.base64
    )
      throw new Error("ข้อมูลรูปไม่ถูกต้องหรือขนาดเกิน 5 MiB");
    try {
      const decoder = sharp(bytes, {
        animated: true,
        limitInputPixels: 20_000_000,
        failOn: "warning",
      });
      const meta = await decoder.metadata();
      if (
        meta.format !== formats[input.mime] ||
        (meta.pages || 1) !== 1 ||
        (meta.format === "png" && animatedPng(bytes))
      )
        throw new Error(
          "รองรับเฉพาะ PNG, JPEG และ WebP แบบภาพนิ่งที่ตรงกับชนิดไฟล์",
        );
      const { data, info } = await decoder
        .rotate()
        .toFormat(formats[input.mime])
        .toBuffer({ resolveWithObject: true });
      if (data.length > maxImageBytes)
        throw new Error("รูปหลังประมวลผลมีขนาดเกิน 5 MiB");
      const image: MessageImage = {
        id: randomUUID(),
        name: input.name,
        mime: input.mime,
        size: data.length,
        width: info.width,
        height: info.height,
      };
      try {
        await writeFile(this.path(image), data, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST")
          await unlink(this.path(image)).catch(() => {});
        throw error;
      }
      return image;
    } catch (error) {
      throw new Error(
        `อ่านรูป ${input.name} ไม่ได้: ${error instanceof Error ? error.message : "ข้อมูลรูปไม่ถูกต้อง"}`,
      );
    }
  }
  async remove(images: MessageImage[]) {
    await Promise.all(
      images.map((image) =>
        unlink(this.path(image)).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        }),
      ),
    );
  }
}
