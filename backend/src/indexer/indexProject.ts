import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { chunkTypescriptOrFallback } from "./chunker";
import { sha256Hex } from "./hash";
import { inferLangByPath } from "./lang";
import { isProbablyBinaryByExtension, shouldIgnorePath } from "./ignore";
import { ensureSchema, openSqliteDb } from "../storage/sqliteDb";
import { getProjectDbPath } from "../storage/projectPaths";
import { float32ToBytes, getEmbedder } from "../search/embedder";

export type IndexProgress = {
  phase: "scanning" | "indexing" | "done";
  totalFiles: number;
  processedFiles: number;
  updatedFiles: number;
  deletedFiles: number;
  chunksUpserted: number;
  chunksDeleted: number;
  lastPath?: string;
};

export async function indexProjectOnce(params: {
  projectId: string;
  rootPath: string;
  onProgress?: (p: IndexProgress) => void;
}) {
  const { projectId, rootPath, onProgress } = params;

  const { db, save } = await openSqliteDb(getProjectDbPath(projectId));
  ensureSchema(db);
  const embedder = await getEmbedder();

  const progress: IndexProgress = {
    phase: "scanning",
    totalFiles: 0,
    processedFiles: 0,
    updatedFiles: 0,
    deletedFiles: 0,
    chunksUpserted: 0,
    chunksDeleted: 0,
  };

  const emit = () => onProgress?.({ ...progress });
  emit();

  const cwd = path.resolve(rootPath);
  const allPaths = await fg(["**/*"], {
    cwd,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
  });

  const candidatePaths = allPaths
    .map((p) => p.split(path.sep).join("/"))
    .filter((p) => !shouldIgnorePath(p))
    .filter((p) => !isProbablyBinaryByExtension(p));

  progress.totalFiles = candidatePaths.length;
  progress.phase = "indexing";
  emit();

  const existingFiles = db.all<{ file_id: string; path: string; content_hash: string }>(
    "SELECT file_id, path, content_hash FROM files",
  );
  const existingByPath = new Map(existingFiles.map((f) => [f.path, f]));

  const seen = new Set<string>();

  for (const relPath of candidatePaths) {
    progress.lastPath = relPath;
    const absPath = path.join(cwd, relPath);
    seen.add(relPath);

    let stat: { mtimeMs: number; size: number };
    try {
      const s = await fs.stat(absPath);
      stat = { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      continue;
    }

    // Skip huge files in MVP.
    if (stat.size > 1_000_000) {
      progress.processedFiles++;
      emit();
      continue;
    }

    const content = await fs.readFile(absPath, "utf8");
    const contentHash = sha256Hex(content);

    const prev = existingByPath.get(relPath);
    const fileId = sha256Hex(relPath);
    const lang = inferLangByPath(relPath);

    if (prev?.content_hash === contentHash) {
      // unchanged
      progress.processedFiles++;
      emit();
      continue;
    }

    const { chunks, parseStatus } = chunkTypescriptOrFallback({ relPath, lang, content });

    // Upsert file
    db.run(
      `
      INSERT INTO files (file_id, path, lang, mtime_ms, size_bytes, content_hash, parse_status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_id) DO UPDATE SET
        path=excluded.path,
        lang=excluded.lang,
        mtime_ms=excluded.mtime_ms,
        size_bytes=excluded.size_bytes,
        content_hash=excluded.content_hash,
        parse_status=excluded.parse_status
    `,
      [fileId, relPath, lang, Math.round(stat.mtimeMs), stat.size, contentHash, parseStatus],
    );

    // Delete previous chunks for this file (simple but correct for MVP)
    const oldChunks = db.all<{ chunk_id: string }>(
      "SELECT chunk_id FROM chunks WHERE file_id = ?",
      [fileId],
    );
    if (oldChunks.length) {
      db.run("DELETE FROM chunks WHERE file_id = ?", [fileId]);
      progress.chunksDeleted += oldChunks.length;
    }

    for (const c of chunks) {
      const embedding = await embedder.embed(c.chunkText);
      db.run(
        `
        INSERT INTO chunks (
          chunk_id, file_id, path, lang, start_line, end_line,
          symbol_name, symbol_kind, signature,
          chunk_hash, chunk_text, embedding, state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(chunk_id) DO UPDATE SET
          file_id=excluded.file_id,
          path=excluded.path,
          lang=excluded.lang,
          start_line=excluded.start_line,
          end_line=excluded.end_line,
          symbol_name=excluded.symbol_name,
          symbol_kind=excluded.symbol_kind,
          signature=excluded.signature,
          chunk_hash=excluded.chunk_hash,
          chunk_text=excluded.chunk_text,
          embedding=excluded.embedding,
          state=excluded.state
      `,
        [
          c.chunkId,
          fileId,
          c.path,
          c.lang,
          c.startLine,
          c.endLine,
          c.symbolName ?? null,
          c.symbolKind ?? null,
          c.signature ?? null,
          c.chunkHash,
          c.chunkText,
          float32ToBytes(embedding),
          "ready",
        ],
      );
      progress.chunksUpserted++;
    }

    progress.updatedFiles++;
    progress.processedFiles++;
    emit();
  }

  // Deletes: files that are no longer present
  const toDelete = existingFiles.filter((f) => !seen.has(f.path));
  for (const f of toDelete) {
    const fileId = f.file_id;
    const oldChunks = db.all<{ chunk_id: string }>(
      "SELECT chunk_id FROM chunks WHERE file_id = ?",
      [fileId],
    );
    if (oldChunks.length) {
      db.run("DELETE FROM chunks WHERE file_id = ?", [fileId]);
      progress.chunksDeleted += oldChunks.length;
    }
    db.run("DELETE FROM files WHERE file_id = ?", [fileId]);
    progress.deletedFiles++;
    emit();
  }

  progress.phase = "done";
  emit();
  await save();
}

