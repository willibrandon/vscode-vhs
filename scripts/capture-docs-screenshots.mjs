import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { downloadAndUnzipVSCode, runVSCodeCommand } from "@vscode/test-electron";
import { chromium } from "playwright";
import sharp from "sharp";
import { createIsolatedVSCodeEnvironment } from "./vscode-test-environment.mjs";

const root = resolve(import.meta.dirname, "..");

if (process.platform === "linux" && process.env.VHS_DOCS_XVFB !== "1") {
  const child = spawnSync(
    "xvfb-run",
    [
      "-a",
      "-s",
      "-screen 0 2560x1440x24",
      process.execPath,
      resolve(import.meta.dirname, "capture-docs-screenshots.mjs"),
    ],
    {
      cwd: root,
      env: { ...process.env, VHS_DOCS_XVFB: "1" },
      stdio: "inherit",
    },
  );
  process.exit(child.status ?? 1);
}

const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const vsix = resolve(root, `dist/vhs-${manifest.version}.vsix`);
const version = process.env.VSCODE_VERSION ?? "stable";
const outputDirectory = resolve(root, "docs-site/src/assets");
const temporaryRoot = await mkdtemp(join(tmpdir(), "vscode-vhs-docs-"));
const workspace = resolve(temporaryRoot, "workspace");
const extensionsDirectory = resolve(temporaryRoot, "extensions");
const userDataDirectory = resolve(temporaryRoot, "user-data");
const environment = createIsolatedVSCodeEnvironment();
const port = await availablePort();
let browser;
let code;

await Promise.all([
  mkdir(outputDirectory, { recursive: true }),
  mkdir(extensionsDirectory),
  mkdir(userDataDirectory),
  cp(resolve(root, "test/integration/fixtures"), workspace, { recursive: true }),
]);
await mkdir(resolve(userDataDirectory, "User"));
await writeFile(
  resolve(userDataDirectory, "User/settings.json"),
  `${JSON.stringify(
    {
      "breadcrumbs.enabled": false,
      "editor.fontSize": 20,
      "editor.lineHeight": 30,
      "editor.minimap.enabled": false,
      "git.openRepositoryInParentFolders": "never",
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "window.zoomLevel": 1,
      "workbench.colorTheme": "Default Dark Modern",
      "workbench.secondarySideBar.defaultVisibility": "hidden",
      "workbench.startupEditor": "none",
    },
    undefined,
    2,
  )}\n`,
  "utf8",
);

try {
  const installation = await runVSCodeCommand(
    [
      "--install-extension",
      vsix,
      "--force",
      `--extensions-dir=${extensionsDirectory}`,
      `--user-data-dir=${userDataDirectory}`,
    ],
    { spawn: { env: environment }, version },
  );
  process.stdout.write(installation.stdout);
  process.stderr.write(installation.stderr);

  const executable = await downloadAndUnzipVSCode(version);
  code = spawn(
    executable,
    [
      resolve(workspace, "demo.tape"),
      "--folder-uri",
      pathToFileURL(workspace).href,
      "--disable-workspace-trust",
      "--disable-updates",
      "--disable-gpu",
      "--skip-release-notes",
      "--skip-welcome",
      "--window-size=2560,1440",
      `--remote-debugging-port=${port}`,
      `--extensions-dir=${extensionsDirectory}`,
      `--user-data-dir=${userDataDirectory}`,
    ],
    {
      cwd: root,
      detached: process.platform !== "win32",
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  browser = await connectToBrowser(port, code);
  const page = await waitForPage(browser, code);
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.locator(".monaco-workbench").waitFor({ state: "visible", timeout: 30_000 });
  await page.keyboard.press("Escape");
  await waitForEditor(page);
  await waitForDiagnostics(page);

  await replaceLine(page, 1, "Ty");
  await waitForSuggestion(page, "Type");
  await capture(page, "completion.png");

  await page.keyboard.press("Escape");
  await goTo(page, 8, 2);
  await waitForHover(page, "Types text into the terminal");
  await capture(page, "hover.png");

  await page.keyboard.press("Escape");
  await replaceLine(page, 1, "TypoCommand");
  await waitForDiagnostics(page);
  await goTo(page, 1, 3);
  await waitForHover(page, "Unknown VHS command");
  await capture(page, "diagnostic.png");
} finally {
  await browser?.close();
  if (code !== undefined) await terminate(code);
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Unable to allocate a debugging port.");
  }
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => (error === undefined ? resolvePromise() : rejectPromise(error)));
  });
  return address.port;
}

