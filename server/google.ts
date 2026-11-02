import { google } from "googleapis";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Store } from "./store";
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
type Credentials = OAuth2Client["credentials"];

const email = z.string().email().max(254);
export const emailProposal = z.object({
  to: z.array(email).min(1).max(20),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .refine((s) => !/[\r\n]/.test(s)),
  body: z.string().min(1).max(50000),
  threadId: z.string().max(200).optional(),
});
const timestamp = z.string().datetime({ offset: true });
export const eventProposal = z
  .object({
    eventId: z.string().max(200).optional(),
    summary: z.string().trim().min(1).max(300),
    start: timestamp,
    end: timestamp,
    timezone: z.string().default("Asia/Vientiane"),
    attendees: z.array(email).max(30).default([]),
  })
  .refine(
    (v) => Date.parse(v.end) > Date.parse(v.start),
    "เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม",
  )
  .refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v.timezone });
      return true;
    } catch {
      return false;
    }
  }, "เขตเวลาไม่ถูกต้อง");

export class GoogleConnection {
  private auth?: OAuth2Client;
  private pending = new Map<string, { verifier: string; created: number }>();
  private credentials: Credentials & { email?: string } = {};
  private tokenPath: string;
  private generation = 0;
  constructor(
    private store: Store,
    private origin: string,
  ) {
    this.tokenPath = join(store.dir, "google-tokens.json");
    if (existsSync(this.tokenPath)) {
      try {
        this.credentials = JSON.parse(readFileSync(this.tokenPath, "utf8"));
      } catch {
        this.credentials = {};
      }
    }
  }
  status() {
    const settings = this.store.get("settings", "settings");
    return {
      connected: Boolean(
        this.credentials.refresh_token || this.credentials.access_token,
      ),
      email: this.credentials.email,
      configured: Boolean(settings?.googleClientId),
      clientId: settings?.googleClientId || "",
    };
  }
  configure(clientId: string, clientSecret?: string) {
    const old = this.store.get("settings", "settings");
    if (
      old?.googleClientId !== clientId ||
      (clientSecret && old?.googleClientSecret !== clientSecret)
    )
      this.disconnect();
    this.store.put("settings", {
      ...old,
      id: "settings",
      googleClientId: clientId,
      googleClientSecret: clientSecret || old?.googleClientSecret || "",
    });
    this.auth = undefined;
  }
  private client() {
    if (this.auth) return this.auth;
    const config = this.store.get("settings", "settings");
    if (!config?.googleClientId)
      throw new Error("โปรดตั้งค่า Google OAuth Client ก่อน");
    const auth = new google.auth.OAuth2(
      config.googleClientId,
      config.googleClientSecret,
      `${this.origin}/api/google/callback`,
    );
    auth.setCredentials(this.credentials);
    const generation = this.generation;
    auth.on("tokens", (tokens) => {
      if (this.auth === auth && generation === this.generation) {
        this.credentials = { ...this.credentials, ...tokens };
        this.save();
      }
    });
    this.auth = auth;
    return auth;
  }
  private save() {
    const temp = this.tokenPath + ".tmp";
    writeFileSync(temp, JSON.stringify(this.credentials), { mode: 0o600 });
    renameSync(temp, this.tokenPath);
  }
  async authorizationUrl() {
    const auth = this.client();
    const { codeVerifier, codeChallenge } =
      await auth.generateCodeVerifierAsync();
    const state = randomBytes(24).toString("hex");
    for (const [key, value] of this.pending)
      if (Date.now() - value.created > 600000) this.pending.delete(key);
    this.pending.set(state, { verifier: codeVerifier, created: Date.now() });
    return auth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256" as any,
      scope: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/calendar.events.readonly",
        "https://www.googleapis.com/auth/calendar.events.owned",
      ],
    });
  }
  async callback(code: string, state: string) {
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || Date.now() - pending.created > 600000)
      throw new Error(
        "การเชื่อมต่อหมดอายุหรือ state ไม่ถูกต้อง โปรดลองอีกครั้ง",
      );
    const config = this.store.get("settings", "settings")!;
    const auth = new google.auth.OAuth2(
      config.googleClientId,
      config.googleClientSecret,
      `${this.origin}/api/google/callback`,
    );
    const generation = this.generation;
    const { tokens } = await auth.getToken({
      code,
      codeVerifier: pending.verifier,
    });
    auth.setCredentials(tokens);
    const profile = await google
      .gmail({ version: "v1", auth })
      .users.getProfile({ userId: "me" });
    if (generation !== this.generation)
      throw new Error("การตั้งค่า Google เปลี่ยนระหว่างเชื่อมต่อ โปรดลองใหม่");
    this.credentials = tokens;
    this.credentials.email = profile.data.emailAddress || undefined;
    this.auth = undefined;
    this.save();
  }
  disconnect() {
    this.generation++;
    this.credentials = {};
    this.auth = undefined;
    this.pending.clear();
    if (existsSync(this.tokenPath)) unlinkSync(this.tokenPath);
  }
  private requireAuth() {
    if (!this.status().connected)
      throw new Error("ยังไม่ได้เชื่อมบัญชี Google หรือจำเป็นต้องเชื่อมใหม่");
    return this.client();
  }
  async searchMail(query: string) {
    const gmail = google.gmail({ version: "v1", auth: this.requireAuth() });
    const result = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 10,
    });
    return Promise.all(
      (result.data.messages || []).map(async (message) => {
        const { data } = await gmail.users.messages.get({
          userId: "me",
          id: message.id!,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        });
        return {
          id: data.id,
          threadId: data.threadId,
          snippet: data.snippet,
          headers: data.payload?.headers,
        };
      }),
    );
  }
  async readThread(threadId: string) {
    const { data } = await google
      .gmail({ version: "v1", auth: this.requireAuth() })
      .users.threads.get({ userId: "me", id: threadId, format: "full" });
    const bodyText = (part: any, mime: string): string => {
      if (part.mimeType === mime && part.body?.data)
        return Buffer.from(part.body.data, "base64url").toString("utf8");
      return (part.parts || [])
        .map((child: any) => bodyText(child, mime))
        .filter(Boolean)
        .join("\n");
    };
    return (data.messages || []).map((m) => ({
      id: m.id,
      headers: m.payload?.headers,
      snippet: m.snippet,
      text: (
        bodyText(m.payload || {}, "text/plain") ||
        bodyText(m.payload || {}, "text/html")
      ).slice(0, 16000),
      contentIsUntrusted: true,
    }));
  }
  async listEvents(from: string, to: string) {
    const range = z
      .object({ from: timestamp, to: timestamp })
      .refine((v) => Date.parse(v.to) > Date.parse(v.from))
      .parse({ from, to });
    const result = await google
      .calendar({ version: "v3", auth: this.requireAuth() })
      .events.list({
        calendarId: "primary",
        timeMin: range.from,
        timeMax: range.to,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 50,
      });
    return result.data.items || [];
  }
  async prepareEmail(input: unknown) {
    const data = emailProposal.parse(input);
    if (!data.threadId) return data;
    const thread = await google
      .gmail({ version: "v1", auth: this.requireAuth() })
      .users.threads.get({
        userId: "me",
        id: data.threadId,
        format: "metadata",
        metadataHeaders: ["Message-ID", "References"],
      });
    const headers = thread.data.messages?.at(-1)?.payload?.headers || [];
    const inReplyTo = headers.find(
      (h) => h.name?.toLowerCase() === "message-id",
    )?.value;
    const references = headers.find(
      (h) => h.name?.toLowerCase() === "references",
    )?.value;
    if (
      !inReplyTo ||
      /[\r\n]/.test(inReplyTo) ||
      (references && /[\r\n]/.test(references))
    )
      throw new Error("ไม่พบ Message-ID ที่ใช้ตอบกลับได้");
    return {
      ...data,
      inReplyTo,
      references: `${references || ""} ${inReplyTo}`.trim(),
    };
  }
  async prepareEvent(input: unknown) {
    const event = eventProposal.parse(input);
    if (!event.eventId) return event;
    const current = await google
      .calendar({ version: "v3", auth: this.requireAuth() })
      .events.get({ calendarId: "primary", eventId: event.eventId });
    return {
      ...event,
      etag: current.data.etag,
      previous: {
        summary: current.data.summary,
        start: current.data.start,
        end: current.data.end,
        attendees: current.data.attendees?.map((a) => a.email) || [],
      },
    };
  }
  async execute(action: string, payload: Record<string, unknown>) {
    if (action === "gmail_send") {
      const data = emailProposal.parse(payload);
      const subject = encodeSubject(data.subject);
      const replyHeaders = payload.inReplyTo
        ? `In-Reply-To: ${String(payload.inReplyTo)}\r\nReferences: ${String(payload.references)}\r\n`
        : "";
      if (
        /[\r\n]/.test(String(payload.inReplyTo || "")) ||
        /[\r\n]/.test(String(payload.references || ""))
      )
        throw new Error("Reply headers ไม่ถูกต้อง");
      const encodedBody =
        Buffer.from(data.body)
          .toString("base64")
          .match(/.{1,76}/g)
          ?.join("\r\n") || "";
      const raw = Buffer.from(
        `To: ${data.to.join(",\r\n ")}\r\nSubject: ${subject}\r\n${replyHeaders}MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedBody}`,
      ).toString("base64url");
      const result = await google
        .gmail({ version: "v1", auth: this.requireAuth() })
        .users.messages.send(
          { userId: "me", requestBody: { raw, threadId: data.threadId } },
          { retry: false },
        );
      return { id: result.data.id, message: "ส่งอีเมลแล้ว" };
    }
    if (action === "calendar_write") {
      const data = eventProposal.parse(payload);
      const calendar = google.calendar({
        version: "v3",
        auth: this.requireAuth(),
      });
      const requestBody = {
        summary: data.summary,
        start: { dateTime: data.start, timeZone: data.timezone },
        end: { dateTime: data.end, timeZone: data.timezone },
        attendees: data.attendees.map((email) => ({ email })),
      };
      const result = data.eventId
        ? await calendar.events.patch(
            {
              calendarId: "primary",
              eventId: data.eventId,
              sendUpdates: "all",
              requestBody,
            },
            {
              retry: false,
              headers: { "If-Match": String(payload.etag || "") },
            },
          )
        : await calendar.events.insert(
            {
              calendarId: "primary",
              sendUpdates: "all",
              requestBody: {
                ...requestBody,
                id: String(payload.requestId).replace(/-/g, ""),
              },
            },
            { retry: false },
          );
      return {
        id: result.data.id,
        url: result.data.htmlLink,
        message: "บันทึกนัดหมายแล้ว",
      };
    }
    throw new Error("ไม่รองรับการทำงานนี้");
  }
}

export function encodeSubject(subject: string) {
  const chunks: string[] = [];
  let chunk = "";
  for (const character of subject) {
    if (Buffer.byteLength(chunk + character, "utf8") > 45) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks
    .map((value) => `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`)
    .join("\r\n ");
}
