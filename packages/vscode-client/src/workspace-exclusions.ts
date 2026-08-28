import * as vscode from "vscode";
import { GitIgnoreRules } from "./git-ignore.js";
import type { GitIgnoreFile } from "./git-ignore.js";

const commonArtifactDirectories = new Set([
  ".git",
  "node_modules",
  ".cache",
  "dist",
  "out",
  "coverage",
]);
const ignoreFileSearchExclude = "**/{.git,node_modules,.cache,dist,out,coverage}/**";
const maximumIgnoreFiles = 2_000;

export class WorkspaceExclusions {
  private readonly rulesByFolder: ReadonlyMap<string, GitIgnoreRules>;
  public readonly rootIgnoreSignature: string;

  public constructor(
    rulesByFolder: ReadonlyMap<string, GitIgnoreRules>,
    rootIgnoreSignature: string,
  ) {
    this.rulesByFolder = rulesByFolder;
    this.rootIgnoreSignature = rootIgnoreSignature;
  }

  public excludes(uri: vscode.Uri): boolean {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder === undefined) return false;
    const relative = relativePath(folder.uri, uri);
    if (relative === undefined) return false;
    if (relative.split("/").some((part) => commonArtifactDirectories.has(part))) return true;
    return this.rulesByFolder.get(folder.uri.toString())?.ignores(relative) ?? false;
  }
}

export async function loadWorkspaceExclusions(
  configurationSection: string,
): Promise<WorkspaceExclusions> {
  const entries = await Promise.all(
    (vscode.workspace.workspaceFolders ?? []).map(async (folder) => {
      const key = folder.uri.toString();
      const enabled = vscode.workspace
        .getConfiguration(configurationSection, folder.uri)
        .get<boolean>("index.useIgnoreFiles", true);
      if (!enabled) return { key, rootIgnoreContents: undefined, rules: undefined };
      let uris: readonly vscode.Uri[] = [];
      try {
        uris = await vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, "**/.gitignore"),
          ignoreFileSearchExclude,
          maximumIgnoreFiles,
        );
      } catch {
        // Virtual providers may not implement file search even when reads work.
      }
      const rootIgnoreUri = vscode.Uri.joinPath(folder.uri, ".gitignore");
      const ignoreUris = new Map(
        [rootIgnoreUri, ...uris].map((uri) => [uri.toString(), uri] as const),
      );
      const files = await Promise.all(
        [...ignoreUris.values()].map(async (uri) => {
          const relative = relativePath(folder.uri, uri);
          if (relative === undefined) return undefined;
          try {
            const contents = new TextDecoder("utf-8", { fatal: true }).decode(
              await vscode.workspace.fs.readFile(uri),
            );
            return {
              file: {
                contents,
                directory: relative.includes("/")
                  ? relative.slice(0, relative.lastIndexOf("/"))
                  : "",
              } satisfies GitIgnoreFile,
              uri,
            };
          } catch {
            return undefined;
          }
        }),
      );
      const found = files.filter((entry) => entry !== undefined);
      return {
        key,
        rootIgnoreContents: found.find(({ uri }) => uri.toString() === rootIgnoreUri.toString())
          ?.file.contents,
        rules: new GitIgnoreRules(found.map(({ file }) => file)),
      };
    }),
  );
  return new WorkspaceExclusions(
    new Map(
      entries
        .filter((entry) => entry.rules !== undefined)
        .map(({ key, rules }) => [key, rules] as const),
    ),
    JSON.stringify(entries.map(({ key, rootIgnoreContents }) => [key, rootIgnoreContents ?? null])),
  );
}

export async function loadRootIgnoreSignature(configurationSection: string): Promise<string> {
  const entries = await Promise.all(
    (vscode.workspace.workspaceFolders ?? []).map(async (folder) => {
      const key = folder.uri.toString();
      const enabled = vscode.workspace
        .getConfiguration(configurationSection, folder.uri)
        .get<boolean>("index.useIgnoreFiles", true);
      if (!enabled) return [key, null] as const;
      try {
        const contents = new TextDecoder("utf-8", { fatal: true }).decode(
          await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, ".gitignore")),
        );
        return [key, contents] as const;
      } catch {
        return [key, null] as const;
      }
    }),
  );
  return JSON.stringify(entries);
}

function relativePath(root: vscode.Uri, uri: vscode.Uri): string | undefined {
  if (root.scheme !== uri.scheme || root.authority !== uri.authority) return undefined;
  const rootPath = root.path.replaceAll("\\", "/");
  const candidatePath = uri.path.replaceAll("\\", "/");
  const windowsFileUri = root.scheme === "file" && /^\/[A-Za-z]:\//u.test(rootPath + "/");
  const comparedRoot = windowsFileUri ? rootPath.toLowerCase() : rootPath;
  const comparedCandidate = windowsFileUri ? candidatePath.toLowerCase() : candidatePath;
  const prefix = comparedRoot.endsWith("/") ? comparedRoot : comparedRoot + "/";
  if (!comparedCandidate.startsWith(prefix)) {
    return comparedCandidate === comparedRoot ? "" : undefined;
  }
  return candidatePath.slice(prefix.length);
}
