import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, duration, fmtDate, formatBytes } from "../api";
import type { JobDetailResponse } from "../types";
import { Badge, Modal, Spinner, StatusBadge } from "./ui";

export default function JobLogModal({
  jobId,
  onClose,
}: {
  jobId: number | null;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api<JobDetailResponse>(`/jobs/${jobId}`),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.job.status;
      return status === "running" || status === "queued" ? 2000 : false;
    },
  });

  const job = query.data?.job;
  return (
    <Modal
      open={jobId !== null}
      onClose={onClose}
      title={`Job #${jobId ?? ""}`}
      subtitle={job ? `${job.project_name} · ${job.trigger}` : "Loading job"}
      wide
    >
      {query.isLoading ? <Spinner /> : null}
      {job ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <StatusBadge status={job.status} />
            <span>Started {fmtDate(job.started_at)}</span>
            <span>Duration {duration(job.started_at, job.finished_at)}</span>
            {job.size_bytes ? <Badge tone="neutral">{formatBytes(job.size_bytes)} new</Badge> : null}
            {job.archive_name ? (
              <span className="font-mono text-[11px] text-slate-500">{job.archive_name}</span>
            ) : null}
          </div>
          {job.error ? (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
              {job.error}
            </div>
          ) : null}
          <pre className="max-h-[55vh] overflow-auto rounded-xl border border-white/5 bg-ink-950/80 p-4 font-mono text-[11px] leading-relaxed text-slate-300">
            {query.data?.log || "No log output yet."}
          </pre>
        </div>
      ) : null}
    </Modal>
  );
}
