import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, ".runtime", "m3-real-planner-smoke");
const answersPath = path.join(outDir, "interview.answers.json");
const configPath = path.join(outDir, "cluster.config.json");

type PlannerRequest = {
  authorization?: string;
  model?: string;
};

const plannerRequests: PlannerRequest[] = [];

function readBody(request: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const childEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string") {
        childEnv[key] = value;
      }
    }

    const child = spawn(command, args, {
      cwd: root,
      env: childEnv,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(
    answersPath,
    `${JSON.stringify(
      {
        clusterId: "real-planner-smoke",
        name: "Real Planner Smoke",
        primaryUseCase: "Create launch research, copy, and a short video brief.",
        audience: "founders",
        tone: "concise and practical",
        desiredOutputs: ["research", "writing", "video"],
        defaultRoutingMode: "supervisor_pipeline",
        constraints: ["Use the local fake planner provider for smoke validation."]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "not_found" }));
        return;
      }

      const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
      plannerRequests.push({
        authorization: request.headers.authorization,
        model: typeof body.model === "string" ? body.model : undefined
      });

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  clusterId: "real-planner-smoke-generated",
                  name: "Real Planner Smoke Generated",
                  description: "Fake-provider proof that M3 can use a real planner API shape.",
                  defaultRoutingMode: "pipeline",
                  stages: [
                    {
                      role: "research",
                      name: "Research launch context",
                      acceptanceCriteria: ["Identify customer, market, and positioning facts."],
                      maxRetries: 2
                    },
                    {
                      role: "writing",
                      name: "Draft launch copy",
                      acceptanceCriteria: ["Turn researched facts into clear launch copy."]
                    },
                    {
                      role: "video",
                      name: "Create launch video brief",
                      acceptanceCriteria: ["Write a concise video brief from the launch copy."]
                    }
                  ]
                })
              }
            }
          ]
        })
      );
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: (error as Error).message }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fake planner server did not bind to a TCP port");
  }

  try {
    const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.cjs");
    await run(
      process.execPath,
      [
        tsxCli,
        path.join(root, "scripts", "generate-cluster-config.ts"),
        "--answers",
        answersPath,
        "--out",
        outDir,
        "--approve",
        "--planner",
        "openai-compatible"
      ],
      {
        ...process.env,
        M3_PLANNER_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        M3_PLANNER_MODEL: "planner-smoke-model",
        M3_PLANNER_API_KEY: "local-smoke-api-key",
        M3_PLANNER_TIMEOUT_SECONDS: "10"
      }
    );

    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, any>;
    assertEqual(plannerRequests.length, 1, "planner request count");
    assertEqual(plannerRequests[0].authorization, "Bearer local-smoke-api-key", "planner auth header");
    assertEqual(plannerRequests[0].model, "planner-smoke-model", "planner request model");
    assertEqual(config.source.planner, "openai-compatible", "config source planner");
    assertEqual(config.source.model, "planner-smoke-model", "config source model");
    assertEqual(config.defaultRoutingMode, "pipeline", "planner-selected routing mode");
    assertEqual(config.stages.length, 3, "planner-selected stage count");
    assertEqual(config.stages[0].agentId, "research-agent", "stage 1 agent");
    assertEqual(config.stages[1].agentId, "writer-agent", "stage 2 agent");
    assertEqual(config.stages[2].agentId, "video-agent", "stage 3 agent");

    console.log(
      JSON.stringify(
        {
          ok: true,
          configPath,
          plannerRequests: plannerRequests.length,
          planner: config.source.planner,
          model: config.source.model,
          stageAgents: config.stages.map((stage: Record<string, unknown>) => stage.agentId),
          checked: [
            "openai_compatible_request",
            "planner_json_response_parse",
            "planner_source_metadata",
            "planner_selected_stage_order"
          ]
        },
        null,
        2
      )
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
