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
  readonly #missing = new Set<string>();
  ready = false;

  replace(files: readonly WorkspaceFile[], missing: readonly string[] = []): void {
    this.#files.clear();
    this.#missing.clear();
    for (const file of files) {
      this.#files.set(file.uri, { text: file.text, tree: parseVhs(file.text), uri: file.uri });
    }
    for (const uri of missing) this.#missing.add(uri);
    this.ready = true;
  }

  isMissing(uri: string): boolean {
    return this.#missing.has(uri);
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

export function workspaceDirectory(sourceUri: string, roots: readonly string[]): URI {
  const source = URI.parse(sourceUri);
  const candidates = roots
    .map((root) => URI.parse(root))
    .filter(
      (root) =>
        root.scheme === source.scheme &&
        root.authority === source.authority &&
        containsPath(root.path, source.path),
    )
    .sort((left, right) => right.path.length - left.path.length);
  return candidates[0] ?? Utils.dirname(source);
}

export function sourceTarget(
  sourceUri: string,
  path: string,
  roots: readonly string[] = [],
): string | undefined {
  if (path.length === 0) return undefined;
  try {
    const source = URI.parse(sourceUri);
    const normalized = path.replaceAll("\\", "/");
    if (normalized.startsWith("/")) return source.with({ path: normalized }).toString();
    const windows = /^([A-Za-z]):\/(.*)$/u.exec(normalized);
    if (windows?.[1] !== undefined)
      return source.with({ path: `/${windows[1].toLowerCase()}:/${windows[2] ?? ""}` }).toString();
    return Utils.resolvePath(workspaceDirectory(sourceUri, roots), normalized).toString();
  } catch {
    return undefined;
  }
}

export function sourceOccurrences(
  files: ReadonlyMap<string, IndexedDocument>,
  roots: readonly string[] = [],
): readonly SourceOccurrence[] {
  const result: SourceOccurrence[] = [];
  for (const document of files.values()) {
    for (const command of document.tree.commands) {
      if (command.name !== "Source") continue;
      const argument = command.arguments[0];
      const value =
        command.arguments.length === 1 &&
        argument !== undefined &&
        ["string", "word"].includes(argument.kind)
          ? argument.value
          : undefined;
      const target = value === undefined ? undefined : sourceTarget(document.uri, value, roots);
      if (target !== undefined) result.push({ command, document, target });
    }
  }
  return result;
}

export function sourceCycle(
  files: ReadonlyMap<string, IndexedDocument>,
  start: string,
  roots: readonly string[] = [],
): boolean {
  const graph = new Map<string, string[]>();
  for (const occurrence of sourceOccurrences(files, roots)) {
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

export function relativeSourcePath(
  fromUri: string,
  toUri: string,
  roots: readonly string[] = [],
): string | undefined {
  try {
    const from = workspaceDirectory(fromUri, roots);
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

function containsPath(rootPath: string, sourcePath: string): boolean {
  const root = rootPath.replace(/\/+$/u, "") || "/";
  return root === "/" || sourcePath === root || sourcePath.startsWith(`${root}/`);
}
