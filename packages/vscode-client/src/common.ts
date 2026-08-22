import { parseVhs } from "@vhs/language-core";
import * as vscode from "vscode";
import type { BaseLanguageClient, LanguageClientOptions } from "vscode-languageclient";

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

export function registerWorkspaceSynchronization(
  context: vscode.ExtensionContext,
  client: BaseLanguageClient,
  output: vscode.LogOutputChannel,
): () => Promise<void> {
  let generation = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const refresh = async (): Promise<void> => {
    const current = ++generation;
    const files = await workspaceFiles();
    if (current !== generation) return;
    await client.sendNotification("vhs/workspaceFiles", { files });
    output.debug(`Indexed ${files.length} VHS tape files.`);
  };
  const schedule = (): void => {
    if (debounce !== undefined) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      void refresh();
    }, 150);
  };
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.tape");
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(schedule),
    watcher.onDidChange(schedule),
    watcher.onDidDelete(schedule),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.languageId === "vhs") schedule();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(schedule),
    {
      dispose(): void {
        generation += 1;
        if (debounce !== undefined) clearTimeout(debounce);
      },
    },
  );
  void refresh();
  return refresh;
}

async function workspaceFiles(): Promise<readonly WorkspaceFile[]> {
  const seeds = await vscode.workspace.findFiles(
    "**/*.tape",
    "**/{.git,node_modules,.cache,dist,coverage}/**",
    2_000,
  );
  const pending = [...seeds];
  const seen = new Set<string>();
  const files: WorkspaceFile[] = [];
  let totalBytes = 0;
  while (pending.length > 0 && files.length < 2_000 && totalBytes < 16_777_216) {
    const uri = pending.shift();
    if (uri === undefined || seen.has(uri.toString())) continue;
    seen.add(uri.toString());
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > 1_048_576) continue;
      totalBytes += bytes.byteLength;
      if (totalBytes > 16_777_216) break;
      const text = new TextDecoder().decode(bytes);
      files.push({ text, uri: uri.toString() });
      for (const command of parseVhs(text).commands) {
        const path = command.name === "Source" ? command.arguments[0]?.value : undefined;
        if (path === undefined || path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path)) continue;
        const target = vscode.Uri.joinPath(uri, "..", ...path.replaceAll("\\", "/").split("/"));
        if (!seen.has(target.toString())) pending.push(target);
      }
    } catch {
      // Missing source files are diagnosed by the language server.
    }
  }
  return files.sort((left, right) => left.uri.localeCompare(right.uri));
}
