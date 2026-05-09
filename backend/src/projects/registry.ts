import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getProjectMetaPath, getProjectRoot, getProjectsRoot } from "../storage/projectPaths";
import type { Project } from "./types";

export async function ensureProjectsRoot() {
  await fs.mkdir(getProjectsRoot(), { recursive: true });
}

export async function createProject(params: { name: string; rootPath: string }): Promise<Project> {
  await ensureProjectsRoot();
  const id = randomUUID();
  const project: Project = {
    id,
    name: params.name,
    rootPath: path.resolve(params.rootPath),
    createdAt: new Date().toISOString(),
  };

  await fs.mkdir(getProjectRoot(id), { recursive: true });
  await fs.writeFile(getProjectMetaPath(id), JSON.stringify(project, null, 2));
  return project;
}

export async function getProject(projectId: string): Promise<Project> {
  const raw = await fs.readFile(getProjectMetaPath(projectId), "utf8");
  return JSON.parse(raw) as Project;
}

export async function listProjects(): Promise<Project[]> {
  await ensureProjectsRoot();
  const entries = await fs.readdir(getProjectsRoot(), { withFileTypes: true });
  const projects: Project[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    try {
      projects.push(await getProject(ent.name));
    } catch {
      // ignore corrupted entries in MVP
    }
  }
  projects.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return projects;
}

