import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export type Rpc = {
  id?: number | string;
  method?: string;
  params?: Record<string, any>;
  result?: any;
  error?: { message: string; code?: number };
};

export class CodexClient {
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private starting?: Promise<void>;
  onNotification: (method: string, params: Record<string, any>) => void =
    () => {};
  onRequest: (message: Rpc) => Promise<void> = async () => {};
  onDisconnect: (reason: string) => void = () => {};
  private stopped = false;

  constructor(private readonly serena = true) {}

  async start() {
    if (this.starting) return this.starting;
    this.stopped = false;
    this.starting = (async () => {
      const env = { ...process.env };
      for (const key of Object.keys(env))
        if (/^(GOOGLE_|OFFICE_GOOGLE_)/.test(key)) delete env[key];
      const child = spawn(
        process.env.CODEX_BIN || "codex",
        [
          "app-server",
          "--listen",
          "stdio://",
          "-c",
          this.serena ? 'mcp_servers={serena={command="serena",args=["start-mcp-server","--context","codex","--project-from-cwd","--enable-web-dashboard","false"],enabled_tools=["initial_instructions","activate_project","get_symbols_overview","find_symbol","find_referencing_symbols","search_for_pattern"]}}' : "mcp_servers={}",
          "--disable",
          "multi_agent",
        ],
        { env, stdio: "pipe" },
      );
      this.child = child;
      let diagnostics = "";
      child.stderr.on("data", (data) => {
        diagnostics = (diagnostics + String(data)).slice(-4000);
      });
      createInterface({ input: child.stdout }).on("line", (line) => {
        let message: Rpc;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (message.method) {
          if (message.id !== undefined) {
            void this.onRequest(message).catch((error) =>
              this.replyError(
                message.id!,
                error instanceof Error ? error.message : "Tool failed",
              ),
            );
          } else this.onNotification(message.method, message.params || {});
          return;
        }
        if (typeof message.id !== "number") return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
      const disconnected = (reason: string) => {
        if (this.child !== child) return;
        this.child = undefined;
        this.starting = undefined;
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error(reason));
        }
        this.pending.clear();
        if (!this.stopped) this.onDisconnect(reason);
      };
      child.once("error", (error) => disconnected(error.message));
      child.once("exit", (code) =>
        disconnected(
          `Codex หยุดทำงาน (${code ?? "signal"}) ${diagnostics.trim()}`,
        ),
      );
      await this.request("initialize", {
        clientInfo: {
          name: "agent_atelier",
          title: "Agent Atelier",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true },
      });
      this.notify("initialized", {});
    })();
    try {
      await this.starting;
    } catch (error) {
      this.child?.kill();
      this.starting = undefined;
      throw error;
    }
  }
  request<T = any>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    if (!this.child || this.child.stdin.destroyed)
      return Promise.reject(new Error("Codex ยังไม่เชื่อมต่อ"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ตอบ ${method} ไม่ทันเวลา`));
      }, 45000);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  notify(method: string, params: Record<string, unknown>) {
    this.child?.stdin.write(JSON.stringify({ method, params }) + "\n");
  }
  reply(id: number | string, result: unknown) {
    this.child?.stdin.write(JSON.stringify({ id, result }) + "\n");
  }
  replyError(id: number | string, message: string) {
    this.child?.stdin.write(
      JSON.stringify({ id, error: { code: -32000, message } }) + "\n",
    );
  }
  stop() {
    this.stopped = true;
    this.child?.kill();
  }
}
