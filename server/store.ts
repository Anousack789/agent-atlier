import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Entities } from "../shared/types";

export class Store {
  readonly db: DatabaseSync;
  readonly dir: string;
  constructor(dir = process.env.OFFICE_DATA_DIR || resolve(".data")) {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(this.dir, "office.sqlite"));
    chmodSync(join(this.dir, "office.sqlite"), 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));",
    );
  }
  list<K extends keyof Entities>(kind: K): Entities[K][] {
    return (
      this.db
        .prepare("SELECT data FROM records WHERE kind=? ORDER BY rowid")
        .all(kind) as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  get<K extends keyof Entities>(kind: K, id: string): Entities[K] | undefined {
    const row = this.db
      .prepare("SELECT data FROM records WHERE kind=? AND id=?")
      .get(kind, id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  put<K extends keyof Entities>(kind: K, value: Entities[K]): Entities[K] {
    this.db
      .prepare(
        "INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
      )
      .run(kind, value.id, JSON.stringify(value));
    return value;
  }
  remove<K extends keyof Entities>(kind: K, id: string) {
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
