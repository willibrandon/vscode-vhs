import type { ArtifactReference } from "@vhs/language-core";
import * as vscode from "vscode";

interface PreviewArtifact extends ArtifactReference {
  readonly uri: vscode.Uri;
}

const panels = new Map<string, vscode.WebviewPanel>();

export async function openArtifactPreview(
  document: vscode.TextDocument,
  references: readonly ArtifactReference[],
  output: vscode.LogOutputChannel,
): Promise<void> {
  const artifacts = await existingArtifacts(document.uri, references, output);
  if (artifacts.length === 0) {
    await vscode.window.showInformationMessage(
      "No VHS output artifacts exist yet. Run the tape first.",
    );
    return;
  }
  const key = document.uri.toString();
  let panel = panels.get(key);
  if (panel === undefined) {
    panel = vscode.window.createWebviewPanel(
      "vhs.preview",
      `VHS Preview: ${basename(document.uri.path)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: uniqueParents(artifacts.map(({ uri }) => uri)),
        retainContextWhenHidden: false,
      },
    );
    panels.set(key, panel);
    panel.onDidDispose(() => panels.delete(key));
  } else {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: uniqueParents(artifacts.map(({ uri }) => uri)),
    };
    panel.reveal(vscode.ViewColumn.Beside, true);
  }
  panel.webview.html = await previewHtml(panel.webview, artifacts);
}

async function existingArtifacts(
  source: vscode.Uri,
  references: readonly ArtifactReference[],
  output: vscode.LogOutputChannel,
): Promise<readonly PreviewArtifact[]> {
  const result: PreviewArtifact[] = [];
  for (const reference of references) {
    if (reference.path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(reference.path)) continue;
    const uri = vscode.Uri.joinPath(
      source,
      "..",
      ...reference.path.replaceAll("\\", "/").split("/"),
    );
    try {
      await vscode.workspace.fs.stat(uri);
      result.push({ ...reference, uri });
    } catch {
      output.debug(`Artifact not found: ${uri.toString()}`);
    }
  }
  return result;
}

async function previewHtml(
  webview: vscode.Webview,
  artifacts: readonly PreviewArtifact[],
): Promise<string> {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const sections: string[] = [];
  for (const [index, artifact] of artifacts.entries()) {
    sections.push(await artifactHtml(webview, artifact, index));
  }
  const buttons = artifacts
    .map(
      (artifact, index) =>
        `<button type="button" data-target="artifact-${index}" aria-pressed="${index === 0 ? "true" : "false"}">${escapeHtml(basename(artifact.path))}</button>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; media-src ${webview.cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">html,body{height:100%;margin:0}body{box-sizing:border-box;padding:12px;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family);overflow:hidden}.tabs{display:flex;gap:6px;overflow:auto;height:34px}.tabs button{white-space:nowrap;color:inherit;background:var(--vscode-button-secondaryBackground);border:0;padding:5px 10px;border-radius:4px}.tabs button[aria-pressed=true]{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}main{height:calc(100vh - 58px);min-height:0}.artifact{display:none;width:100%;height:100%;overflow:auto}.artifact.active{display:flex;align-items:center;justify-content:center}.artifact img,.artifact video{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}.artifact pre{box-sizing:border-box;width:100%;height:100%;margin:0;overflow:auto;padding:12px;background:var(--vscode-textCodeBlock-background);white-space:pre-wrap}.gallery{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;align-items:start!important;justify-content:stretch!important}.gallery img{width:100%;height:auto}.empty{color:var(--vscode-descriptionForeground)}</style></head>
<body><nav class="tabs" aria-label="Artifacts">${buttons}</nav><main>${sections.join("")}</main>
<script nonce="${nonce}">const buttons=[...document.querySelectorAll('button[data-target]')];const sections=[...document.querySelectorAll('.artifact')];function show(id){for(const item of sections)item.classList.toggle('active',item.id===id);for(const button of buttons)button.setAttribute('aria-pressed',String(button.dataset.target===id));}for(const button of buttons)button.addEventListener('click',()=>show(button.dataset.target));show('artifact-0');</script></body></html>`;
}

async function artifactHtml(
  webview: vscode.Webview,
  artifact: PreviewArtifact,
  index: number,
): Promise<string> {
  const id = `artifact-${index}`;
  if (artifact.kind === "text") {
    const bytes = await vscode.workspace.fs.readFile(artifact.uri);
    const text = new TextDecoder().decode(bytes.slice(0, 1_048_576));
    return `<section class="artifact" id="${id}"><pre>${escapeHtml(text)}${bytes.byteLength > 1_048_576 ? "\n\n[preview truncated]" : ""}</pre></section>`;
  }
  if (artifact.kind === "frames") {
    const entries = await vscode.workspace.fs.readDirectory(artifact.uri);
    const images = entries
      .filter(
        ([name, type]) => type === vscode.FileType.File && name.toLowerCase().endsWith(".png"),
      )
      .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
      .slice(0, 500)
      .map(
        ([name]) =>
          `<img loading="lazy" alt="${escapeHtml(name)}" src="${webview.asWebviewUri(vscode.Uri.joinPath(artifact.uri, name)).toString()}">`,
      )
      .join("");
    return `<section class="artifact gallery" id="${id}">${images || '<p class="empty">No frames found.</p>'}</section>`;
  }
  const uri = webview.asWebviewUri(artifact.uri).toString();
  if (artifact.kind === "video")
    return `<section class="artifact" id="${id}"><video controls preload="metadata" src="${uri}"></video></section>`;
  return `<section class="artifact" id="${id}"><img alt="${escapeHtml(basename(artifact.path))}" src="${uri}"></section>`;
}

const basename = (path: string): string =>
  path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const uniqueParents = (uris: readonly vscode.Uri[]): readonly vscode.Uri[] => {
  const values = new Map<string, vscode.Uri>();
  for (const uri of uris) {
    const parent = vscode.Uri.joinPath(uri, "..");
    values.set(parent.toString(), parent);
  }
  return [...values.values()];
};
