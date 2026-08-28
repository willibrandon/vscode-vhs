import { parseVhs } from "@vhs/language-core";
import * as vscode from "vscode";
import type { BaseLanguageClient, LanguageClientOptions } from "vscode-languageclient";
import { loadRootIgnoreSignature, loadWorkspaceExclusions } from "./workspace-exclusions.js";

export const VHS_LANGUAGE_IDS: readonly string[] = ["vhs"];

export function clientOptions(output: vscode.LogOutputChannel): LanguageClientOptions {
  return {
    documentSelector: VHS_LANGUAGE_IDS.map((language) => ({ language })),
    markdown: { isTrusted: false },
    outputChannel: output,
    synchronize: { configurationSection: "vhs" },
  };
}

export function registerCommonCommands(
  context: vscode.ExtensionContext,
  client: BaseLanguageClient,
  output: vscode.LogOutputChannel,
  refreshWorkspace: () => Promise<void>,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("vhs.restartLanguageServer", async (): Promise<void> => {
      output.info("Restarting VHS language server.");
      await client.stop();
      await client.start();
      await refreshWorkspace();
      output.info("VHS language server restarted.");
    }),
    vscode.commands.registerCommand("vhs.showLanguageServerOutput", (): void => output.show(true)),
    vscode.commands.registerCommand("vhs.openDocumentation", async (): Promise<void> => {
      await vscode.env.openExternal(vscode.Uri.parse("https://willibrandon.github.io/vscode-vhs/"));
    }),
  );
}

interface WorkspaceFile {
  readonly text: string;
  readonly uri: string;
}

interface WorkspaceSnapshot {
  readonly files: readonly WorkspaceFile[];
  readonly missing: readonly string[];
  readonly rootIgnoreSignature: string;
}

export function registerWorkspaceSynchronization(
  context: vscode.ExtensionContext,
  client: BaseLanguageClient,
  output: vscode.LogOutputChannel,
): () => Promise<void> {
  let generation = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let checkingRootIgnore = false;
  let lastRootIgnoreSignature: string | undefined;
  const refresh = async (): Promise<void> => {
    const current = ++generation;
    const { files, missing, rootIgnoreSignature } = await workspaceFiles();
    if (current !== generation) return;
    lastRootIgnoreSignature = rootIgnoreSignature;
    const roots = vscode.workspace.workspaceFolders?.map(({ uri }) => uri.toString()) ?? [];
    await client.sendNotification("vhs/workspaceFiles", { files, missing, roots });
    output.debug(`Indexed ${files.length} VHS tape files.`);
  };
  const schedule = (): void => {
    if (debounce !== undefined) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      void refresh();
    }, 150);
  };
  const checkRootIgnore = async (): Promise<void> => {
    if (checkingRootIgnore) return;
    checkingRootIgnore = true;
    try {
      const signature = await loadRootIgnoreSignature("vhs");
      if (lastRootIgnoreSignature !== undefined && signature !== lastRootIgnoreSignature)
        schedule();
    } finally {
      checkingRootIgnore = false;
    }
  };
  // VS Code's macOS watcher can occasionally drop a root .gitignore write while a workspace is
  // settling. Reading only the root ignore files provides a cheap repair path without periodically
  // re-indexing every tape file.
  const rootIgnorePoll = setInterval(() => void checkRootIgnore(), 1_000);
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.tape");
  const ignoreWatcher = vscode.workspace.createFileSystemWatcher("**/.gitignore");
  const rootIgnoreWatchers = new Map<string, vscode.Disposable>();
  const watchRootIgnoreFile = (folder: vscode.WorkspaceFolder): void => {
    const key = folder.uri.toString();
    if (rootIgnoreWatchers.has(key)) return;
    // A simple RelativePattern uses a dedicated non-recursive watcher. Keep it alongside the
    // recursive watcher so root .gitignore writes are not lost while a newly opened workspace is
    // still settling (notably on macOS).
    const rootIgnoreWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, ".gitignore"),
    );
    rootIgnoreWatchers.set(
      key,
      vscode.Disposable.from(
        rootIgnoreWatcher,
        rootIgnoreWatcher.onDidCreate(schedule),
        rootIgnoreWatcher.onDidChange(schedule),
        rootIgnoreWatcher.onDidDelete(schedule),
      ),
    );
  };
  for (const folder of vscode.workspace.workspaceFolders ?? []) watchRootIgnoreFile(folder);
  context.subscriptions.push(
    watcher,
    ignoreWatcher,
    watcher.onDidCreate(schedule),
    watcher.onDidChange(schedule),
    watcher.onDidDelete(schedule),
    ignoreWatcher.onDidCreate(schedule),
    ignoreWatcher.onDidChange(schedule),
    ignoreWatcher.onDidDelete(schedule),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.languageId === "vhs") schedule();
    }),
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (document.languageId === "vhs" || isGitIgnoreUri(document.uri)) schedule();
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.languageId === "vhs" || isGitIgnoreUri(document.uri)) schedule();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(({ added, removed }) => {
      for (const folder of removed) {
        rootIgnoreWatchers.get(folder.uri.toString())?.dispose();
        rootIgnoreWatchers.delete(folder.uri.toString());
      }
      for (const folder of added) watchRootIgnoreFile(folder);
      schedule();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("vhs.index.useIgnoreFiles") ||
        event.affectsConfiguration("files.exclude")
      ) {
        schedule();
      }
    }),
    {
      dispose(): void {
        generation += 1;
        if (debounce !== undefined) clearTimeout(debounce);
        clearInterval(rootIgnorePoll);
        for (const watcher of rootIgnoreWatchers.values()) watcher.dispose();
        rootIgnoreWatchers.clear();
      },
    },
  );
  void refresh();
  return refresh;
}

