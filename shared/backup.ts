import type { Entities, Layout } from "./types";

export const maxBackupBytes = 100 * 1024 * 1024;
export const backupKinds = ["agents", "projects", "tasks", "messages", "memories", "schedules", "approvals", "templates", "conversations"] as const;
export type BackupKind = (typeof backupKinds)[number];
export type OfficeBackup = {
  format: "agent-atelier-office";
  version: 1;
  exportedAt: string;
  data: { [K in BackupKind]: Entities[K][] } & { layout: Layout };
  images: { id: string; base64: string }[];
};
export type BackupPreview = {
  token: string;
  exportedAt: string;
  counts: Record<BackupKind, number>;
  imageCount: number;
  missingPaths: { name: string; path: string }[];
};
