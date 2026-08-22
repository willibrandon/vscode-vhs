import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import {
  clientOptions,
  registerCommonCommands,
  registerWorkspaceSynchronization,
} from "./common.js";

let client: LanguageClient | undefined;
let serverWorker: Worker | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("VHS Language Server", { log: true });
  const runOutput = vscode.window.createOutputChannel("VHS Run", { log: true });
  const server = vscode.Uri.joinPath(context.extensionUri, "dist", "browserServer.js");
  serverWorker = new Worker(server.toString(true), { name: "VHS Language Server" });
  client = new LanguageClient("vhs", "VHS Language Server", serverWorker, clientOptions(output));
  context.subscriptions.push(output, runOutput, client);
  await client.start();
  const refreshWorkspace = registerWorkspaceSynchronization(context, client, output);
  registerCommonCommands(context, client, output, refreshWorkspace);
  const unavailable = async (): Promise<void> => {
    await vscode.window.showInformationMessage(
      "Running VHS is unavailable in a browser extension host. Language features remain active.",
    );
  };
  for (const command of [
    "vhs.runTape",
    "vhs.runAndPreview",
    "vhs.openPreview",
    "vhs.stopTape",
    "vhs.validateWithInstalledVhs",
  ]) {
    context.subscriptions.push(vscode.commands.registerCommand(command, unavailable));
  }
  context.subscriptions.push(
    vscode.commands.registerCommand("vhs.showRunOutput", (): void => runOutput.show(true)),
  );
  output.info("VHS language server started in a Web Worker.");
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  serverWorker?.terminate();
  client = undefined;
  serverWorker = undefined;
}
