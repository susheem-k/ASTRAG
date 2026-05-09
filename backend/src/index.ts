import cors from "cors";
import express from "express";
import { z } from "zod";
import { createProject, getProject, listProjects } from "./projects/registry";
import { indexProjectOnce, type IndexProgress } from "./indexer/indexProject";
import { searchProject } from "./search/searchProject";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "astrag-backend" });
});

const indexRuns = new Map<
  string,
  { running: boolean; progress: IndexProgress; startedAt: string; finishedAt?: string; error?: string }
>();

app.get("/api/projects", async (_req, res) => {
  res.json({ projects: await listProjects() });
});

app.post("/api/projects", async (req, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      rootPath: z.string().min(1),
    })
    .parse(req.body);

  const project = await createProject(body);
  res.json({ project });
});

app.get("/api/projects/:projectId", async (req, res) => {
  const project = await getProject(req.params.projectId);
  res.json({ project });
});

app.post("/api/projects/:projectId/index", async (req, res) => {
  const projectId = req.params.projectId;
  const project = await getProject(projectId);

  const existing = indexRuns.get(projectId);
  if (existing?.running) {
    return res.status(409).json({ error: "index_already_running" });
  }

  const run: (typeof existing) & {
    running: boolean;
    progress: IndexProgress;
    startedAt: string;
  } = {
    running: true,
    startedAt: new Date().toISOString(),
    progress: {
      phase: "scanning",
      totalFiles: 0,
      processedFiles: 0,
      updatedFiles: 0,
      deletedFiles: 0,
      chunksUpserted: 0,
      chunksDeleted: 0,
    },
  };
  indexRuns.set(projectId, run);

  void (async () => {
    try {
      await indexProjectOnce({
        projectId,
        rootPath: project.rootPath,
        onProgress: (p) => {
          const cur = indexRuns.get(projectId);
          if (!cur) return;
          cur.progress = p;
        },
      });
      const cur = indexRuns.get(projectId);
      if (cur) {
        cur.running = false;
        cur.finishedAt = new Date().toISOString();
      }
    } catch (e) {
      const cur = indexRuns.get(projectId);
      if (cur) {
        cur.running = false;
        cur.error = e instanceof Error ? e.message : String(e);
        cur.finishedAt = new Date().toISOString();
      }
    }
  })();

  res.json({ ok: true });
});

app.get("/api/projects/:projectId/index/status", async (req, res) => {
  const projectId = req.params.projectId;
  const run = indexRuns.get(projectId);
  res.json({
    run: run ?? null,
  });
});

app.post("/api/projects/:projectId/search", async (req, res) => {
  const projectId = req.params.projectId;
  await getProject(projectId); // validate exists
  const body = z
    .object({
      query: z.string().min(1),
      topK: z.number().int().min(1).max(25).optional(),
    })
    .parse(req.body);

  const out = await searchProject({ projectId, query: body.query, topK: body.topK });
  res.json(out);
});

const port = process.env.PORT ? Number(process.env.PORT) : 8787;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[astrag] backend listening on :${port}`);
});

