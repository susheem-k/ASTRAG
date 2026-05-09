import path from "node:path";

export function getAstagRoot() {
  // Workspace-local store for MVP.
  return path.resolve(process.cwd(), ".astrag");
}

export function getProjectsRoot() {
  return path.join(getAstagRoot(), "projects");
}

export function getProjectRoot(projectId: string) {
  return path.join(getProjectsRoot(), projectId);
}

export function getProjectDbPath(projectId: string) {
  return path.join(getProjectRoot(projectId), "index.sqlite");
}

export function getProjectMetaPath(projectId: string) {
  return path.join(getProjectRoot(projectId), "project.json");
}

