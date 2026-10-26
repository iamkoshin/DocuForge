import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DB_PATH, DATA_DIR, ensureDir } from "./paths";

declare global {
  // eslint-disable-next-line no-var
  var __narrativeDb: Database.Database | undefined;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  options TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',      -- queued|running|waiting|failed|done
  current_step TEXT,
  duration_sec REAL,
  thumbnail TEXT,
  estimate_usd REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS steps (
  project_id TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',     -- pending|running|done|failed|waiting|skipped
  input_hash TEXT,
  progress REAL DEFAULT 0,
  message TEXT,
  error TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  PRIMARY KEY (project_id, step)
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  from_step TEXT,
  status TEXT NOT NULL DEFAULT 'queued',      -- queued|running|done|failed|cancelled
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  step TEXT,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_project ON logs(project_id, id);

CREATE TABLE IF NOT EXISTS costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  step TEXT,
  provider TEXT NOT NULL,
  units REAL NOT NULL,
  unit_type TEXT NOT NULL,
  usd REAL NOT NULL,
  note TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS costs_project ON costs(project_id);

CREATE TABLE IF NOT EXISTS sfx (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,                          -- normalized prompt, e.g. whoosh_fast_airy
  prompt TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  file TEXT NOT NULL,                         -- relative to data dir
  duration REAL NOT NULL,
  category TEXT NOT NULL DEFAULT 'misc',
  source TEXT NOT NULL,                       -- starter|generated|upload
  uses INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sfx_key ON sfx(key);
`;

export function db(): Database.Database {
  if (!globalThis.__narrativeDb) {
    ensureDir(DATA_DIR);
    // The app was called DocuForge; carry its database (and WAL files) over to the new name once.
    // If another process still has the old file open (Windows: EBUSY), keep using it and retry on a later start.
    const legacy = path.join(DATA_DIR, "docuforge.db");
    let file = DB_PATH;
    if (!fs.existsSync(DB_PATH) && fs.existsSync(legacy)) {
      const moved: string[] = [];
      try {
        for (const ext of ["-wal", "-shm", ""]) {
          if (!fs.existsSync(legacy + ext)) continue;
          fs.renameSync(legacy + ext, DB_PATH + ext);
          moved.push(ext);
        }
      } catch {
        // Put back whatever moved so the database and its WAL stay together.
        for (const ext of moved) fs.renameSync(DB_PATH + ext, legacy + ext);
        file = legacy;
      }
    }
    const d = new Database(file);
    d.pragma("journal_mode = WAL");
    d.pragma("busy_timeout = 15000"); // the web server and worker share the database
    d.exec(SCHEMA);
    // Projects created before the Shorts step existed get its row (shorts are made only on request).
    d.exec("INSERT OR IGNORE INTO steps (project_id, step, status) SELECT id, 'shorts', CASE status WHEN 'done' THEN 'skipped' ELSE 'pending' END FROM projects");
    globalThis.__narrativeDb = d;
  }
  return globalThis.__narrativeDb;
}

export const now = () => Date.now();
