import { parseVhs } from "@vhs/language-core";
import type { CommandNode, VhsDocument } from "@vhs/language-core";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { URI, Utils } from "vscode-uri";

export interface WorkspaceFile {
  readonly text: string;
  readonly uri: string;
}

export interface IndexedDocument {
  readonly text: string;
  readonly tree: VhsDocument;
  readonly uri: string;
}

export interface SourceOccurrence {
  readonly command: CommandNode;
  readonly document: IndexedDocument;
  readonly target: string;
}

export class WorkspaceIndex {
  readonly #files = new Map<string, IndexedDocument>();
  ready = false;

  replace(files: readonly WorkspaceFile[]): void {
    this.#files.clear();
    for (const file of files) {
      this.#files.set(file.uri, { text: file.text, tree: parseVhs(file.text), uri: file.uri });
    }
    this.ready = true;
  }

  merged(open: readonly TextDocument[]): ReadonlyMap<string, IndexedDocument> {
    const result = new Map(this.#files);
    for (const document of open) {
      const text = document.getText();
      result.set(document.uri, { text, tree: parseVhs(text), uri: document.uri });
    }
    return result;
  }
}

export function sourceTarget(sourceUri: string, path: string): string | undefined {
  if (path.length === 0 || path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path)) return undefined;
  try {
    return Utils.resolvePath(
      Utils.dirname(URI.parse(sourceUri)),
      path.replaceAll("\\", "/"),
    ).toString();
  } catch {
    return undefined;
  }
}

export function sourceOccurrences(
  files: ReadonlyMap<string, IndexedDocument>,
): readonly SourceOccurrence[] {
  const result: SourceOccurrence[] = [];
  for (const document of files.values()) {
    for (const command of document.tree.commands) {
      if (command.name !== "Source") continue;
      const value = command.arguments[0]?.value;
      const target = value === undefined ? undefined : sourceTarget(document.uri, value);
      if (target !== undefined) result.push({ command, document, target });
    }
  }
  return result;
}

export function sourceCycle(files: ReadonlyMap<string, IndexedDocument>, start: string): boolean {
  const graph = new Map<string, string[]>();
  for (const occurrence of sourceOccurrences(files)) {
    const targets = graph.get(occurrence.document.uri) ?? [];
    targets.push(occurrence.target);
    graph.set(occurrence.document.uri, targets);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (uri: string): boolean => {
    if (visiting.has(uri)) return true;
    if (visited.has(uri)) return false;
    visiting.add(uri);
    for (const target of graph.get(uri) ?? []) if (visit(target)) return true;
    visiting.delete(uri);
    visited.add(uri);
    return false;
  };
  return visit(start);
}

export function relativeSourcePath(fromUri: string, toUri: string): string | undefined {
  try {
    const from = Utils.dirname(URI.parse(fromUri));
    const to = URI.parse(toUri);
    if (from.scheme !== to.scheme || from.authority !== to.authority) return undefined;
    const fromParts = from.path.split("/").filter(Boolean);
    const toParts = to.path.split("/").filter(Boolean);
    while (fromParts[0] === toParts[0]) {
      fromParts.shift();
      toParts.shift();
    }
    const path = [...fromParts.map(() => ".."), ...toParts].join("/");
    return path === "" ? Utils.basename(to) : path;
  } catch {
    return undefined;
  }
}
