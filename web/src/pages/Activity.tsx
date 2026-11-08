import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Activity as ActivityIcon, ArrowRight, RefreshCw, Terminal } from "lucide-react";
import { api, duration, fmtDate, formatBytes, timeAgo } from "../api";
import type { Job } from "../types";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Select,
  Spinner,
  StatusBadge,
  Tabs,
} from "../components/ui";
import JobLogModal from "../components/JobLogModal";

export default function Activity() {
  const [filter, setFilter] = useState("all");
  const [logJob, setLogJob] = useState<number | null>(null);
  const jobsQuery = useQuery({
    queryKey: ["jobs"],
    queryFn: () => api<{ jobs: Job[] }>("/jobs?limit=200"),
    refetchInterval: 5_000,
  });

  const jobs = jobsQuery.data?.jobs || [];
  const counts = {
    all: jobs.length,
    running: jobs.filter((job) => job.status === "running" || job.status === "queued").length,
    success: jobs.filter((job) => job.status === "success").length,
    failed: jobs.filter((job) => job.status === "failed").length,
  };
  const filtered = filter === "all" ? jobs : jobs.filter((job) => job.status === filter);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-400/80">
            Activity
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-100">
            Backup jobs
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Manual and scheduled runs, with persisted logs from Borg and pg_dump.
          </p>
        </div>
        <Button onClick={() => jobsQuery.refetch()} loading={jobsQuery.isFetching}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <Tabs
        tabs={[
          { id: "all", label: "All", count: counts.all },
          { id: "running", label: "Active", count: counts.running },
          { id: "success", label: "Success", count: counts.success },
          { id: "failed", label: "Failed", count: counts.failed },
        ]}
        active={filter}
        onChange={setFilter}
      />

      <Card>
        <CardHeader
          title="Job history"
          subtitle="Newest first · live-refreshing"
          action={
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" /> live
            </span>
          }
        />
        {jobsQuery.isLoading ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<ActivityIcon className="h-8 w-8" />}
            title="No jobs in this view"
            description="Run a manual backup or wait for the scheduler."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/5 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Job</th>
                  <th className="px-3 py-3 font-medium">Project</th>
                  <th className="px-3 py-3 font-medium">Trigger</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Started</th>
                  <th className="px-3 py-3 font-medium">Duration</th>
                  <th className="px-3 py-3 font-medium">New data</th>
                  <th className="px-5 py-3 text-right font-medium">Log</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map((job) => (
                  <tr key={job.id} className="hover:bg-white/[0.02]">
                    <td className="px-5 py-3 font-mono text-[11px] text-slate-400">#{job.id}</td>
                    <td className="px-3 py-3">
                      {job.project_slug ? (
                        <Link
                          to={`/projects/${job.project_id}`}
                          className="text-slate-200 hover:text-accent-300"
                        >
                          {job.project_name}
                        </Link>
                      ) : (
                        <span className="text-slate-300">{job.project_name}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-400">{job.trigger}</td>
                    <td className="px-3 py-3">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="px-3 py-3 text-slate-400" title={fmtDate(job.started_at || job.created_at)}>
                      {timeAgo(job.started_at || job.created_at)}
                    </td>
                    <td className="px-3 py-3 text-slate-400">
                      {duration(job.started_at, job.finished_at)}
                    </td>
                    <td className="px-3 py-3 text-slate-300">{formatBytes(job.size_bytes)}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => setLogJob(job.id)}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-accent-300"
                        title="View log"
                      >
                        <Terminal className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {jobs.filter((job) => job.status === "failed").slice(0, 3).map((job) => (
        <Card key={job.id} className="border-rose-500/20 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-rose-200">
                Job #{job.id} · {job.project_name}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[11px] text-rose-300/80">{job.error}</p>
            </div>
            <button
              onClick={() => setLogJob(job.id)}
              className="flex shrink-0 items-center gap-1 text-[11px] text-rose-300 hover:text-rose-200"
            >
              Inspect <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </Card>
      ))}

      <JobLogModal jobId={logJob} onClose={() => setLogJob(null)} />
    </div>
  );
}
