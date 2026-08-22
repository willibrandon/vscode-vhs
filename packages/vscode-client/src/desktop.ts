import { artifactReferences, parseVhs } from "@vhs/language-core";
import type { ArtifactReference } from "@vhs/language-core";
import * as vscode from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import type { ServerOptions } from "vscode-languageclient/node";
import {
  clientOptions,
  registerCommonCommands,
  registerWorkspaceSynchronization,
} from "./common.js";
import { openArtifactPreview } from "./preview.js";
import { runVhs } from "./runner.js";
import type { VhsRunResult } from "./runner.js";

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("VHS Language Server", { log: true });
  const runOutput = vscode.window.createOutputChannel("VHS Run", { log: true });
  const module = vscode.Uri.joinPath(context.extensionUri, "dist", "nodeServer.cjs").fsPath;
  const serverOptions: ServerOptions = { module, transport: TransportKind.ipc };
  client = new LanguageClient("vhs", "VHS Language Server", serverOptions, clientOptions(output));
  const languageClient = client;
  context.subscriptions.push(output, runOutput, languageClient);
  await languageClient.start();
  const refreshWorkspace = registerWorkspaceSynchronization(context, languageClient, output);
  registerCommonCommands(context, languageClient, output, refreshWorkspace);

  const active = new Map<string, AbortController>();
  const externalDiagnostics = vscode.languages.createDiagnosticCollection("vhs-installed");
  context.subscriptions.push(externalDiagnostics, {
    dispose(): void {
      for (const controller of active.values()) controller.abort();
      active.clear();
    },
  });

  const stop = async (): Promise<void> => {
    for (const controller of active.values()) controller.abort();
    active.clear();
    await vscode.commands.executeCommand("setContext", "vhs.running", false);
    runOutput.info("Stopped VHS tape jobs.");
  };

  const detectVersion = async (): Promise<void> => {
    if (
      !vscode.workspace.isTrusted ||
      vscode.workspace.getConfiguration("vhs").get<string>("targetVersion", "latest") !== "auto"
    ) {
      await languageClient.sendNotification("vhs/detectedVersion", {});
      return;
    }
    try {
      const scope =
        vscode.window.activeTextEditor?.document.uri ??
        vscode.workspace.workspaceFolders?.[0]?.uri ??
        context.extensionUri;
      const result = await runVhs(
        {
          arguments: ["--version"],
          command: configuredExecutable(scope),
          cwd:
            scope.scheme === "file"
              ? vscode.Uri.joinPath(scope, "..").fsPath
              : context.extensionUri.fsPath,
          timeoutMs: 10_000,
        },
        new AbortController().signal,
        () => vscode.workspace.isTrusted,
      );
      const match = /v?(\d+\.\d+\.\d+)/u.exec(`${result.stdout}\n${result.stderr}`);
      if (result.code === 0 && match?.[1] !== undefined) {
        output.info(`Detected VHS ${match[1]}.`);
        await languageClient.sendNotification("vhs/detectedVersion", { version: match[1] });
      } else {
        output.warn(
          "Could not detect the installed VHS version; using the bundled language version.",
        );
        await languageClient.sendNotification("vhs/detectedVersion", {});
      }
    } catch (error) {
      output.warn(`Could not detect the installed VHS version: ${safeMessage(error)}`);
      await languageClient.sendNotification("vhs/detectedVersion", {});
    }
  };

  const execute = async (preview: boolean): Promise<void> => {
    let document = vscode.window.activeTextEditor?.document;
    const unavailable = executionUnavailable(document);
    if (unavailable !== undefined) {
      await vscode.window.showInformationMessage(unavailable);
      return;
    }
    if (document === undefined) return;
    if (document.isUntitled) {
      const saved = await document.save();
      if (!saved) return;
      document = vscode.window.activeTextEditor?.document;
      if (document === undefined || document.isUntitled) return;
    }
    if (active.size >= 2) {
      await vscode.window.showWarningMessage("Two VHS tape jobs are already running.");
      return;
    }
    const tree = parseVhs(document.getText());
    const errors = tree.diagnostics.filter(({ severity }) => severity === "error");
    if (errors.length > 0) {
      await vscode.window.showWarningMessage(
        `Fix ${errors.length} VHS error${errors.length === 1 ? "" : "s"} before running the tape.`,
      );
      return;
    }
    const key = document.uri.toString();
    active.get(key)?.abort();
    const controller = new AbortController();
    active.set(key, controller);
    await vscode.commands.executeCommand("setContext", "vhs.running", true);
    const command = configuredExecutable(document.uri);
    const cwd = vscode.Uri.joinPath(document.uri, "..").fsPath;
    runOutput.info(`Running ${command} -`);
    runOutput.info(`Working directory: ${cwd}`);
    for (const dirtySource of dirtySources(document))
      runOutput.warn(`Using the saved source tape: ${dirtySource.fsPath}`);
    try {
      const result = await runVhs(
        { arguments: ["-"], command, cwd, input: document.getText() },
        controller.signal,
        () => vscode.workspace.isTrusted,
      );
      logResult(runOutput, result);
      if (result.cancelled) return;
      if (result.code !== 0) {
        await vscode.window.showErrorMessage(
          `VHS failed with exit code ${String(result.code)}. See VHS Run output.`,
        );
        return;
      }
      if (preview) await openArtifactPreview(document, await allArtifacts(document), runOutput);
      else await vscode.window.showInformationMessage("VHS finished the tape.");
    } catch (error) {
      runOutput.error(safeMessage(error));
      if (!controller.signal.aborted)
        await vscode.window.showErrorMessage(`VHS failed: ${safeMessage(error)}`);
    } finally {
      if (active.get(key) === controller) active.delete(key);
      await vscode.commands.executeCommand("setContext", "vhs.running", active.size > 0);
    }
  };

  const validate = async (
    document: vscode.TextDocument | undefined,
    explicit: boolean,
  ): Promise<void> => {
    const unavailable = validationUnavailable(document);
    if (unavailable !== undefined) {
      if (explicit) await vscode.window.showInformationMessage(unavailable);
      return;
    }
    if (document === undefined) return;
    const controller = new AbortController();
    const key = `validate:${document.uri.toString()}`;
    active.get(key)?.abort();
    active.set(key, controller);
    runOutput.info(`Validating ${document.uri.fsPath}`);
    try {
      const result = await runVhs(
        {
          arguments: ["validate", document.uri.fsPath],
          command: configuredExecutable(document.uri),
          cwd: vscode.Uri.joinPath(document.uri, "..").fsPath,
          timeoutMs: 30_000,
        },
        controller.signal,
        () => vscode.workspace.isTrusted,
      );
      logResult(runOutput, result);
      if (result.cancelled || active.get(key) !== controller) return;
      externalDiagnostics.set(document.uri, installedDiagnostics(document, result));
      if (explicit) {
        if (result.code === 0)
          await vscode.window.showInformationMessage("Installed VHS accepted this tape.");
        else
          await vscode.window.showWarningMessage(
            "Installed VHS rejected this tape. See VHS Run output.",
          );
      }
    } catch (error) {
      externalDiagnostics.delete(document.uri);
      if (explicit && !controller.signal.aborted)
        await vscode.window.showErrorMessage(`VHS validation failed: ${safeMessage(error)}`);
    } finally {
      if (active.get(key) === controller) active.delete(key);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("vhs.runTape", () => execute(false)),
    vscode.commands.registerCommand("vhs.runAndPreview", () => execute(true)),
    vscode.commands.registerCommand("vhs.openPreview", async (): Promise<void> => {
      const document = vscode.window.activeTextEditor?.document;
      if (document?.languageId !== "vhs" || document.uri.scheme !== "file") {
        await vscode.window.showInformationMessage("Open a saved VHS tape first.");
        return;
      }
      await openArtifactPreview(document, await allArtifacts(document), runOutput);
    }),
    vscode.commands.registerCommand("vhs.stopTape", stop),
    vscode.commands.registerCommand("vhs.validateWithInstalledVhs", () =>
      validate(vscode.window.activeTextEditor?.document, true),
    ),
    vscode.commands.registerCommand("vhs.showRunOutput", (): void => runOutput.show(true)),
    vscode.workspace.onDidSaveTextDocument(async (document): Promise<void> => {
      if (
        document.languageId === "vhs" &&
        vscode.workspace
          .getConfiguration("vhs", document.uri)
          .get<string>("externalValidation.mode", "off") === "onSave"
      )
        await validate(document, false);
    }),
    vscode.workspace.onDidChangeTextDocument(({ document }): void => {
      if (document.languageId === "vhs") externalDiagnostics.delete(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((event): void => {
      if (
        event.affectsConfiguration("vhs.targetVersion") ||
        event.affectsConfiguration("vhs.executablePath")
      )
        void detectVersion();
    }),
  );
  void detectVersion();
  output.info("VHS language server started.");
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
}

function configuredExecutable(scope: vscode.Uri): string {
  const value = vscode.workspace
    .getConfiguration("vhs", scope)
    .get<unknown>("executablePath", "vhs");
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error("vhs.executablePath must be a command path.");
  return value;
}

function executionUnavailable(document: vscode.TextDocument | undefined): string | undefined {
  if (document?.languageId !== "vhs") return "Open a VHS tape first.";
  if (!vscode.workspace.isTrusted) return "Trust this workspace before running VHS.";
  if (document.uri.scheme !== "file" && !document.isUntitled)
    return "Running VHS requires a local or remote file.";
  return undefined;
}

function validationUnavailable(document: vscode.TextDocument | undefined): string | undefined {
  const execution = executionUnavailable(document);
  if (execution !== undefined) return execution;
  if (document?.isUntitled === true || document?.isDirty === true)
    return "Save this tape before validating it with installed VHS.";
  return undefined;
}

function dirtySources(document: vscode.TextDocument): readonly vscode.Uri[] {
  const sources = new Set(
    parseVhs(document.getText())
      .commands.filter(({ name }) => name === "Source")
      .map(({ arguments: args }) => args[0]?.value)
      .filter((value): value is string => value !== undefined),
  );
  return vscode.workspace.textDocuments
    .filter(
      (candidate) => candidate.isDirty && sources.has(relativeName(document.uri, candidate.uri)),
    )
    .map(({ uri }) => uri);
}

const relativeName = (from: vscode.Uri, to: vscode.Uri): string => {
  const base = vscode.Uri.joinPath(from, "..").path;
  return to.path.startsWith(`${base}/`) ? to.path.slice(base.length + 1) : "";
};

async function allArtifacts(document: vscode.TextDocument): Promise<readonly ArtifactReference[]> {
  const result = [...artifactReferences(parseVhs(document.getText()))];
  for (const command of parseVhs(document.getText()).commands) {
    const path = command.name === "Source" ? command.arguments[0]?.value : undefined;
    if (path === undefined || path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path)) continue;
    try {
      const uri = vscode.Uri.joinPath(document.uri, "..", ...path.replaceAll("\\", "/").split("/"));
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      result.push(
        ...artifactReferences(parseVhs(text)).filter(({ kind }) => kind === "screenshot"),
      );
    } catch {
      // The language server reports missing source files.
    }
  }
  return result;
}

function logResult(output: vscode.LogOutputChannel, result: VhsRunResult): void {
  if (result.stdout.length > 0) output.info(result.stdout.trimEnd());
  if (result.stderr.length > 0) output.warn(result.stderr.trimEnd());
  if (result.truncated) output.warn("VHS output was truncated at 1 MiB per stream.");
  output.info(
    `VHS exited ${String(result.code)} after ${String(result.durationMs)} ms${result.cancelled ? " (cancelled)" : ""}.`,
  );
}

function installedDiagnostics(
  document: vscode.TextDocument,
  result: VhsRunResult,
): vscode.Diagnostic[] {
  if (result.code === 0 || result.cancelled) return [];
  const message = (result.stderr || result.stdout || "Installed VHS rejected this tape.")
    .trim()
    .slice(0, 4_096);
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(0, 0, Math.max(0, document.lineCount - 1), 0),
    message,
    vscode.DiagnosticSeverity.Error,
  );
  diagnostic.source = "Installed VHS";
  return [diagnostic];
}

const safeMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
