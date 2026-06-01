import React, { useEffect, useMemo, useRef, useState } from "react";
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
  type ListJobsResponse,
  type RoutingMode
} from "./api";
import "./styles.css";

type ApiState = "checking" | "online" | "offline";
type JobStatusFilter = "all" | "running" | "waiting_for_human" | "cancelled";

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

const jobStatusFilters: Array<{ id: JobStatusFilter; label: string; status?: JobStatus }> = [
  { id: "all", label: "All" },
  { id: "running", label: "Running", status: "running" },
  { id: "waiting_for_human", label: "Waiting", status: "waiting_for_human" },
  { id: "cancelled", label: "Cancelled", status: "cancelled" }
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
  const [jobListPage, setJobListPage] = useState<ListJobsResponse["page"] | null>(null);
  const [jobStatusFilter, setJobStatusFilter] = useState<JobStatusFilter>("all");
  const [jobPromptFilter, setJobPromptFilter] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [selectedJob, setSelectedJob] = useState<JobRecord | null>(null);
  const [timeline, setTimeline] = useState<JobTimeline | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobsRequestSeq = useRef(0);

  const statusText = useMemo(() => {
    if (apiState === "online") return "API online";
    if (apiState === "offline") return "API offline";
    return "Checking API";
  }, [apiState]);

  const selectedFromList = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? selectedJob,
    [jobs, selectedJob, selectedJobId]
  );

  const activeStatusFilter = jobStatusFilters.find((filter) => filter.id === jobStatusFilter);
  const trimmedJobPromptFilter = jobPromptFilter.trim();

  async function refreshJobs(preferredJobId = selectedJobId) {
    const requestSeq = ++jobsRequestSeq.current;
    const response = await listJobs({
      limit: 50,
      status: activeStatusFilter?.status,
      prompt: trimmedJobPromptFilter || undefined,
      sort: "createdAt",
      order: "desc"
    });
    if (requestSeq !== jobsRequestSeq.current) {
      return selectedJobId;
    }

    setJobs(response.jobs);
    setJobListPage(response.page);
    const nextSelectedId = response.jobs.some((job) => job.id === preferredJobId)
      ? preferredJobId
      : response.jobs[0]?.id || "";
    setSelectedJobId(nextSelectedId);
    return nextSelectedId;
  }

  async function loadMoreJobs() {
    if (!jobListPage?.nextCursor) return;
    setBusy(true);
    setError(null);
    try {
      const requestSeq = ++jobsRequestSeq.current;
      const response = await listJobs({
        limit: 50,
        status: activeStatusFilter?.status,
        prompt: trimmedJobPromptFilter || undefined,
        sort: "createdAt",
        order: "desc",
        cursor: jobListPage.nextCursor
      });
      if (requestSeq !== jobsRequestSeq.current) {
        return;
      }

      setJobs((currentJobs) => {
        const existingIds = new Set(currentJobs.map((job) => job.id));
        return [...currentJobs, ...response.jobs.filter((job) => !existingIds.has(job.id))];
      });
      setJobListPage(response.page);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
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
  }, [apiState, selectedJobId, jobStatusFilter, trimmedJobPromptFilter]);

  useEffect(() => {
    if (apiState !== "online") return;
    refreshAll("").catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [jobStatusFilter, trimmedJobPromptFilter, apiState]);

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
            <span>{jobListPage?.hasMore ? `${jobs.length}+` : jobs.length}</span>
          </div>
          <div className="jobFilters">
            <div className="filterSegments" aria-label="Job status filter">
              {jobStatusFilters.map((filter) => (
                <button
                  key={filter.id}
                  className={filter.id === jobStatusFilter ? "filterSegment active" : "filterSegment"}
                  data-filter={filter.id}
                  type="button"
                  onClick={() => setJobStatusFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <input
              id="jobSearch"
              type="search"
              aria-label="Search job prompts"
              placeholder="Search prompts"
              value={jobPromptFilter}
              onChange={(event) => setJobPromptFilter(event.target.value)}
            />
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
            {jobs.length === 0 ? <li className="emptyState">No jobs match.</li> : null}
          </ol>
          {jobListPage?.hasMore ? (
            <div className="loadMoreRow">
              <button className="secondaryButton" type="button" onClick={loadMoreJobs} disabled={busy}>
                Load More
              </button>
            </div>
          ) : null}
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
