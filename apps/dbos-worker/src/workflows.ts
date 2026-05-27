import { DBOS } from "@dbos-inc/dbos-sdk";
import type {
  JobWorkflowInput,
  RoutingMode,
  StageRecord
} from "../../../packages/shared/src/types";
import { WORKFLOW_NAME } from "../../../packages/shared/src/constants";
import * as activities from "./activities";
import { maybeCrashOnce } from "./test-crash";

const retryingStepConfig = {
  retriesAllowed: true,
  intervalSeconds: 1,
  maxAttempts: 3
};

const completeStageWithoutReview = DBOS.registerStep(activities.completeStageWithoutReview, {
  name: "completeStageWithoutReview",
  ...retryingStepConfig
});
const enforceModelCallBudget = DBOS.registerStep(activities.enforceModelCallBudget, {
  name: "enforceModelCallBudget",
  ...retryingStepConfig
});
const finalizeJob = DBOS.registerStep(activities.finalizeJob, {
  name: "finalizeJob",
  ...retryingStepConfig
});
const getLatestStageOutputArtifactId = DBOS.registerStep(activities.getLatestStageOutputArtifactId, {
  name: "getLatestStageOutputArtifactId",
  ...retryingStepConfig
});
const createPipelinePlan = DBOS.registerStep(activities.createPipelinePlan, {
  name: "createPipelinePlan",
  ...retryingStepConfig
});
const getJobRoutingMode = DBOS.registerStep(activities.getJobRoutingMode, {
  name: "getJobRoutingMode",
  ...retryingStepConfig
});
const getJobDiscussionRounds = DBOS.registerStep(activities.getJobDiscussionRounds, {
  name: "getJobDiscussionRounds",
  ...retryingStepConfig
});
const markJobRunning = DBOS.registerStep(activities.markJobRunning, {
  name: "markJobRunning",
  ...retryingStepConfig
});
const markJobWaitingForHuman = DBOS.registerStep(activities.markJobWaitingForHuman, {
  name: "markJobWaitingForHuman",
  ...retryingStepConfig
});
const mainAgentSynthesizeDiscussion = DBOS.registerStep(activities.mainAgentSynthesizeDiscussion, {
  name: "mainAgentSynthesizeDiscussion",
  ...retryingStepConfig
});
const passStageAndHandoff = DBOS.registerStep(activities.passStageAndHandoff, {
  name: "passStageAndHandoff",
  ...retryingStepConfig
});
const prepareJobWorkspace = DBOS.registerStep(activities.prepareJobWorkspace, {
  name: "prepareJobWorkspace",
  ...retryingStepConfig
});
const recordDiscussionRound = DBOS.registerStep(activities.recordDiscussionRound, {
  name: "recordDiscussionRound",
  ...retryingStepConfig
});
const requestStageFix = DBOS.registerStep(activities.requestStageFix, {
  name: "requestStageFix",
  ...retryingStepConfig
});
const runStageAgent = DBOS.registerStep(activities.runStageAgent, {
  name: "runStageAgent",
  ...retryingStepConfig
});
const runTestAgent = DBOS.registerStep(activities.runTestAgent, {
  name: "runTestAgent",
  ...retryingStepConfig
});
const runFinalTestAgent = DBOS.registerStep(activities.runFinalTestAgent, {
  name: "runFinalTestAgent",
  ...retryingStepConfig
});
const shouldRunFinalQualityGate = DBOS.registerStep(activities.shouldRunFinalQualityGate, {
  name: "shouldRunFinalQualityGate",
  ...retryingStepConfig
});
const stopAfterConsecutiveFailures = DBOS.registerStep(activities.stopAfterConsecutiveFailures, {
  name: "stopAfterConsecutiveFailures",
  ...retryingStepConfig
});

function crashAfterStageAgent(jobId: string, stage: StageRecord, attemptNo: number) {
  maybeCrashOnce(
    `after-runStageAgent-stage-${stage.stageIndex.toString().padStart(3, "0")}-attempt-${attemptNo
      .toString()
      .padStart(2, "0")}`,
    jobId
  );
}

