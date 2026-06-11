import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const excludedForSource = new Set([
  ".git",
  ".runtime",
  "data",
  "dist",
  "logs",
  "node_modules",
  "target",
  "temporal"
]);

const expectedGitignoreEntries = [
  "node_modules/",
  ".runtime/",
  "logs/",
  "dist/",
  "data/",
  "apps/desktop-app/src-tauri/target/"
];

function bytesToMb(bytes: number) {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

function isExcluded(fullPath: string) {
  const relative = path.relative(root, fullPath);
  const parts = relative.split(path.sep).filter(Boolean);
  return parts.some((part) => excludedForSource.has(part));
}

function dirSize(directory: string, options: { excludeGenerated?: boolean } = {}): number {
  if (!existsSync(directory)) {
    return 0;
  }

  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (options.excludeGenerated && isExcluded(fullPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      total += dirSize(fullPath, options);
    } else if (entry.isFile()) {
      total += statSync(fullPath).size;
    }
  }
  return total;
}

function listTrackedFiles() {
  return execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8"
  })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function trackedSize(files: string[]) {
  let total = 0;
  for (const file of files) {
    const fullPath = path.join(root, file);
    if (existsSync(fullPath)) {
      total += statSync(fullPath).size;
    }
  }
  return total;
}

function trackedGeneratedFiles(files: string[]) {
  return files.filter((file) => {
    const parts = file.split(/[\\/]/);
    return parts.some((part) => excludedForSource.has(part));
  });
}

function getTopLevelSizes() {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(root, entry.name);
      return {
        name: entry.name,
        sizeMb: bytesToMb(dirSize(fullPath))
      };
    })
    .sort((left, right) => right.sizeMb - left.sizeMb);
}

function assertGitignore() {
  const gitignorePath = path.join(root, ".gitignore");
  const content = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  return expectedGitignoreEntries.filter((entry) => !content.includes(entry));
}

function readTauriConfig() {
  const configPath = path.join(root, "apps", "desktop-app", "src-tauri", "tauri.conf.json");
  if (!existsSync(configPath)) {
    return null;
  }

  return JSON.parse(readFileSync(configPath, "utf8")) as {
    build?: { frontendDist?: string };
    bundle?: { active?: boolean; targets?: string };
  };
}

const tracked = listTrackedFiles();
const generatedTracked = trackedGeneratedFiles(tracked);
const missingGitignoreEntries = assertGitignore();
const tauriConfig = readTauriConfig();
const releaseExePath = path.join(root, "apps", "desktop-app", "src-tauri", "target", "release", "honeycomb.exe");
const releaseExeSize = existsSync(releaseExePath) ? statSync(releaseExePath).size : 0;

const result = {
  ok: generatedTracked.length === 0 && missingGitignoreEntries.length === 0 && Boolean(tauriConfig?.bundle?.active),
  root,
  sizes: {
    workingTreeMb: bytesToMb(dirSize(root)),
    sourceExcludingGeneratedMb: bytesToMb(dirSize(root, { excludeGenerated: true })),
    trackedFilesMb: bytesToMb(trackedSize(tracked)),
    releaseExeMb: bytesToMb(releaseExeSize)
  },
  topLevelSizes: getTopLevelSizes().slice(0, 12),
  layout: {
    sourceRoots: ["apps", "packages", "config", "platform-assets", "scripts", "docs"],
    generatedOrLocalOnly: [".runtime", "logs", "data", "dist", "node_modules", "apps/desktop-app/src-tauri/target"],
    desktopRuntimeState: [
      "%APPDATA%/io.agentopenclaw.desktop/desktop-first-run",
      "%APPDATA%/io.agentopenclaw.desktop/openclaw-runtime",
      "%APPDATA%/io.agentopenclaw.desktop/honeycomb-secrets"
    ],
    tauriFrontendDist: tauriConfig?.build?.frontendDist ?? null,
    tauriBundleActive: tauriConfig?.bundle?.active ?? null,
    tauriBundleTargets: tauriConfig?.bundle?.targets ?? null
  },
  checks: {
    generatedTrackedFiles: generatedTracked,
    missingGitignoreEntries
  }
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
