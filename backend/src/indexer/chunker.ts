import ts from "typescript";
import { sha256Hex } from "./hash";
import type { Lang } from "./lang";

export type Chunk = {
  chunkId: string;
  path: string;
  lang: Lang;
  startLine: number;
  endLine: number;
  symbolName?: string;
  symbolKind?: string;
  signature?: string;
  chunkHash: string;
  chunkText: string;
};

function getLine(file: ts.SourceFile, pos: number) {
  return file.getLineAndCharacterOfPosition(pos).line + 1;
}

function safeSlice(text: string, start: number, end: number) {
  return text.slice(Math.max(0, start), Math.min(text.length, end));
}

export function chunkTypescriptOrFallback(params: {
  relPath: string;
  lang: Lang;
  content: string;
}): { chunks: Chunk[]; parseStatus: "ok" | "fallback" } {
  const { relPath, lang, content } = params;
  const isTsLike = lang === "ts" || lang === "tsx" || lang === "js" || lang === "jsx";

  if (!isTsLike) {
    return { chunks: chunkByWindow({ relPath, lang, content }), parseStatus: "fallback" };
  }

  try {
    const sourceFile = ts.createSourceFile(
      relPath,
      content,
      ts.ScriptTarget.Latest,
      true,
      lang === "tsx" || lang === "jsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const chunks: Chunk[] = [];
    const visit = (node: ts.Node) => {
      const kind = ts.SyntaxKind[node.kind];

      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node)
      ) {
        const start = node.getStart(sourceFile, false);
        const end = node.getEnd();
        const startLine = getLine(sourceFile, start);
        const endLine = getLine(sourceFile, end);

        let symbolName: string | undefined;
        let signature: string | undefined;
        let symbolKind: string | undefined;

        if (ts.isClassDeclaration(node)) {
          symbolKind = "class";
          symbolName = node.name?.getText(sourceFile) ?? undefined;
        } else if (ts.isMethodDeclaration(node)) {
          symbolKind = "method";
          symbolName = node.name?.getText(sourceFile) ?? undefined;
        } else if (ts.isFunctionDeclaration(node)) {
          symbolKind = "function";
          symbolName = node.name?.getText(sourceFile) ?? undefined;
        } else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
          symbolKind = "function_like";
          symbolName = undefined;
        }

        if ("parameters" in node && Array.isArray((node as any).parameters)) {
          const paramsText = (node as any).parameters
            .map((p: ts.ParameterDeclaration) => p.getText(sourceFile))
            .join(", ");
          signature = `(${paramsText})`;
        }

        // avoid gigantic chunks in MVP: cap to ~12k chars
        const body = safeSlice(content, start, Math.min(end, start + 12_000));
        const chunkText = [
          `path: ${relPath}`,
          `lang: ${lang}`,
          symbolKind ? `kind: ${symbolKind}` : "",
          symbolName ? `symbol: ${symbolName}` : "",
          signature ? `signature: ${signature}` : "",
          "",
          "code:",
          body,
        ]
          .filter(Boolean)
          .join("\n");

        const stableKey = `${relPath}|${symbolKind ?? "chunk"}|${symbolName ?? ""}|${startLine}|${endLine}`;
        const chunkId = sha256Hex(stableKey);
        const chunkHash = sha256Hex(chunkText);

        chunks.push({
          chunkId,
          path: relPath,
          lang,
          startLine,
          endLine,
          symbolName,
          symbolKind,
          signature,
          chunkHash,
          chunkText,
        });

        // Don’t descend into this node; we index it as a unit.
        return;
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    if (chunks.length === 0) {
      return { chunks: chunkByWindow({ relPath, lang, content }), parseStatus: "fallback" };
    }

    return { chunks, parseStatus: "ok" };
  } catch {
    return { chunks: chunkByWindow({ relPath, lang, content }), parseStatus: "fallback" };
  }
}

export function chunkByWindow(params: {
  relPath: string;
  lang: Lang;
  content: string;
  linesPerChunk?: number;
  overlapLines?: number;
}): Chunk[] {
  const { relPath, lang, content } = params;
  const linesPerChunk = params.linesPerChunk ?? 120;
  const overlapLines = params.overlapLines ?? 20;

  const lines = content.split("\n");
  const chunks: Chunk[] = [];

  let start = 0;
  while (start < lines.length) {
    const end = Math.min(lines.length, start + linesPerChunk);
    const body = lines.slice(start, end).join("\n");

    const startLine = start + 1;
    const endLine = end;
    const chunkText = [`path: ${relPath}`, `lang: ${lang}`, `kind: window`, "", "code:", body].join(
      "\n",
    );

    const stableKey = `${relPath}|window|${startLine}|${endLine}`;
    const chunkId = sha256Hex(stableKey);
    const chunkHash = sha256Hex(chunkText);

    chunks.push({
      chunkId,
      path: relPath,
      lang,
      startLine,
      endLine,
      symbolKind: "window",
      chunkHash,
      chunkText,
    });

    if (end === lines.length) break;
    start = Math.max(0, end - overlapLines);
  }

  return chunks;
}

