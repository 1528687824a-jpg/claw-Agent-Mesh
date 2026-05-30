import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  cancelJob,
  createJob,
  getHealth,
  getJob,
  getJobTimeline,
  listJobs,
  type JobRecord,
  type JobStatus,
  type JobTimeline,
  type RoutingMode
} from "./api";
import "./styles.css";

type ApiState = "checking" | "online" | "offline";

const routingModes: RoutingMode[] = [
  "supervisor_pipeline",
  "pipeline",
  "classic_master_slave",
  "master_slave_discussion"
];

const cancellableStatuses: JobStatus[] = [
  "created",
  "queued",
  "planning",
  "running",
  "testing",
  "fixing",
  "waiting_for_human"
];

function formatTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function compactEventType(value: string) {
  return value.replace(/^job\./, "").replace(/^stage\./, "").replace(/^group\./, "");
}

function isCancellable(job: JobRecord | null) {
  return job ? cancellableStatuses.includes(job.status) : false;
}

function statusTone(status: JobStatus) {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "waiting_for_human") return "warn";
  return "active";
}

function App() {
  const [apiState, setApiState] = useState<ApiState>("checking");
  const [prompt, setPrompt] = useState("Draft a short launch note for a tiny multi-agent product.");
  const [routingMode, setRoutingMode] = useState<RoutingMode>("supervisor_pipeline");
  const [maxModelCalls, setMaxModelCalls] = useState(20);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [selectedJob, setSelectedJob] = useState<JobRecord | null>(null);
  const [timeline, setTimeline] = useState<JobTimeline | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusText = useMemo(() => {
    if (apiState === "online") return "API online";
    if (apiState === "offline") return "API offline";
    return "Checking API";
  }, [apiState]);

  const selectedFromList = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? selectedJob,
    [jobs, selectedJob, selectedJobId]
  );

  async function refreshJobs(preferredJobId = selectedJobId) {
    const response = await listJobs(50);
    setJobs(response.jobs);
    const nextSelectedId = preferredJobId || response.jobs[0]?.id || "";
    setSelectedJobId(nextSelectedId);
    return nextSelectedId;
  }

  async function refreshJob(targetJobId = selectedJobId) {
    if (!targetJobId) {
      setSelectedJob(null);
      setTimeline(null);
      return;
    }

    const [job, nextTimeline] = await Promise.all([getJob(targetJobId), getJobTimeline(targetJobId)]);
    setSelectedJob(job);
    setTimeline(nextTimeline);
  }

  async function refreshAll(targetJobId = selectedJobId) {
    const nextSelectedId = await refreshJobs(targetJobId);
    await refreshJob(nextSelectedId);
  }

  async function submitJob() {
    setBusy(true);
    setError(null);
    try {
      const created = await createJob({
        prompt,
        routingMode,
        maxModelCalls
      });
      await refreshAll(created.jobId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function cancelSelectedJob() {
    if (!selectedJobId) return;
    setBusy(true);
    setError(null);
    try {
      await cancelJob(selectedJobId);
      await refreshAll(selectedJobId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    getHealth()
      .then(() => {
        setApiState("online");
        return refreshAll();
      })
      .catch(() => setApiState("offline"));
  }, []);

  useEffect(() => {
    if (!selectedJobId || apiState !== "online") return;
    refreshJob(selectedJobId).catch((caught) =>
      setError(caught instanceof Error ? caught.message : String(caught))
    );
  }, [selectedJobId, apiState]);

  useEffect(() => {
    if (apiState !== "online") return;
    const interval = window.setInterval(() => {
      refreshAll(selectedJobId).catch(() => {
        setApiState("offline");
      });
    }, 4000);
    return () => window.clearInterval(interval);
  }, [apiState, selectedJobId]);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Agent OpenClaw</h1>
          <p>Local multi-agent control console</p>
        </div>
        <div className="topbarActions">
          <span className={`status ${apiState}`}>{statusText}</span>
          <button
            className="secondaryButton"
            type="button"
            onClick={() => refreshAll().catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))}
            disabled={apiState !== "online" || busy}
          >
            Refresh
          </button>
        </div>
      </header>

      <section className="composerBand">
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            submitJob();
          }}
        >
          <label htmlFor="prompt">New Job</label>
          <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          <div className="composerControls">
            <label htmlFor="routingMode">Routing</label>
            <select
              id="routingMode"
              value={routingMode}
              onChange={(event) => setRoutingMode(event.target.value as RoutingMode)}
            >
              {routingModes.map((mode) => (
                <option value={mode} key={mode}>
                  {mode}
                </option>
              ))}
            </select>
            <label htmlFor="maxModelCalls">Budget</label>
            <input
              id="maxModelCalls"
              type="number"
              min="1"
              max="100"
              value={maxModelCalls}
              onChange={(event) => setMaxModelCalls(Number(event.target.value))}
            />
            <button type="submit" disabled={apiState !== "online" || busy || !prompt.trim()}>
              Start Job
            </button>
          </div>
          {error ? <p className="error">{error}</p> : null}
        </form>
      </section>

      <section className="dashboard">
        <aside className="jobList">
          <div className="sectionHeader">
            <h2>Jobs</h2>
            <span>{jobs.length}</span>
          </div>
          <ol>
            {jobs.map((job) => (
              <li key={job.id}>
                <button
                  className={job.id === selectedJobId ? "jobRow selected" : "jobRow"}
                  type="button"
                  onClick={() => setSelectedJobId(job.id)}
                >
                  <span className={`dot ${statusTone(job.status)}`} />
                  <span className="jobMeta">
                    <strong>{job.id}</strong>
                    <span>{job.routingMode}</span>
                  </span>
                  <span className="jobStatus">{job.status}</span>
                  <span className="jobTime">{formatTime(job.createdAt)}</span>
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <section className="jobDetail">
          <div className="sectionHeader detailHeader">
            <div>
              <h2>{selectedFromList?.id ?? "No job selected"}</h2>
              <p>{selectedFromList ? `${selectedFromList.ingressOrigin} / ${selectedFromList.routingMode}` : "-"}</p>
            </div>
            <button
              className="dangerButton"
              type="button"
              onClick={cancelSelectedJob}
              disabled={!isCancellable(selectedFromList) || busy}
            >
              {selectedFromList?.status === "cancelled" ? "Cancelled" : "Cancel"}
            </button>
          </div>

          {selectedFromList ? (
            <dl className="stats">
              <div>
                <dt>Status</dt>
                <dd>{selectedFromList.status}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatTime(selectedFromList.createdAt)}</dd>
              </div>
              <div>
                <dt>Budget</dt>
                <dd>{selectedFromList.maxModelCalls}</dd>
              </div>
              <div>
                <dt>Timeline</dt>
                <dd>{timeline?.summary.totalTimelineItems ?? 0}</dd>
              </div>
            </dl>
          ) : (
            <p className="emptyState">No job loaded.</p>
          )}

          <div className="timelineHeader">
            <h3>Timeline</h3>
            <span>{timeline?.summary.truncated ? "latest items" : "complete"}</span>
          </div>
          <ol className="timeline">
            {timeline?.timeline.length ? (
              timeline.timeline.map((item) => (
                <li key={item.id} className="timelineItem">
                  <time>{formatTime(item.at)}</time>
                  <span className={`source source-${item.source}`}>{item.source.replace("_", " ")}</span>
                  <div>
                    <strong>{compactEventType(item.eventType)}</strong>
                    <p>{item.title}</p>
                    {item.actor ? <small>{item.actor}</small> : null}
                  </div>
                </li>
              ))
            ) : (
              <li className="emptyState">No timeline events.</li>
            )}
          </ol>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
