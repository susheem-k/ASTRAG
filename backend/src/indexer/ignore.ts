const defaultIgnoreDirNames = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".cache",
  ".idea",
  ".vscode",
]);

export function shouldIgnorePath(relPath: string) {
  const parts = relPath.split("/").filter(Boolean);
  if (parts.some((p) => defaultIgnoreDirNames.has(p))) return true;
  if (relPath.endsWith(".lock")) return true;
  if (relPath.endsWith(".min.js")) return true;
  return false;
}

export function isProbablyBinaryByExtension(relPath: string) {
  const lower = relPath.toLowerCase();
  return (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".pdf") ||
    lower.endsWith(".zip") ||
    lower.endsWith(".gz") ||
    lower.endsWith(".tgz") ||
    lower.endsWith(".wasm")
  );
}

