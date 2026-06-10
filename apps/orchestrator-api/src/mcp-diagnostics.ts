import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type McpCommandCheck = {
  status: "available" | "missing" | "failed";
  checkedAt: string;
  resolvedPath: string | null;
  error: string | null;
};

export async function checkMcpCommand(command: string): Promise<McpCommandCheck> {
  const checkedAt = new Date().toISOString();
  const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
  try {
    const result = await execFileAsync(lookupCommand, [command], {
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 64 * 1024
    });
    const resolvedPath = result.stdout.split(/\r?\n/).find(Boolean)?.trim() || null;
    return {
      status: resolvedPath ? "available" : "missing",
      checkedAt,
      resolvedPath,
      error: null
    };
  } catch (error) {
    return {
      status: "missing",
      checkedAt,
      resolvedPath: null,
      error: error instanceof Error ? error.message.slice(0, 500) : "command_lookup_failed"
    };
  }
}
