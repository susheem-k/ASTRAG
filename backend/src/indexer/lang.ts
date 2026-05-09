export type Lang = "ts" | "tsx" | "js" | "jsx" | "json" | "md" | "txt" | "other";

export function inferLangByPath(relPath: string): Lang {
  const lower = relPath.toLowerCase();
  if (lower.endsWith(".ts")) return "ts";
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".js")) return "js";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "md";
  if (lower.endsWith(".txt")) return "txt";
  return "other";
}

