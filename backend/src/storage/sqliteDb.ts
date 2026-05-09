import fs from "node:fs/promises";
import path from "node:path";
import initSqlJs from "sql.js";

export type SqlJsDb = {
  exec: (sql: string, params?: unknown[]) => unknown;
  run: (sql: string, params?: unknown[]) => void;
  get: <T>(sql: string, params?: unknown[]) => T | undefined;
  all: <T>(sql: string, params?: unknown[]) => T[];
  export: () => Uint8Array;
};

type LoadedDb = {
  SQL: Awaited<ReturnType<typeof initSqlJs>>;
  db: import("sql.js").Database;
};

let cachedSql: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function getSql() {
  if (cachedSql) return cachedSql;
  cachedSql = await initSqlJs({});
  return cachedSql;
}

async function loadDbFile(dbPath: string): Promise<LoadedDb> {
  const SQL = await getSql();
  try {
    const bytes = await fs.readFile(dbPath);
    return { SQL, db: new SQL.Database(bytes) };
  } catch {
    return { SQL, db: new SQL.Database() };
  }
}

function createFacade(loaded: LoadedDb): SqlJsDb {
  const { db } = loaded;

  function run(sql: string, params: unknown[] = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params as any);
      while (stmt.step()) {
        // consume
      }
    } finally {
      stmt.free();
    }
  }

  function get<T>(sql: string, params: unknown[] = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params as any);
      if (!stmt.step()) return undefined;
      return stmt.getAsObject() as unknown as T;
    } finally {
      stmt.free();
    }
  }

  function all<T>(sql: string, params: unknown[] = []) {
    const stmt = db.prepare(sql);
    const out: T[] = [];
    try {
      stmt.bind(params as any);
      while (stmt.step()) out.push(stmt.getAsObject() as unknown as T);
      return out;
    } finally {
      stmt.free();
    }
  }

  return {
    exec: (sql: string) => db.exec(sql),
    run,
    get,
    all,
    export: () => db.export(),
  };
}

export async function openSqliteDb(dbPath: string): Promise<{
  db: SqlJsDb;
  save: () => Promise<void>;
}> {
  const loaded = await loadDbFile(dbPath);
  const facade = createFacade(loaded);

  async function save() {
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.writeFile(dbPath, Buffer.from(facade.export()));
  }

  return { db: facade, save };
}

export function ensureSchema(db: SqlJsDb) {
  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      file_id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      lang TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      size_bytes INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      parse_status TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      path TEXT NOT NULL,
      lang TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      symbol_name TEXT,
      symbol_kind TEXT,
      signature TEXT,
      chunk_hash TEXT NOT NULL,
      chunk_text TEXT NOT NULL,
      embedding BLOB,
      state TEXT NOT NULL,
      FOREIGN KEY(file_id) REFERENCES files(file_id)
    );
  `);
}