function isGitIgnoreUri(uri: vscode.Uri): boolean {
  return uri.path.replaceAll("\\", "/").endsWith("/.gitignore");
}

async function workspaceFiles(): Promise<WorkspaceSnapshot> {
  const exclusions = await loadWorkspaceExclusions("vhs");
  const discovered = (await vscode.workspace.findFiles("**/*.tape", undefined, 2_000)).filter(
    (uri) => !exclusions.excludes(uri),
  );
  const open = new Map(
    vscode.workspace.textDocuments
      .filter((document) => document.languageId === "vhs" && !document.isUntitled)
      .map((document) => [document.uri.toString(), document] as const),
  );
  const seeds = [...discovered, ...[...open.values()].map(({ uri }) => uri)].filter(
    (uri, index, items) => items.findIndex((item) => item.toString() === uri.toString()) === index,
  );
  const pending = [...seeds];
  const seen = new Set<string>();
  const missing = new Set<string>();
  const files: WorkspaceFile[] = [];
  let totalBytes = 0;
  while (pending.length > 0 && files.length < 2_000 && totalBytes < 16_777_216) {
    const uri = pending.shift();
    if (uri === undefined || seen.has(uri.toString())) continue;
    seen.add(uri.toString());
    try {
      const openDocument = open.get(uri.toString());
      const bytes =
        openDocument === undefined
          ? await vscode.workspace.fs.readFile(uri)
          : new TextEncoder().encode(openDocument.getText());
      if (bytes.byteLength > 1_048_576) continue;
      totalBytes += bytes.byteLength;
      if (totalBytes > 16_777_216) break;
      const text = new TextDecoder().decode(bytes);
      files.push({ text, uri: uri.toString() });
      for (const command of parseVhs(text).commands) {
        const argument = command.arguments[0];
        const path =
          command.name === "Source" &&
          command.arguments.length === 1 &&
          argument !== undefined &&
          ["string", "word"].includes(argument.kind)
            ? argument.value
            : undefined;
        if (path === undefined || path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path)) continue;
        const target = resolveVhsPath(uri, path);
        if (target === undefined) continue;
        if (!seen.has(target.toString())) pending.push(target);
      }
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound")
        missing.add(uri.toString());
    }
  }
  return {
    files: files.sort((left, right) => left.uri.localeCompare(right.uri)),
    missing: [...missing].sort(),
    rootIgnoreSignature: exclusions.rootIgnoreSignature,
  };
}

export function vhsWorkingDirectory(resource: vscode.Uri): vscode.Uri {
  return vscode.workspace.getWorkspaceFolder(resource)?.uri ?? vscode.Uri.joinPath(resource, "..");
}

export function resolveVhsPath(resource: vscode.Uri, path: string): vscode.Uri | undefined {
  if (path.length === 0) return undefined;
  const normalized = path.replaceAll("\\", "/");
  if (normalized.startsWith("/")) return resource.with({ path: normalized });
  const windows = /^([A-Za-z]):\/(.*)$/u.exec(normalized);
  if (windows?.[1] !== undefined)
    return resource.with({ path: `/${windows[1].toLowerCase()}:/${windows[2] ?? ""}` });
  return vscode.Uri.joinPath(vhsWorkingDirectory(resource), ...normalized.split("/"));
}
