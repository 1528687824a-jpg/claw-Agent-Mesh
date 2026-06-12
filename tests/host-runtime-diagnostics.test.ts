import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeWindowsCommandOutput,
  parseDockerPsJsonLines,
  parseWslListOutput
} from "../apps/orchestrator-api/src/host-runtime-diagnostics";

test("decodeWindowsCommandOutput handles UTF-16LE wsl output", () => {
  const utf16 = Buffer.from("  NAME    STATE\n* Ubuntu-24.04    Running", "utf16le");
  const decoded = decodeWindowsCommandOutput(utf16);
  assert.ok(decoded.includes("Ubuntu-24.04"));
  assert.ok(!decoded.includes(String.fromCharCode(0)));
});

test("decodeWindowsCommandOutput handles plain UTF-8 output", () => {
  const utf8 = Buffer.from("27.4.0\n", "utf8");
  assert.equal(decodeWindowsCommandOutput(utf8), "27.4.0\n");
});

test("parseWslListOutput parses distros with default marker", () => {
  const output = [
    "  NAME            STATE           VERSION",
    "* Ubuntu-24.04    Running         2",
    "  Debian          Stopped         2",
    ""
  ].join("\n");

  const distros = parseWslListOutput(output);
  assert.equal(distros.length, 2);
  assert.deepEqual(distros[0], {
    name: "Ubuntu-24.04",
    state: "Running",
    version: "2",
    isDefault: true
  });
  assert.deepEqual(distros[1], {
    name: "Debian",
    state: "Stopped",
    version: "2",
    isDefault: false
  });
});

test("parseWslListOutput tolerates empty and malformed lines", () => {
  assert.deepEqual(parseWslListOutput(""), []);
  assert.deepEqual(parseWslListOutput("header only"), []);
  const distros = parseWslListOutput("  NAME  STATE  VERSION\n  weirdline\n  Ubuntu  Running  2");
  assert.equal(distros.length, 1);
  assert.equal(distros[0].name, "Ubuntu");
});

test("parseDockerPsJsonLines parses container lines and skips bad json", () => {
  const output = [
    JSON.stringify({ Names: "agent-openclaw-postgres", State: "running", Status: "Up 2 hours" }),
    "not-json",
    JSON.stringify({ Names: "agent-openclaw-orchestrator-api", State: "exited", Status: "Exited (0)" }),
    JSON.stringify({ State: "running", Status: "missing name skipped" }),
    ""
  ].join("\n");

  const containers = parseDockerPsJsonLines(output);
  assert.equal(containers.length, 2);
  assert.deepEqual(containers[0], {
    name: "agent-openclaw-postgres",
    state: "running",
    status: "Up 2 hours"
  });
  assert.equal(containers[1].state, "exited");
});
