"use client";
import { useState } from "react";
import {
  Link2,
  Mail,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import type { Snapshot } from "../shared/types";
type Action = <T = unknown>(name: string, data?: unknown) => Promise<T>;
export function Connections({
  state,
  action,
}: {
  state: Snapshot;
  action: Action;
}) {
  const [clientId, setClientId] = useState(state.google.clientId),
    [clientSecret, setClientSecret] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="connections">
      <section className="panel">
        <div className="section-heading">
          <h2>Codex CLI</h2>
          <span className={`connection-label ${state.codex.state}`}>
            <i
              className={`dot ${state.codex.state === "ready" ? "ready" : "waiting"}`}
            />
            {state.codex.state === "ready"
              ? "เชื่อมต่อแล้ว"
              : state.codex.state === "connecting"
                ? "กำลังเชื่อมต่อ"
                : "ต้องเชื่อมต่อใหม่"}
          </span>
        </div>
        <p>ใช้บัญชีที่ล็อกอินในเครื่อง โมเดลที่เลือกได้จะแสดงจาก Codex</p>
        {state.codex.error && (
          <p className="inline-error">{state.codex.error}</p>
        )}
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await action("codex.reconnect");
            } catch {
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw size={16} />
          เชื่อมต่อ Codex ใหม่
        </button>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>
            <Mail size={22} /> Gmail & Google Calendar
          </h2>
          {state.google.connected && (
            <span className="success-text">
              <CheckCircle2 size={16} />
              เชื่อมต่อแล้ว
            </span>
          )}
        </div>
        <p>
          ให้ทีมอ่านอีเมลและนัดหมายได้
          การส่งอีเมลและเปลี่ยนนัดหมายต้องผ่านศูนย์อนุมัติทุกครั้ง
        </p>
        {state.google.connected && (
          <div className="connected-account">
            <strong>{state.google.email || "บัญชี Google ของคุณ"}</strong>
            <button
              className="danger-outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await action("google.disconnect");
                } catch {
                } finally {
                  setBusy(false);
                }
              }}
            >
              ลบการเชื่อมต่อในเครื่อง
            </button>
          </div>
        )}
        <details open={!state.google.configured}>
          <summary>ตั้งค่า Google OAuth สำหรับใช้งานส่วนตัว</summary>
          <ol className="setup-steps">
            <li>
              สร้าง Google Cloud project และเปิด Gmail API กับ Google Calendar
              API
            </li>
            <li>
              ตั้งค่า OAuth consent screen และเพิ่มบัญชีของคุณเป็น test user
              หากแอปอยู่ในสถานะ Testing
            </li>
            <li>
              สร้าง OAuth Client ประเภท <strong>Desktop app</strong>{" "}
              แล้วกรอกข้อมูลด้านล่าง
            </li>
            <li>
              กดเชื่อมบัญชี จากนั้นอนุญาตเฉพาะสมาชิกที่ต้องใช้ Google
              ในหน้าตั้งค่าสมาชิก
            </li>
          </ol>
          <p className="note">
            บัญชีทดสอบอาจต้องเชื่อมใหม่ตามอายุ token ที่ Google กำหนด
            ข้อมูลเชื่อมต่อเก็บฝั่ง server ในเครื่อง ไม่ส่งให้โมเดล
          </p>
          <a
            className="external-link"
            href="https://console.cloud.google.com/auth/clients"
            target="_blank"
            rel="noreferrer"
          >
            เปิด Google Cloud Console <ExternalLink size={14} />
          </a>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await action("google.configure", {
                  clientId,
                  clientSecret: clientSecret || undefined,
                });
                setClientSecret("");
              } catch {
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Client ID
              <input
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="…apps.googleusercontent.com"
                spellCheck={false}
              />
            </label>
            <label>
              Client secret
              <input
                type="password"
                autoComplete="off"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={
                  state.google.configured
                    ? "เก็บค่าเดิมหากไม่เปลี่ยน"
                    : "จาก OAuth Client ของคุณ"
                }
              />
            </label>
            <button disabled={busy}>บันทึกการตั้งค่า</button>
          </form>
        </details>
        <button
          className="primary"
          disabled={busy || !state.google.configured}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await action<{ url: string }>("google.connect");
              window.location.assign(result.url);
            } catch {
              setBusy(false);
            }
          }}
        >
          <Link2 size={17} />
          {state.google.connected ? "เชื่อมบัญชีใหม่" : "เชื่อมบัญชี Google"}
        </button>
      </section>
    </div>
  );
}
