import { createHash, randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { EventSchema, ROLES, type Event, type Role } from "@graveyard/core";
import { z } from "zod";

export const hashSecret = (s: string): string =>
  createHash("sha256").update(s).digest("hex");

export interface CallerRow {
  handle: string;
  role: Role;
}

export interface LessonRow {
  text: string;
  tags: string[];
  project: string;
  board: string;
  thread: string;
}

export interface FileRow {
  sha256: string;
  thread_id: string;
  name: string;
  path: string;
}

const LessonRowSchema = z.object({
  text: z.string(),
  tags: z.array(z.string()),
  project: z.string(),
  board: z.string(),
  thread: z.string(),
});
const RoleSchema = z.enum(ROLES);
const CallerRowSchema = z.object({ handle: z.string(), role: RoleSchema });

/** R1: append-only SQLite event log (WAL), callers with hashed secrets, and the file area index. */
export class Store {
  readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, id TEXT UNIQUE, at INTEGER,
        thread_id TEXT, caller TEXT, type TEXT, body TEXT);
      CREATE TABLE IF NOT EXISTS callers (handle TEXT PRIMARY KEY, role TEXT, token_hash TEXT);
      CREATE TABLE IF NOT EXISTS lessons (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, tags TEXT,
        project TEXT, board TEXT, thread TEXT, UNIQUE (project, thread, text));
      CREATE TABLE IF NOT EXISTS files (sha256 TEXT PRIMARY KEY, thread_id TEXT, name TEXT, path TEXT);
    `);
  }

  /** R1.2: all events of one command, or none. */
  append(events: readonly Event[]): void {
    const ins = this.db.prepare(
      "INSERT INTO events (seq, id, at, thread_id, caller, type, body) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    this.db.transaction(() => {
      for (const e of events)
        ins.run(
          e.seq,
          e.id,
          e.at,
          e.thread_id,
          e.caller,
          e.type,
          JSON.stringify(e.body),
        );
    })();
  }

  /** R1.1: events in order, validated by the core schema. */
  events(afterSeq = 0): Event[] {
    const rows = this.db
      .prepare("SELECT * FROM events WHERE seq > ? ORDER BY seq")
      .all(afterSeq) as Record<string, unknown>[];
    return rows.map((r) =>
      EventSchema.parse({ ...r, body: JSON.parse(String(r["body"])) }),
    );
  }

  /** R2.3: returns the secret once; only its hash is stored. */
  addCaller(handle: string, role: Role): string {
    RoleSchema.parse(role);
    const secret = `gy_${randomBytes(24).toString("hex")}`;
    this.db
      .prepare(
        "INSERT INTO callers (handle, role, token_hash) VALUES (?, ?, ?)",
      )
      .run(handle, role, hashSecret(secret));
    return secret;
  }

  callerBySecret(secret: string): CallerRow | undefined {
    const row = this.db
      .prepare("SELECT handle, role FROM callers WHERE token_hash = ?")
      .get(hashSecret(secret));
    return row === undefined ? undefined : CallerRowSchema.parse(row);
  }

  callers(): CallerRow[] {
    return this.db
      .prepare("SELECT handle, role FROM callers ORDER BY handle")
      .all()
      .map((r) => CallerRowSchema.parse(r));
  }

  /** Spec 03 R9.2: the knowledge hub. Same (project, thread, text) is stored once. */
  addLesson(l: LessonRow): boolean {
    return (
      this.db
        .prepare(
          "INSERT OR IGNORE INTO lessons (text, tags, project, board, thread) VALUES (?, ?, ?, ?, ?)",
        )
        .run(l.text, JSON.stringify(l.tags), l.project, l.board, l.thread)
        .changes > 0
    );
  }

  /** Oldest first; `board` filters, `limit` keeps the newest N. */
  lessons(board?: string, limit = 200): LessonRow[] {
    const rows = this.db
      .prepare(
        `SELECT text, tags, project, board, thread FROM lessons ${board ? "WHERE board = ?" : ""} ORDER BY id DESC LIMIT ?`,
      )
      .all(...(board ? [board, limit] : [limit])) as Record<string, unknown>[];
    return rows
      .reverse()
      .map((r) =>
        LessonRowSchema.parse({ ...r, tags: JSON.parse(String(r["tags"])) }),
      );
  }

  addFile(f: FileRow): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO files (sha256, thread_id, name, path) VALUES (?, ?, ?, ?)",
      )
      .run(f.sha256, f.thread_id, f.name, f.path);
  }

  files(): FileRow[] {
    return this.db
      .prepare("SELECT * FROM files ORDER BY rowid")
      .all() as FileRow[];
  }

  close(): void {
    this.db.close();
  }
}
