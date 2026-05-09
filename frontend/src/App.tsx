import { useEffect, useMemo, useRef, useState } from "react";

type Project = {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
};

type IndexRun = {
  running: boolean;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  progress: {
    phase: "scanning" | "indexing" | "done";
    totalFiles: number;
    processedFiles: number;
    updatedFiles: number;
    deletedFiles: number;
    chunksUpserted: number;
    chunksDeleted: number;
    lastPath?: string;
  };
};

type SearchResponse = {
  query: string;
  topK: number;
  files: Array<{
    path: string;
    score: number;
    chunks: Array<{
      chunkId: string;
      path: string;
      score: number;
      why: Record<string, unknown>;
    }>;
  }>;
  trace: {
    lexical: Array<{ chunkId: string; score: number; rank: number; path: string }>;
    semantic: Array<{ chunkId: string; score: number; rank: number; path: string }>;
    fused: Array<{ chunkId: string; score: number; path: string }>;
    reranked: Array<{ chunkId: string; score: number; path: string }>;
  };
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }
  return (await res.json()) as T;
}

function Card(props: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--canvas)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-2)",
        padding: 18,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontWeight: 800 }}>{props.title}</div>
        {props.right}
      </div>
      <div style={{ marginTop: 12 }}>{props.children}</div>
    </div>
  );
}

function CodeBadge(props: { children: string }) {
  return (
    <span
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        fontSize: 12,
        border: "1px solid var(--hairline)",
        borderRadius: 8,
        padding: "2px 8px",
        background: "var(--surface)",
        color: "var(--slate)",
      }}
    >
      {props.children}
    </span>
  );
}