async function connectToBrowser(port, child) {
  const endpoint = `http://127.0.0.1:${port}`;
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Visual Studio Code exited before capture with code ${child.exitCode}.`);
    }
    try {
      return await chromium.connectOverCDP(endpoint);
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw lastError;
}

async function waitForPage(currentBrowser, child) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const page = currentBrowser.contexts()[0]?.pages()[0];
    if (page !== undefined) return page;
    if (child.exitCode !== null) {
      throw new Error(`Visual Studio Code exited before capture with code ${child.exitCode}.`);
    }
    await delay(100);
  }
  throw new Error("Visual Studio Code did not create a browser page.");
}

function activeEditor(page) {
  return page.locator(".editor-group-container.active .monaco-editor:visible").last();
}

async function waitForEditor(page) {
  await activeEditor(page).locator(".view-lines").waitFor({ state: "visible", timeout: 30_000 });
}

async function waitForDiagnostics(page) {
  await activeEditor(page)
    .locator(".squiggly-warning, .squiggly-error, .squiggly-hint")
    .first()
    .waitFor({ state: "attached", timeout: 30_000 });
}

async function waitForSuggestion(page, text) {
  const suggestion = page.locator(".suggest-widget:visible").filter({ hasText: text });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await page.keyboard.press("Control+Space");
    if (await suggestion.isVisible()) return;
    await delay(250);
    if (await suggestion.isVisible()) return;
    await page.keyboard.press("Escape");
    await delay(250);
  }
  const editorText = await activeEditor(page).locator(".view-lines").innerText();
  const widgets = await page.locator(".suggest-widget").allInnerTexts();
  const activeElement = await page.evaluate(() => {
    const element = globalThis.document.activeElement;
    return element === null
      ? undefined
      : { className: element.className, tagName: element.tagName };
  });
  await page.screenshot({ path: resolve(root, "dist/docs-capture-debug.png") });
  console.error(JSON.stringify({ activeElement, editorText, widgets }, undefined, 2));
  throw new Error(`Timed out waiting for the ${text} completion.`);
}

async function runEditorCommand(page, command) {
  await page.keyboard.press("F1");
  const input = page.locator(".quick-input-widget:visible input");
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(`>${command}`);
  const item = page.locator(".quick-input-list-row:visible").filter({ hasText: command }).first();
  await item.waitFor({ state: "visible", timeout: 10_000 });
  await page.keyboard.press("Enter");
}

async function waitForHover(page, text) {
  const hover = page.locator(".monaco-hover:visible").filter({ hasText: text });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await runEditorCommand(page, "Show or Focus Hover");
    if (await hover.isVisible()) return;
    await delay(250);
    if (await hover.isVisible()) return;
    await page.keyboard.press("Escape");
    await delay(250);
  }
  const editorText = await activeEditor(page).locator(".view-lines").innerText();
  const squiggles = await activeEditor(page)
    .locator(".squiggly-warning, .squiggly-error, .squiggly-hint, .squiggly-info")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        className: element.className,
        line: element.closest(".view-line")?.textContent,
      })),
    );
  await page.screenshot({ path: resolve(root, "dist/docs-hover-debug.png") });
  console.error(JSON.stringify({ editorText, squiggles }, undefined, 2));
  throw new Error(`Timed out waiting for hover text ${JSON.stringify(text)}.`);
}

async function replaceLine(page, number, value) {
  await goTo(page, number, 1);
  await runEditorCommand(page, "Expand Line Selection");
  await page.keyboard.insertText(`${value}\n`);
  const expected = value.trim();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const lines = await activeEditor(page).locator(".view-line").allInnerTexts();
    if (lines.some((line) => line.replaceAll("\u00a0", " ").trim() === expected)) {
      await goTo(page, number, 9_999);
      return;
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for the editor line ${JSON.stringify(expected)}.`);
}

async function goTo(page, line, column) {
  await page.keyboard.press("Control+G");
  const input = page.locator(".quick-input-widget:visible input");
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(`:${line}:${column}`);
  await page.keyboard.press("Enter");
}

async function capture(page, filename) {
  const output = resolve(outputDirectory, filename);
  await page.screenshot({ path: output });
  const metadata = await sharp(output).metadata();
  if (metadata.width !== 2560 || metadata.height !== 1440) {
    throw new Error(`${filename} is ${metadata.width}x${metadata.height}, expected 2560x1440.`);
  }
  console.log(`Captured docs-site/src/assets/${filename} from the installed VSIX.`);
}

function terminate(child) {
  return new Promise((resolvePromise) => {
    if (child.exitCode !== null) {
      resolvePromise();
      return;
    }
    child.once("close", resolvePromise);
    try {
      if (child.pid !== undefined && process.platform !== "win32") {
        process.kill(-child.pid, "SIGTERM");
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      resolvePromise();
    }
  });
}
