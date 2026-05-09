export type SearchChunk = {
  chunkId: string;
  path: string;
  lang: string;
  startLine: number;
  endLine: number;
  symbolName: string | null;
  symbolKind: string | null;
  signature: string | null;
  chunkText: string;
};

export type SearchHit = {
  chunkId: string;
  path: string;
  score: number;
  why: {
    lexicalRank?: number;
    lexicalScore?: number;
    semanticRank?: number;
    semanticScore?: number;
    fusionScore?: number;
    rerankScore?: number;
    boosts?: Record<string, number>;
  };
};

export type FileResult = {
  path: string;
  score: number;
  chunks: SearchHit[];
};

export type SearchTrace = {
  lexical: Array<{ chunkId: string; score: number; rank: number; path: string }>;
  semantic: Array<{ chunkId: string; score: number; rank: number; path: string }>;
  fused: Array<{ chunkId: string; score: number; path: string }>;
  reranked: Array<{ chunkId: string; score: number; path: string }>;
};

export type SearchResponse = {
  query: string;
  topK: number;
  files: FileResult[];
  trace: SearchTrace;
};