export function App() {
  const year = useMemo(() => new Date().getFullYear(), []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const selected = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const [createName, setCreateName] = useState("demo");
  const [createPath, setCreatePath] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [indexRun, setIndexRun] = useState<IndexRun | null>(null);
  const indexPollRef = useRef<number | null>(null);

  const [query, setQuery] = useState("where is indexing implemented?");
  const [topK, setTopK] = useState(5);
  const [searchOut, setSearchOut] = useState<SearchResponse | null>(null);

  async function refreshProjects() {
    const out = await api<{ projects: Project[] }>("/api/projects");
    setProjects(out.projects);
    if (!selectedProjectId && out.projects.length) setSelectedProjectId(out.projects[0]!.id);
  }

  useEffect(() => {
    void refreshProjects().catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // stop polling on project change
    if (indexPollRef.current != null) {
      window.clearInterval(indexPollRef.current);
      indexPollRef.current = null;
    }
    setIndexRun(null);
    setSearchOut(null);

    if (!selectedProjectId) return;

    indexPollRef.current = window.setInterval(() => {
      void api<{ run: IndexRun | null }>(`/api/projects/${selectedProjectId}/index/status`)
        .then((r) => setIndexRun(r.run))
        .catch(() => {
          // ignore transient polling errors
        });
    }, 600);

    return () => {
      if (indexPollRef.current != null) window.clearInterval(indexPollRef.current);
      indexPollRef.current = null;
    };
  }, [selectedProjectId]);

  async function onCreateProject() {
    setBusy("create");
    setError(null);
    try {
      const out = await api<{ project: Project }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: createName.trim(), rootPath: createPath.trim() }),
      });
      await refreshProjects();
      setSelectedProjectId(out.project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onStartIndex() {
    if (!selectedProjectId) return;
    setBusy("index");
    setError(null);
    try {
      await api(`/api/projects/${selectedProjectId}/index`, { method: "POST", body: "{}" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onSearch() {
    if (!selectedProjectId) return;
    setBusy("search");
    setError(null);
    try {
      const out = await api<SearchResponse>(`/api/projects/${selectedProjectId}/search`, {
        method: "POST",
        body: JSON.stringify({ query, topK }),
      });
      setSearchOut(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const pct = indexRun
    ? Math.round(
        (indexRun.progress.totalFiles
          ? (indexRun.progress.processedFiles / indexRun.progress.totalFiles) * 100
          : 0) * 10,
      ) / 10
    : null;

  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <header
        style={{
          background: "var(--brand-teal-deep)",
          color: "white",
          padding: "24px 24px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.75)" }}>ASTRAG</div>
              <div style={{ fontSize: 38, fontWeight: 650, lineHeight: 1.1 }}>
                Index. Search. Explain.
              </div>
            </div>
            <div style={{ alignSelf: "end", display: "flex", gap: 10, flexWrap: "wrap" }}>
              <CodeBadge>{selected ? selected.name : "no project"}</CodeBadge>
              <CodeBadge>{selected ? selected.rootPath : "—"}</CodeBadge>
            </div>
          </div>
          <div style={{ color: "rgba(255,255,255,0.78)", maxWidth: 900 }}>
            Link a folder, index it, then run a query. The right side surfaces the retrieval trace:
            lexical hits → semantic hits → fusion → rerank.
          </div>
        </div>
      </header>

      <main style={{ padding: 24 }}>
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            alignItems: "start",
          }}
        >
          <div style={{ display: "grid", gap: 16 }}>
            <Card
              title="Projects"
              right={
                <button
                  onClick={() => void refreshProjects()}
                  style={{
                    border: "1px solid rgba(255,255,255,0.18)",
                    borderRadius: "var(--radius-full)",
                    padding: "6px 12px",
                    cursor: "pointer",
                    background: "transparent",
                    color: "var(--ink)",
                  }}
                >
                  Refresh
                </button>
              }
            >
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>Create</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <input
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      placeholder="Project name"
                      style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--hairline)" }}
                    />
                    <input
                      value={createPath}
                      onChange={(e) => setCreatePath(e.target.value)}
                      placeholder="Absolute folder path (e.g. /Users/you/my-repo)"
                      style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--hairline)" }}
                    />
                    <button
                      onClick={onCreateProject}
                      disabled={busy === "create" || !createName.trim() || !createPath.trim()}
                      style={{
                        border: "none",
                        borderRadius: "var(--radius-full)",
                        padding: "10px 16px",
                        fontWeight: 800,
                        cursor: "pointer",
                        background: "var(--brand-green)",
                        color: "var(--brand-teal-deep)",
                        opacity: busy === "create" ? 0.7 : 1,
                      }}
                    >
                      {busy === "create" ? "Creating…" : "Create project"}
                    </button>
                  </div>
                </div>

                <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Select</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {projects.length === 0 ? (
                      <div style={{ color: "var(--slate)" }}>No projects yet.</div>
                    ) : (
                      projects.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setSelectedProjectId(p.id)}
                          style={{
                            textAlign: "left",
                            border: "1px solid var(--hairline)",
                            borderRadius: 12,
                            padding: "10px 12px",
                            background: p.id === selectedProjectId ? "rgba(0,237,100,0.14)" : "white",
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ fontWeight: 800 }}>{p.name}</div>
                          <div style={{ color: "var(--slate)", fontSize: 13 }}>{p.rootPath}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </Card>

            <Card title="Indexing">
              <div style={{ display: "grid", gap: 10 }}>
                <button
                  onClick={onStartIndex}
                  disabled={!selectedProjectId || busy === "index"}
                  style={{
                    border: "none",
                    borderRadius: "var(--radius-full)",
                    padding: "10px 16px",
                    fontWeight: 800,
                    cursor: "pointer",
                    background: "var(--brand-teal-deep)",
                    color: "white",
                    opacity: busy === "index" ? 0.7 : 1,
                  }}
                >
                  {busy === "index" ? "Indexing…" : "Start indexing"}
                </button>

                {indexRun ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ color: "var(--slate)" }}>
                        Phase: <b>{indexRun.progress.phase}</b>{" "}
                        {indexRun.running ? <CodeBadge>running</CodeBadge> : <CodeBadge>idle</CodeBadge>}
                      </div>
                      <div style={{ color: "var(--slate)" }}>{pct != null ? `${pct}%` : "—"}</div>
                    </div>
                    <div
                      style={{
                        height: 10,
                        borderRadius: 9999,
                        background: "var(--hairline)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.max(0, Math.min(100, pct ?? 0))}%`,
                          background: "var(--brand-green)",
                        }}
                      />
                    </div>
                    <div style={{ color: "var(--slate)", fontSize: 13, display: "grid", gap: 2 }}>
                      <div>
                        files: {indexRun.progress.processedFiles}/{indexRun.progress.totalFiles} (updated{" "}
                        {indexRun.progress.updatedFiles}, deleted {indexRun.progress.deletedFiles})
                      </div>
                      <div>
                        chunks: +{indexRun.progress.chunksUpserted} / -{indexRun.progress.chunksDeleted}
                      </div>
                      {indexRun.progress.lastPath ? (
                        <div>
                          last: <CodeBadge>{indexRun.progress.lastPath}</CodeBadge>
                        </div>
                      ) : null}
                      {indexRun.error ? <div style={{ color: "#946f3f" }}>error: {indexRun.error}</div> : null}
                    </div>
                  </div>
                ) : (
                  <div style={{ color: "var(--slate)" }}>
                    No run yet. Click <b>Start indexing</b>.
                  </div>
                )}
              </div>
            </Card>

            <Card title="Query">
              <div style={{ display: "grid", gap: 10 }}>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ask something about the codebase…"
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--hairline)" }}
                />
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ color: "var(--slate)", fontSize: 13 }}>
                    Top files{" "}
                    <input
                      type="number"
                      value={topK}
                      min={1}
                      max={25}
                      onChange={(e) => setTopK(Number(e.target.value))}
                      style={{
                        width: 80,
                        marginLeft: 8,
                        padding: "6px 8px",
                        borderRadius: 10,
                        border: "1px solid var(--hairline)",
                      }}
                    />
                  </label>
                  <button
                    onClick={onSearch}
                    disabled={!selectedProjectId || busy === "search" || !query.trim()}
                    style={{
                      border: "none",
                      borderRadius: "var(--radius-full)",
                      padding: "10px 16px",
                      fontWeight: 800,
                      cursor: "pointer",
                      background: "var(--brand-green)",
                      color: "var(--brand-teal-deep)",
                      opacity: busy === "search" ? 0.7 : 1,
                    }}
                  >
                    {busy === "search" ? "Searching…" : "Search"}
                  </button>
                </div>

                {searchOut ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {searchOut.files.length === 0 ? (
                      <div style={{ color: "var(--slate)" }}>No results.</div>
                    ) : (
                      searchOut.files.map((f) => (
                        <div
                          key={f.path}
                          style={{
                            border: "1px solid var(--hairline)",
                            borderRadius: 12,
                            padding: "10px 12px",
                            background: "white",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                            <div style={{ fontWeight: 800 }}>{f.path}</div>
                            <CodeBadge>{f.score.toFixed(4)}</CodeBadge>
                          </div>
                          <div style={{ marginTop: 8, color: "var(--slate)", fontSize: 13 }}>
                            Evidence chunks: {f.chunks.length}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div style={{ color: "var(--slate)" }}>
                    Search results will show the top files. Open the trace panel to see how each stage contributed.
                  </div>
                )}
              </div>
            </Card>

            {error ? (
              <div
                style={{
                  border: "1px solid #e1c28a",
                  background: "#fff8e0",
                  color: "#946f3f",
                  borderRadius: 12,
                  padding: "10px 12px",
                }}
              >
                <b>Error</b>: {error}
              </div>
            ) : null}
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            <Card title="Retrieval trace">
              {searchOut ? (
                <div style={{ display: "grid", gap: 12 }}>
                  <details open>
                    <summary style={{ cursor: "pointer", fontWeight: 800 }}>1) Lexical hits</summary>
                    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                      {searchOut.trace.lexical.length === 0 ? (
                        <div style={{ color: "var(--slate)" }}>No lexical hits for this query.</div>
                      ) : (
                        searchOut.trace.lexical.map((h) => (
                          <div
                            key={h.chunkId}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              border: "1px solid var(--hairline)",
                              borderRadius: 10,
                              padding: "8px 10px",
                            }}
                          >
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              <b>#{h.rank}</b> {h.path}
                            </div>
                            <CodeBadge>{h.score.toFixed(3)}</CodeBadge>
                          </div>
                        ))
                      )}
                    </div>
                  </details>

                  <details open>
                    <summary style={{ cursor: "pointer", fontWeight: 800 }}>2) Semantic hits (local embeddings)</summary>
                    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                      {searchOut.trace.semantic.map((h) => (
                        <div
                          key={h.chunkId}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            border: "1px solid var(--hairline)",
                            borderRadius: 10,
                            padding: "8px 10px",
                          }}
                        >
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <b>#{h.rank}</b> {h.path}
                          </div>
                          <CodeBadge>{h.score.toFixed(3)}</CodeBadge>
                        </div>
                      ))}
                    </div>
                  </details>

                  <details>
                    <summary style={{ cursor: "pointer", fontWeight: 800 }}>3) Fused candidate pool (RRF)</summary>
                    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                      {searchOut.trace.fused.slice(0, 25).map((h, idx) => (
                        <div
                          key={h.chunkId}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            border: "1px solid var(--hairline)",
                            borderRadius: 10,
                            padding: "8px 10px",
                          }}
                        >
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <b>#{idx + 1}</b> {h.path}
                          </div>
                          <CodeBadge>{h.score.toFixed(4)}</CodeBadge>
                        </div>
                      ))}
                    </div>
                  </details>

                  <details>
                    <summary style={{ cursor: "pointer", fontWeight: 800 }}>4) Reranked list</summary>
                    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                      {searchOut.trace.reranked.slice(0, 25).map((h, idx) => (
                        <div
                          key={h.chunkId}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            border: "1px solid var(--hairline)",
                            borderRadius: 10,
                            padding: "8px 10px",
                          }}
                        >
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <b>#{idx + 1}</b> {h.path}
                          </div>
                          <CodeBadge>{h.score.toFixed(4)}</CodeBadge>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              ) : (
                <div style={{ color: "var(--slate)" }}>
                  Run a query to see the trace. If you only see semantic hits, it usually means lexical didn’t match the exact wording.
                </div>
              )}
            </Card>

            <Card title="Notes">
              <div style={{ color: "var(--slate)", lineHeight: 1.55 }}>
                - Indexing stores chunks + embeddings in <CodeBadge>.astrag</CodeBadge> under this repo.
                <br />- Frontend uses a dev proxy to talk to the backend at <CodeBadge>localhost:8787</CodeBadge>.
                <br />- For small repos, vector search is brute-force cosine (simple + explainable).
              </div>
            </Card>
          </div>
        </div>
      </main>

      <footer style={{ padding: "18px 24px", borderTop: "1px solid var(--hairline)", color: "var(--steel)", fontSize: 13 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>© {year} ASTRAG</div>
      </footer>
    </div>
  );
}