async function hasModelCallBudget(
  jobId: string,
  nextActionType: "stage-agent" | "test-agent" | "main-agent-synthesis" | "final-test-agent",
  nextAgentId: string
) {
  const budget = await enforceModelCallBudget({
    jobId,
    nextActionType,
    nextAgentId
  });
  return budget.allowed;
}

async function runSupervisorPipeline(jobId: string, stages: StageRecord[]) {
  for (const stage of stages) {
    let passed = false;

    for (let attemptNo = 1; attemptNo <= stage.maxRetries; attemptNo++) {
      if (!(await hasModelCallBudget(jobId, "stage-agent", stage.agentId))) {
        return "waiting_for_human";
      }

      const run = await runStageAgent({
        jobId,
        stageId: stage.id,
        attemptNo,
        routingMode: "supervisor_pipeline",
        handoffTargetAgentId: "test-agent",
        outputMessageType: "stage_output_to_test"
      });
      crashAfterStageAgent(jobId, stage, attemptNo);

      if (!(await hasModelCallBudget(jobId, "test-agent", "test-agent"))) {
        return "waiting_for_human";
      }

      const review = await runTestAgent({
        jobId,
        stageId: stage.id,
        attemptId: run.attemptId,
        attemptNo,
        outputArtifactId: run.outputArtifactId
      });

      if (review.verdict === "PASS") {
        await passStageAndHandoff({
          jobId,
          stageId: stage.id,
          outputArtifactId: run.outputArtifactId,
          reportArtifactId: review.reportArtifactId
        });
        passed = true;
        break;
      }

      if (review.verdict === "NEEDS_HUMAN") {
        await markJobWaitingForHuman(jobId, `Stage ${stage.id} needs human review`);
        return "waiting_for_human";
      }

      if (attemptNo < stage.maxRetries) {
        await requestStageFix({
          jobId,
          stageId: stage.id,
          attemptNo,
          reportArtifactId: review.reportArtifactId
        });
      } else {
        await stopAfterConsecutiveFailures({
          jobId,
          stageId: stage.id,
          attemptNo,
          reportArtifactId: review.reportArtifactId
        });
      }
    }

    if (!passed) {
      return "waiting_for_human";
    }
  }

  return "succeeded";
}

async function runSequentialPipeline(jobId: string, stages: StageRecord[]) {
  for (const [index, stage] of stages.entries()) {
    const nextStage = stages[index + 1] ?? null;
    if (!(await hasModelCallBudget(jobId, "stage-agent", stage.agentId))) {
      return "waiting_for_human";
    }

    const run = await runStageAgent({
      jobId,
      stageId: stage.id,
      attemptNo: 1,
      routingMode: "pipeline",
      handoffTargetAgentId: nextStage?.agentId ?? "main-agent",
      outputMessageType: nextStage ? "pipeline_handoff" : "final_output"
    });
    crashAfterStageAgent(jobId, stage, 1);

    await completeStageWithoutReview({
      jobId,
      stageId: stage.id,
      outputArtifactId: run.outputArtifactId,
      routingMode: "pipeline",
      linkNextStage: true
    });
  }

  return "succeeded";
}

async function runClassicMasterSlave(jobId: string, stages: StageRecord[]) {
  for (const stage of stages) {
    if (!(await hasModelCallBudget(jobId, "stage-agent", stage.agentId))) {
      return "waiting_for_human";
    }

    const run = await runStageAgent({
      jobId,
      stageId: stage.id,
      attemptNo: 1,
      routingMode: "classic_master_slave",
      handoffTargetAgentId: "main-agent",
      outputMessageType: "main_dispatch"
    });
    crashAfterStageAgent(jobId, stage, 1);

    await completeStageWithoutReview({
      jobId,
      stageId: stage.id,
      outputArtifactId: run.outputArtifactId,
      routingMode: "classic_master_slave"
    });
  }

  return "succeeded";
}

