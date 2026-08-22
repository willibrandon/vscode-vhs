import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

interface Mount {
  readonly source?: unknown;
  readonly target?: unknown;
  readonly type?: unknown;
}

interface DevContainer {
  readonly containerEnv?: Readonly<Record<string, unknown>>;
  readonly mounts?: readonly Mount[];
  readonly postCreateCommand?: unknown;
  readonly postStartCommand?: unknown;
  readonly remoteUser?: unknown;
  readonly updateRemoteUserUID?: unknown;
  readonly init?: unknown;
  readonly privileged?: unknown;
  readonly runArgs?: unknown;
}

interface PackageManifest {
  readonly allowScripts?: Readonly<Record<string, unknown>>;
}

describe("development container", () => {
  it("pins the complete non-root toolchain", async () => {
    const [dockerfile, configText] = await Promise.all([
      readFile(resolve(root, ".devcontainer/Dockerfile"), "utf8"),
      readFile(resolve(root, ".devcontainer/devcontainer.json"), "utf8"),
    ]);
    const config = JSON.parse(configText) as DevContainer;

    for (const image of [
      "node:24.19.0-trixie-slim",
      "docker:29.7.2-cli",
      "mcr.microsoft.com/devcontainers/base:2-trixie",
    ]) {
      expect(dockerfile).toMatch(
        new RegExp(`^FROM ${escapeRegex(image)}@sha256:[0-9a-f]{64}`, "mu"),
      );
    }
    for (const tool of ["chromium", "ffmpeg", "openssh-client", "socat", "xauth", "xvfb"]) {
      expect(dockerfile).toContain(tool);
    }
    expect(dockerfile).toContain("npm install --global npm@12.0.2");
    expect(dockerfile).toContain("ARG TARGETARCH");
    expect(dockerfile).toContain("vhs_arch=x86_64");
    expect(dockerfile).toContain("vhs_arch=arm64");
    expect(dockerfile).toContain(
      "99cb634587eaae0473c1ea377db80c3a048c27f99fe0a7febb1a1e8cb7ee5009",
    );
    expect(dockerfile).toContain(
      "af782cddbf844a377df6ea41c0e72339393fa021be3f6cb70a2f47d48675d92b",
    );
    expect(dockerfile).toContain(
      "8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55",
    );
    expect(dockerfile).toContain(
      "b38acadd89d1d396a0f5649aa52c539edbad07f4bc7348b27b4f4b7219dd4165",
    );
    expect(dockerfile).toContain("ttyd/releases/download/1.7.7");
    expect(config.remoteUser).toBe("vscode");
    expect(config.updateRemoteUserUID).toBe(true);
    expect(config.init).toBe(true);
    expect(config.privileged).toBeUndefined();
    expect(config.runArgs).toBeUndefined();
  });

  it("isolates generated and platform-specific paths per container", async () => {
    const config = JSON.parse(
      await readFile(resolve(root, ".devcontainer/devcontainer.json"), "utf8"),
    ) as DevContainer;
    const mounts = config.mounts ?? [];
    const volumes = mounts.filter(({ type }) => type === "volume");
    const targets = volumes.map(({ target }) => target);

    expect(new Set(targets)).toEqual(
      new Set([
        "${containerWorkspaceFolder}/node_modules",
        "${containerWorkspaceFolder}/dist",
        "${containerWorkspaceFolder}/coverage",
        "${containerWorkspaceFolder}/.vscode-test",
        "${containerWorkspaceFolder}/.vscode-test-web",
        "${containerWorkspaceFolder}/packages/language-core/lib",
        "${containerWorkspaceFolder}/packages/language-server/lib",
        "${containerWorkspaceFolder}/packages/vscode-client/lib",
        "${containerWorkspaceFolder}/docs-site/node_modules",
        "${containerWorkspaceFolder}/docs-site/dist",
        "${containerWorkspaceFolder}/docs-site/.astro",
        "/home/vscode/.npm",
        "/home/vscode/.cache",
      ]),
    );
    expect(new Set(targets).size).toBe(targets.length);
    for (const mount of volumes) {
      expect(mount.source).toMatch(/^vscode-vhs-\$\{devcontainerId\}-/u);
    }
    expect(mounts).toContainEqual({
      source: "/var/run/docker.sock",
      target: "/var/run/docker-host.sock",
      type: "bind",
    });
  });

  it("runs the full editor and real-VHS matrix", async () => {
    const [configText, manifestText, postCreate, proxy, verify] = await Promise.all([
      readFile(resolve(root, ".devcontainer/devcontainer.json"), "utf8"),
      readFile(resolve(root, "package.json"), "utf8"),
      readFile(resolve(root, ".devcontainer/post-create.sh"), "utf8"),
      readFile(resolve(root, ".devcontainer/start-docker-proxy.sh"), "utf8"),
      readFile(resolve(root, ".devcontainer/verify.sh"), "utf8"),
    ]);
    const config = JSON.parse(configText) as DevContainer;
    const manifest = JSON.parse(manifestText) as PackageManifest;

    expect(config.postCreateCommand).toEqual(["bash", ".devcontainer/post-create.sh"]);
    expect(config.postStartCommand).toEqual(["bash", ".devcontainer/start-docker-proxy.sh"]);
    expect(config.containerEnv?.["VHS_BIN"]).toBe("/usr/local/bin/vhs");
    expect(postCreate).toContain("npm ci");
    expect(postCreate).toContain("npm --prefix docs-site ci");
    expect(postCreate).not.toMatch(/\bnpm (?:install|i)\b/u);
    expect(manifest.allowScripts).toEqual({
      "@github/keytar@7.10.6": true,
      "@playwright/browser-chromium@1.62.1": true,
      "@vscode/vsce-sign@2.1.0": true,
      "esbuild@0.28.2": true,
      "sharp@0.35.3": true,
    });
    for (const command of [
      "npm run check:upstream",
      "npm run verify",
      "npm run test:integration",
      "npm run test:web",
      "npm run package",
      "npm run check:release-reproducibility",
      "npm run test:vsix:prepared",
      "npm run test:remote:prepared",
      "npm run test:docs",
    ]) {
      expect(verify).toContain(command);
    }
    expect(verify).toContain("mountpoint --quiet");
    expect(verify).toContain("docker version");
    expect(proxy).toContain("UNIX-LISTEN:$target_socket");
    expect(proxy).toContain("UNIX-CONNECT:$source_socket");
    expect(proxy).not.toMatch(/ch(?:mod|own).*docker-host\.sock/u);
  });

  it("keeps every container image under digest review", async () => {
    const dependabot = await readFile(resolve(root, ".github/dependabot.yml"), "utf8");
    expect(dependabot).toContain("package-ecosystem: docker");
    expect(dependabot).toContain("directory: /.devcontainer");
    for (const dependency of ["node", "docker", "mcr.microsoft.com/devcontainers/base"]) {
      expect(dependabot).toContain(`dependency-name: ${dependency}`);
    }
  });
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
