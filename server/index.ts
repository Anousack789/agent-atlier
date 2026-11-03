import next from "next";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { z } from "zod";
import { OfficeRuntime } from "./runtime";
import { Store } from "./store";
import * as validation from "../shared/validation";
import { maxBackupBytes } from "../shared/backup";
import { rolePresets, rolePresetsError } from "./role-presets";
import { readTaskFile } from "./task-files";
import { latestDelivery, readDeliveryFile } from "./workflow";
import { choosePath } from "./path-picker";

const port = Number(process.env.PORT || 3210);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("PORT must be between 1024 and 65535");
const origin = `http://127.0.0.1:${port}`;
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const allowedOrigins = new Set([origin, `http://localhost:${port}`]);
const dev = !process.argv.includes("--production");
const app = next({ dev, hostname: "127.0.0.1", port, webpack: dev });
const runtime = new OfficeRuntime(new Store(), origin);
const json = (res: ServerResponse, value: unknown, status = 200) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
};
async function body(req: IncomingMessage, limit = 256 * 1024) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new Error("ต้องส่ง application/json");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error(`ข้อมูลเกิน ${limit / 1024} KiB`);
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("ข้อมูล JSON ไม่ถูกต้องหรือไฟล์เสียหาย"); }
}
async function action(name: string, data: unknown) {
  switch (name) {
    case "path.choose":
      return choosePath();
    case "agent.save":
      return runtime.saveAgent(data);
    case "project.save":
      return runtime.saveProject(data);
    case "task.create":
      return runtime.createTask(data);
    case "task.confirm":
      return runtime.confirmPlan(data);
    case "intake.retry":
      return runtime.retryIntake(data);
    case "intake.manualPlan":
      return runtime.saveManualPlan(data);
    case "workflow.decide":
      return runtime.workflowDecision(data);
    case "task.plan": {
      const parsed = validation.revisePlanInput.parse(data);
      return runtime.preparePlan(parsed.id, parsed.body);
    }
    case "task.pause":
      return runtime.pauseTask(validation.entityIdInput.parse(data).id);
    case "task.resume":
      return runtime.resumeTask(data);
    case "task.stop":
      return runtime.stopTask(validation.entityIdInput.parse(data).id);
    case "task.delete":
      return runtime.deleteTask(validation.entityIdInput.parse(data).id);
    case "task.review":
      return runtime.reviewTask(data);
    case "task.merge": {
      const parsed = validation.repositoryActionInput.parse(data);
      return runtime.merge(parsed.id, parsed.repositoryId, parsed.version);
    }
    case "team.stop":
      return runtime.stopAll();
    case "team.resume":
      runtime.setPaused(false);
      runtime.tick();
      runtime.changed();
      return;
    case "message.send":
      return runtime.sendMessage(data);
    case "memory.save":
      return runtime.saveMemory(data);
    case "memory.delete":
      runtime.store.remove("memories", validation.entityIdInput.parse(data).id);
      runtime.changed();
      return;
    case "schedule.save":
      return runtime.saveSchedule(data);
    case "schedule.delete":
      runtime.store.remove(
        "schedules",
        validation.entityIdInput.parse(data).id,
      );
      runtime.changed();
      return;
    case "approval.decide":
      return runtime.decide(data);
    case "room.save":
      return runtime.saveRoom(data);
    case "codex.reconnect":
      return runtime.reconnect();
    case "git.initialize": {
      const parsed = validation.repositoryActionInput.parse(data);
      return runtime.requestGitInit(parsed.id, parsed.repositoryId);
    }
    case "google.configure": {
      const config = z
        .object({
          clientId: z.string().trim().endsWith(".apps.googleusercontent.com"),
          clientSecret: z.string().max(500).optional(),
        })
        .parse(data);
      runtime.google.configure(config.clientId, config.clientSecret);
      runtime.changed();
      return;
    }
    case "google.connect":
      return { url: await runtime.google.authorizationUrl() };
    case "google.disconnect":
      runtime.google.disconnect();
      runtime.changed();
      return;
    default:
      throw new Error("ไม่รองรับการทำงานนี้");
  }
}
await app.prepare();
const handler = app.getRequestHandler();
const server = createServer(async (req, res) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors 'none'; base-uri 'self'",
  );
  res.setHeader("Referrer-Policy", "same-origin");
  if (!req.headers.host || !allowedHosts.has(req.headers.host)) {
    json(res, { error: "Invalid host" }, 403);
    return;
  }
  if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) {
    json(res, { error: "Invalid origin" }, 403);
    return;
  }
  const url = new URL(req.url || "/", origin);
  if (!url.pathname.startsWith("/api/")) {
    await handler(req, res);
    return;
  }
  try {
    if (req.method === "GET" && url.pathname === "/api/task-file") {
      try {
        const id = z.string().uuid().parse(url.searchParams.get("id"));
        const path = z.string().min(1).max(4096).parse(url.searchParams.get("path"));
        const task = runtime.store.get("tasks", id);
        const revision = url.searchParams.has("revision") ? z.coerce.number().int().positive().parse(url.searchParams.get("revision")) : task?.stage ? latestDelivery(task)?.revision : undefined;
        const file = task && revision ? await readDeliveryFile(runtime.store.dir, task, revision, path) : await readTaskFile(task, path);
        const download = url.searchParams.get("download") === "1" || !file.preview;
        res.writeHead(200, {
          "Content-Type": download ? "application/octet-stream" : file.mime,
          "Content-Length": file.bytes.length,
          "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
          "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
        });
        res.end(file.bytes);
      } catch {
        json(res, { error: "ไม่พบหรือไม่อนุญาตให้เปิดไฟล์นี้ ไฟล์อาจถูกย้ายหรือลบ หรือพื้นที่ทำงานไม่พร้อมใช้งาน" }, 404);
      }
      return;
    }
    if (url.pathname.startsWith("/api/backup")) {
      if (!req.headers.origin || !allowedOrigins.has(req.headers.origin)) {
        json(res, { error: "Missing same-origin header" }, 403);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/backup/export") {
        const file = await runtime.backups.export();
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="agent-atelier-${new Date().toISOString().slice(0, 10)}.json"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(file);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/backup/preview") {
        json(
          res,
          await runtime.backups.inspect(await body(req, maxBackupBytes)),
        );
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/backup/import") {
        const token = z.string().uuid().parse(req.headers["x-backup-token"]);
        json(
          res,
          await runtime.backups.restore(await body(req, maxBackupBytes), token),
        );
        return;
      }
      json(res, { error: "Not found" }, 404);
      return;
    }
    const imageRoute = /^\/api\/messages\/([^/]+)\/images\/([^/]+)$/.exec(
      url.pathname,
    );
    if (req.method === "GET" && imageRoute) {
      const messageId = z.string().uuid().parse(imageRoute[1]);
      const imageId = z.string().uuid().parse(imageRoute[2]);
      const message = runtime.store.get("messages", messageId);
      const image = message?.images?.find((image) => image.id === imageId);
      if (!image) {
        json(res, { error: "ไม่พบรูปภาพ" }, 404);
        return;
      }
      let bytes: Buffer;
      try {
        bytes = await runtime.images.read(image);
      } catch {
        json(res, { error: "ไม่พบหรืออ่านรูปไม่ได้" }, 404);
        return;
      }
      res.writeHead(200, {
        "Content-Type": image.mime,
        "Content-Length": bytes.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      });
      res.end(bytes);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/messages") {
      if (!req.headers.origin || !allowedOrigins.has(req.headers.origin)) {
        json(res, { error: "Missing same-origin header" }, 403);
        return;
      }
      const input = await body(req, 28 * 1024 * 1024);
      const result = await runtime.withMutation(() =>
        runtime.sendMessage(input),
      );
      json(res, { ok: true, result });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/role-presets") {
      json(res, rolePresetsError ? { error: rolePresetsError } : { presets: rolePresets }, rolePresetsError ? 503 : 200);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      json(res, runtime.snapshot());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const send = (snapshot: unknown) => {
        if (!res.destroyed) res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      };
      send(runtime.snapshot());
      runtime.events.on("change", send);
      const heartbeat = setInterval(() => {
        if (!res.destroyed) res.write(": heartbeat\n\n");
      }, 20000);
      res.on("close", () => {
        clearInterval(heartbeat);
        runtime.events.off("change", send);
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/task-diff") {
      const id = z.string().uuid().parse(url.searchParams.get("id"));
      const repositoryId = validation.repositoryInput.shape.id.optional().parse(url.searchParams.get("repositoryId") ?? undefined);
      const task = runtime.store.get("tasks", id);
      json(res, {
        diff: await runtime.diff(id, repositoryId),
        version: task && (task.stage ? latestDelivery(task)?.repositories.find((r) => r.id === repositoryId)?.fingerprint : runtime.reviewOwner(task).reviewVersion),
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/google/callback") {
      if (url.searchParams.has("error"))
        throw new Error("Google ไม่ได้รับอนุญาตการเข้าถึง");
      await runtime.withMutation(() =>
        runtime.google.callback(
          z.string().min(1).parse(url.searchParams.get("code")),
          z.string().min(1).parse(url.searchParams.get("state")),
        ),
      );
      runtime.changed();
      res.writeHead(303, { Location: "/?google=connected" });
      res.end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/action") {
      // Browser writes must originate from our own UI, including on loopback.
      if (!req.headers.origin || !allowedOrigins.has(req.headers.origin)) {
        json(res, { error: "Missing same-origin header" }, 403);
        return;
      }
      const input = z
        .object({ action: z.string(), data: z.unknown().optional() })
        .parse(await body(req));
      const result = await runtime.withMutation(() =>
        action(input.action, input.data),
      );
      json(res, { ok: true, result });
      return;
    }
    json(res, { error: "Not found" }, 404);
  } catch (error) {
    json(
      res,
      {
        error:
          error instanceof z.ZodError
            ? error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("\n")
            : error instanceof Error
              ? error.message
              : "เกิดข้อผิดพลาด",
      },
      400,
    );
  }
});
server.requestTimeout = 60000;
server.on("upgrade", (req, socket, head) => {
  if (
    !req.headers.host ||
    !allowedHosts.has(req.headers.host) ||
    (req.headers.origin && !allowedOrigins.has(req.headers.origin))
  ) {
    socket.destroy();
    return;
  }
  app.getUpgradeHandler()(req, socket, head);
});
server.listen(port, "127.0.0.1", () => {
  console.log(`Agent Atelier: ${origin}`);
  void runtime.start();
});
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  server.closeAllConnections();
  await runtime.close();
  await app.close();
  process.exit(0);
}
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
