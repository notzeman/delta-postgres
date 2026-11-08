import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  FileArchive,
  FileJson,
  HardDrive,
  Info,
  UploadCloud,
} from "lucide-react";
import { api, downloadUrl } from "../api";
import type { Project } from "../types";
import {
  Button,
  Card,
  CardHeader,
  ErrorBox,
  Field,
  Input,
  Spinner,
  SuccessBox,
} from "../components/ui";
import Picker from "../components/Picker";

export default function ImportExport() {
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ projects: Project[] }>("/projects"),
  });
  const [repoProject, setRepoProject] = useState("");
  const [importProject, setImportProject] = useState("");
  const [mode, setMode] = useState("archive");
  const [archiveName, setArchiveName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const projects = projectsQuery.data?.projects || [];

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a .tar file first");
      const form = new FormData();
      form.append("projectId", importProject);
      form.append("mode", mode);
      if (archiveName) form.append("archiveName", archiveName);
      form.append("file", file);
      return api<{ ok: boolean; output: string }>("/import", {
        method: "POST",
        body: form,
      });
    },
    onSuccess: (data) => {
      setResult(data.output || "Import completed.");
      setError("");
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Import failed");
      setResult("");
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-400/80">
          Transfer
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-100">
          Import & export
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Move encrypted Borg data between hosts. Export a single archive as a tar, a full project
          repository, all repositories, or a lightweight catalog of projects and schedules.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Export"
            subtitle="Downloads are streamed and authenticated with your session"
            action={<ArrowDownToLine className="h-4 w-4 text-slate-500" />}
          />
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-ink-950/40 p-3">
              <div className="flex items-center gap-3">
                <FileJson className="h-5 w-5 text-accent-400/80" />
                <div>
                  <p className="text-xs font-medium text-slate-200">Catalog only</p>
                  <p className="text-[11px] text-slate-500">Projects, schedules, retention · no backup data</p>
                </div>
              </div>
              <a href={downloadUrl("/export/catalog")} className="btn-secondary text-xs">
                Download JSON
              </a>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-ink-950/40 p-3">
              <div className="flex items-center gap-3">
                <HardDrive className="h-5 w-5 text-accent-400/80" />
                <div>
                  <p className="text-xs font-medium text-slate-200">All repositories</p>
                  <p className="text-[11px] text-slate-500">Full /backups tree, including encrypted Borg repos</p>
                </div>
              </div>
              <a href={downloadUrl("/export/all")} className="btn-secondary text-xs">
                Download tar
              </a>
            </div>

            <div className="rounded-xl border border-white/5 bg-ink-950/40 p-3">
              <div className="mb-2 flex items-center gap-3">
                <Database className="h-5 w-5 text-accent-400/80" />
                <div>
                  <p className="text-xs font-medium text-slate-200">Single project repository</p>
                  <p className="text-[11px] text-slate-500">Best for moving one project to another host</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Picker
                  value={repoProject}
                  onChange={setRepoProject}
                  options={projects.map((project) => ({
                    value: String(project.id),
                    label: project.name,
                    description: `${project.server_name || "local"} · ${project.slug}`,
                    icon: <Database className="h-4 w-4" />,
                  }))}
                  placeholder="Select a project…"
                  searchable
                  ariaLabel="Project repository"
                  className="flex-1"
                />
                <a
                  href={repoProject ? downloadUrl(`/projects/${repoProject}/export`) : "#"}
                  className={`btn-secondary text-xs ${!repoProject ? "pointer-events-none opacity-50" : ""}`}
                >
                  Download repo
                </a>
              </div>
            </div>

            <div className="rounded-xl border border-white/5 bg-ink-950/40 p-3">
              <div className="mb-2 flex items-center gap-3">
                <FileArchive className="h-5 w-5 text-accent-400/80" />
                <div>
                  <p className="text-xs font-medium text-slate-200">Single archive</p>
                  <p className="text-[11px] text-slate-500">Open a project and use the download icon on an archive</p>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Archive exports use <span className="font-mono text-slate-400">borg export-tar</span> and
                can be re-imported with <span className="font-mono text-slate-400">borg import-tar</span>.
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Import"
            subtitle="Upload a Borg archive tar or a full project repository tar"
            action={<ArrowUpFromLine className="h-4 w-4 text-slate-500" />}
          />
          <form
            className="space-y-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              setResult("");
              setError("");
              importMutation.mutate();
            }}
          >
            <Field label="Target project">
              <Picker
                value={importProject}
                onChange={setImportProject}
                options={projects.map((project) => ({
                  value: String(project.id),
                  label: project.name,
                  description: `${project.server_name || "local"} · ${project.slug}`,
                  icon: <Database className="h-4 w-4" />,
                }))}
                placeholder="Select a project…"
                searchable
                ariaLabel="Target project"
              />
            </Field>
            <Field label="Import mode">
              <Picker
                value={mode}
                onChange={setMode}
                options={[
                  {
                    value: "archive",
                    label: "Single archive",
                    description: "Import one tar with borg import-tar",
                  },
                  {
                    value: "repo",
                    label: "Full repository",
                    description: "Replace the target project's Borg repo",
                  },
                ]}
                ariaLabel="Import mode"
              />
            </Field>
            {mode === "archive" ? (
              <Field
                label="Archive name"
                hint="Borg archive name inside the project repository. Do not include .tar."
              >
                <Input
                  value={archiveName}
                  onChange={(event) => setArchiveName(event.target.value)}
                  placeholder="2026-11-08T20-15-00Z"
                  className="font-mono"
                  required
                />
              </Field>
            ) : null}
            <Field label="Tar file" hint="Maximum upload size is 50 GB.">
              <Input
                type="file"
                accept=".tar,.tgz,.gz,application/x-tar"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                required
              />
            </Field>
            {mode === "repo" ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Importing a full repository replaces the target project&apos;s existing Borg repository.
                The archive must have been encrypted with the same passphrase.
              </div>
            ) : null}
            {error ? <ErrorBox message={error} /> : null}
            {result ? <SuccessBox message={result} /> : null}
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                loading={importMutation.isPending}
                disabled={!importProject || !file || (mode === "archive" && !archiveName)}
              >
                <UploadCloud className="h-4 w-4" /> Import
              </Button>
            </div>
          </form>
        </Card>
      </div>

      {importMutation.isPending ? <Spinner label="Uploading and importing…" /> : null}
    </div>
  );
}