async function runMasterSlaveDiscussion(jobId: string, stages: StageRecord[], discussionRounds: number) {
  for (let roundNo = 1; roundNo <= discussionRounds; roundNo++) {
    for (const [index, stage] of stages.entries()) {
      const nextStage = stages.length > 1 ? stages[(index + 1) % stages.length] : null;
      if (!(await hasModelCallBudget(jobId, "stage-agent", stage.agentId))) {
        return "waiting_for_human";
      }

      const run = await runStageAgent({
        jobId,
        stageId: stage.id,
        attemptNo: roundNo,
        routingMode: "master_slave_discussion",
        handoffTargetAgentId: nextStage?.agentId ?? "main-agent",
        outputMessageType: "discussion_handoff"
      });
      crashAfterStageAgent(jobId, stage, roundNo);

      await completeStageWithoutReview({
        jobId,
        stageId: stage.id,
        outputArtifactId: run.outputArtifactId,
        routingMode: "master_slave_discussion",
        roundNo
      });
    }

    await recordDiscussionRound({
      jobId,
      roundNo,
      stageIds: stages.map((stage) => stage.id)
    });
  }

  return "succeeded";
}

async function runRoutingMode(jobId: string, routingMode: RoutingMode, stages: StageRecord[]) {
  switch (routingMode) {
    case "supervisor_pipeline":
      return runSupervisorPipeline(jobId, stages);
    case "pipeline":
      return runSequentialPipeline(jobId, stages);
    case "classic_master_slave":
      return runClassicMasterSlave(jobId, stages);
    case "master_slave_discussion":
      return runMasterSlaveDiscussion(jobId, stages, await getJobDiscussionRounds(jobId));
    default:
      throw new Error(`Unsupported routing mode: ${routingMode}`);
  }
}

async function jobPipelineWorkflow(input: JobWorkflowInput) {
  await markJobRunning(input.jobId);
  const prepared = await prepareJobWorkspace(input.jobId);
  const stages = await createPipelinePlan({
    jobId: input.jobId,
    userRequestArtifactId: prepared.userRequestArtifactId
  });
  const routingMode = await getJobRoutingMode(input.jobId);
  const status = await runRoutingMode(input.jobId, routingMode, stages);

  if (status === "waiting_for_human") {
    return {
      jobId: input.jobId,
      status
    };
  }

  let finalQualitySourceArtifactId: string | null = null;
  if (routingMode === "master_slave_discussion") {
    if (!(await hasModelCallBudget(input.jobId, "main-agent-synthesis", "main-agent"))) {
      return {
        jobId: input.jobId,
        status: "waiting_for_human"
      };
    }

    const synthesis = await mainAgentSynthesizeDiscussion(input.jobId);
    finalQualitySourceArtifactId = synthesis.artifactId;
  }

  const finalGate = await shouldRunFinalQualityGate({
    jobId: input.jobId,
    routingMode
  });
  if (finalGate.enabled) {
    if (!finalQualitySourceArtifactId) {
      finalQualitySourceArtifactId = await getLatestStageOutputArtifactId(input.jobId);
    }

    if (!(await hasModelCallBudget(input.jobId, "final-test-agent", "test-agent"))) {
      return {
        jobId: input.jobId,
        status: "waiting_for_human"
      };
    }

    const review = await runFinalTestAgent({
      jobId: input.jobId,
      sourceArtifactId: finalQualitySourceArtifactId,
      routingMode
    });

    if (review.verdict !== "PASS") {
      await markJobWaitingForHuman(
        input.jobId,
        `Final quality gate failed for ${routingMode}: ${review.reportArtifactId}`
      );
      return {
        jobId: input.jobId,
        status: "waiting_for_human"
      };
    }
  }

  await finalizeJob(input.jobId);

  return {
    jobId: input.jobId,
    status: "succeeded"
  };
}

export const JobPipelineWorkflow = DBOS.registerWorkflow(jobPipelineWorkflow, {
  name: WORKFLOW_NAME
});
