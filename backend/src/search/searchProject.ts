import MiniSearch from "minisearch";
import { openSqliteDb } from "../storage/sqliteDb";
import { getProjectDbPath } from "../storage/projectPaths";
import { bytesToFloat32, getEmbedder } from "./embedder";
import { clamp01, cosineSimilarity, rrfScore } from "./scoring";
import type { SearchChunk, SearchResponse, SearchTrace } from "./types";

type DbChunkRow = {
  chunk_id: string;
  path: string;
  lang: string;
  start_line: number;
  end_line: number;
  symbol_name: string | null;
  symbol_kind: string | null;
  signature: string | null;
  chunk_text: string;
  embedding: Uint8Array | null;
};

async function loadChunks(projectId: string): Promise<SearchChunk[] & { _rows?: DbChunkRow[] }> {
  const { db } = await openSqliteDb(getProjectDbPath(projectId));
  const rows = db.all<DbChunkRow>(
    `
    SELECT chunk_id, path, lang, start_line, end_line, symbol_name, symbol_kind, signature, chunk_text, embedding
    FROM chunks
    WHERE state = 'ready'
  `,
  );

  const chunks = rows.map((r) => ({
    chunkId: r.chunk_id,
    path: r.path,
    lang: r.lang,
    startLine: r.start_line,
    endLine: r.end_line,
    symbolName: r.symbol_name,
    symbolKind: r.symbol_kind,
    signature: r.signature,
    chunkText: r.chunk_text,
  })) as SearchChunk[] & { _rows?: DbChunkRow[] };
  chunks._rows = rows;
  return chunks;
}

export async function searchProject(params: {
  projectId: string;
  query: string;
  topK?: number;
}): Promise<SearchResponse> {
  const { projectId, query } = params;
  const topK = params.topK ?? 8;

  const chunks = await loadChunks(projectId);
  const rows = chunks._rows ?? [];

  // --- Lexical ---
  const mini = new MiniSearch<{
    id: string;
    path: string;
    text: string;
  }>({
    fields: ["path", "text"],
    storeFields: ["path"],
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
      boost: { path: 2, text: 1 },
    },
  });
  mini.addAll(
    chunks.map((c) => ({
      id: c.chunkId,
      path: c.path,
      text: c.chunkText,
    })),
  );

  const lexicalRaw = mini.search(query, { combineWith: "AND" }).slice(0, Math.max(50, topK * 10));
  const lexicalRank = new Map<string, { rank: number; score: number }>();
  lexicalRaw.forEach((r, i) => lexicalRank.set(String(r.id), { rank: i + 1, score: Number(r.score) }));

  // --- Semantic ---
  const embedder = await getEmbedder();
  const qVec = await embedder.embed(query);

  const semanticScored: Array<{ chunkId: string; path: string; score: number }> = [];
  for (const r of rows) {
    if (!r.embedding) continue;
    const vec = bytesToFloat32(r.embedding);
    const score = cosineSimilarity(qVec, vec);
    semanticScored.push({ chunkId: r.chunk_id, path: r.path, score });
  }
  semanticScored.sort((a, b) => b.score - a.score);
  const semanticTop = semanticScored.slice(0, Math.max(50, topK * 10));
  const semanticRank = new Map<string, { rank: number; score: number }>();
  semanticTop.forEach((r, i) => semanticRank.set(r.chunkId, { rank: i + 1, score: r.score }));

  // --- Fusion (RRF) ---
  const fusedScore = new Map<string, number>();
  for (const [id, v] of lexicalRank) fusedScore.set(id, (fusedScore.get(id) ?? 0) + rrfScore(v.rank));
  for (const [id, v] of semanticRank) fusedScore.set(id, (fusedScore.get(id) ?? 0) + rrfScore(v.rank));

  const fused = [...fusedScore.entries()]
    .map(([chunkId, score]) => ({ chunkId, score, path: chunks.find((c) => c.chunkId === chunkId)?.path ?? "" }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(200, topK * 25));

  // --- Rerank (simple, explainable) ---
  const maxLex = Math.max(1e-9, ...[...lexicalRank.values()].map((v) => v.score));
  const maxSem = Math.max(1e-9, ...[...semanticRank.values()].map((v) => v.score));

  const reranked = fused
    .map((c) => {
      const lex = lexicalRank.get(c.chunkId);
      const sem = semanticRank.get(c.chunkId);
      const lexN = lex ? clamp01(lex.score / maxLex) : 0;
      const semN = sem ? clamp01(sem.score / maxSem) : 0;

      const boosts: Record<string, number> = {};
      let boost = 0;
      if (c.path.startsWith("src/")) {
        boosts.src = 0.05;
        boost += boosts.src;
      }
      if (c.path.includes("/test") || c.path.includes("__tests__")) {
        boosts.tests = -0.05;
        boost += boosts.tests;
      }

      const score = 0.55 * semN + 0.35 * lexN + 0.1 * clamp01(c.score / 0.05) + boost;
      return {
        chunkId: c.chunkId,
        path: c.path,
        score,
        why: {
          lexicalRank: lex?.rank,
          lexicalScore: lex?.score,
          semanticRank: sem?.rank,
          semanticScore: sem?.score,
          fusionScore: c.score,
          rerankScore: score,
          boosts,
        },
      };
    })
    .sort((a, b) => b.score - a.score);

  const topChunks = reranked.slice(0, Math.max(50, topK * 10));

  // Aggregate to files
  const byFile = new Map<string, { score: number; chunks: typeof topChunks }>();
  for (const h of topChunks) {
    const cur = byFile.get(h.path);
    if (!cur) {
      byFile.set(h.path, { score: h.score, chunks: [h] as any });
    } else {
      cur.score = Math.max(cur.score, h.score);
      (cur.chunks as any).push(h);
    }
  }

  const files = [...byFile.entries()]
    .map(([path, v]) => ({
      path,
      score: v.score,
      chunks: (v.chunks as any).slice(0, 5),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const trace: SearchTrace = {
    lexical: lexicalRaw.slice(0, 25).map((r, i) => ({
      chunkId: String(r.id),
      score: Number(r.score),
      rank: i + 1,
      path: String((r as any).path ?? mini.documentStore.get(String(r.id))?.path ?? ""),
    })),
    semantic: semanticTop.slice(0, 25).map((r, i) => ({ ...r, rank: i + 1 })),
    fused: fused.slice(0, 50),
    reranked: reranked.slice(0, 50).map((r) => ({ chunkId: r.chunkId, score: r.score, path: r.path })),
  };

  return {
    query,
    topK,
    files,
    trace,
  };
}

