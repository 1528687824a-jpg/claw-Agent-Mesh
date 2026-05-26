import { DBOS } from "@dbos-inc/dbos-sdk";
import type {
  JobWorkflowInput,
  RoutingMode,
  StageRecord
} from "../../../packages/shared/src/types";
import { WORKFLOW_NAME } from "../../../packages/shared/src/constants";
import * as activities from "./activities";
import { maybeCrashOnce } from "./test-crash";

const DISCUSSION_ROUND_COUNT = 2;

const retryingStepConfig = {
  retriesAllowed: true,
  intervalSeconds: 1,
  maxAttempts: 3
};

const completeStageWithoutReview = DBOS.registerStep(activities.completeStageWithoutReview, {
  name: "completeStageWithoutReview",
  ...retryingStepConfig
});
const finalizeJob = DBOS.registerStep(activities.finalizeJob, {
  name: "finalizeJob",
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

async function runSupervisorPipeline(jobId: string, stages: StageRecord[]) {
  for (const stage of stages) {
    let passed = false;

    for (let attemptNo = 1; attemptNo <= stage.maxRetries; attemptNo++) {
      const run = await runStageAgent({
        jobId,
        stageId: stage.id,
        attemptNo,
        routingMode: "supervisor_pipeline",
        handoffTargetAgentId: "test-agent",
        outputMessageType: "stage_output_to_test"
      });
      crashAfterStageAgent(jobId, stage, attemptNo);

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
}

async function runClassicMasterSlave(jobId: string, stages: StageRecord[]) {
  for (const stage of stages) {
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
}

async function runMasterSlaveDiscussion(jobId: string, stages: StageRecord[]) {
  for (let roundNo = 1; roundNo <= DISCUSSION_ROUND_COUNT; roundNo++) {
    for (const [index, stage] of stages.entries()) {
      const nextStage = stages.length > 1 ? stages[(index + 1) % stages.length] : null;
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
}

async function runRoutingMode(jobId: string, routingMode: RoutingMode, stages: StageRecord[]) {
  switch (routingMode) {
    case "supervisor_pipeline":
      return runSupervisorPipeline(jobId, stages);
    case "pipeline":
      await runSequentialPipeline(jobId, stages);
      return "succeeded";
    case "classic_master_slave":
      await runClassicMasterSlave(jobId, stages);
      return "succeeded";
    case "master_slave_discussion":
      await runMasterSlaveDiscussion(jobId, stages);
      return "succeeded";
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

  if (routingMode === "master_slave_discussion") {
    await mainAgentSynthesizeDiscussion(input.jobId);
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
