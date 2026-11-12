export interface Project {
  id: number;
  server_id: number;
  server_name?: string;
  server_slug?: string;
  server_type?: string;
  server_host?: string | null;
  server_port?: number | null;
  name: string;
  slug: string;
  source: string;
  enabled: boolean;
  ignored: boolean;
  container_id: string | null;
  container_name: string | null;
  container_image: string | null;
  compose_project: string | null;
  pg_user: string;
  pg_default_db: string | null;
  databases: string[] | null;
  schedule_cron: string | null;
  keep_daily: number | null;
  keep_weekly: number | null;
  keep_monthly: number | null;
  compression: string;
  notes: string | null;
  last_backup_at: string | null;
  last_status: string | null;
  last_error: string | null;
  next_run_at: string | null;
  repoBytes?: number;
  archiveCount?: number;
  containerState?: string;
  containerImage?: string;
  lastJob?: Job | null;
}

export interface Archive {
  id: number;
  project_id: number;
  job_id: number | null;
  name: string;
  created_at: string | null;
  size_bytes: number | null;
  original_size: number | null;
  deduplicated_size: number | null;
  file_count: number | null;
  verified_at: string | null;
}

export interface ArchiveDatabase {
  name: string;
  path: string;
  sizeBytes: number;
  format?: "plain" | "archive";
}

export interface Job {
  id: number;
  project_id: number;
  project_name?: string;
  project_slug?: string;
  trigger: string;
  status: string;
  archive_name: string | null;
  started_at: string | null;
  finished_at: string | null;
  size_bytes: number | null;
  error: string | null;
  created_at: string;
}

export interface DiscoveredContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  composeProject: string | null;
  composeService: string | null;
  workingDir: string | null;
  pgUser: string;
  pgDefaultDb: string | null;
  databases: Array<{ name: string; sizeBytes: number }>;
  pgVersion: string;
  error?: string;
}

export interface DiscoveredProject {
  key: string;
  name: string;
  serverId: number;
  serverName: string;
  serverSlug: string;
  composeProject: string | null;
  workingDir: string | null;
  status: string;
  containers: DiscoveredContainer[];
  databases: string[];
  sizeBytes: number;
  pgVersion: string;
  managedProjectId: number | null;
  ignored: boolean;
  canAdd: boolean;
  alreadyManaged: boolean;
  error?: string;
}

export interface ContainerOption {
  id: string;
  name: string;
  image: string;
  state: string;
  composeProject: string | null;
  composeService: string | null;
  isPostgres: boolean;
  pgUser: string;
  pgDefaultDb: string | null;
}

export interface ComposeProjectSummary {
  name: string;
  serverId: number;
  serverName: string;
  containerCount: number;
  running: number;
  hasPostgres: boolean;
}

export interface DockerServer {
  id: number;
  name: string;
  slug: string;
  type: "local" | "tcp" | "ssh";
  protocol: "socket" | "http" | "https" | "ssh";
  host: string | null;
  port: number | null;
  socket_path: string | null;
  ssh_username: string | null;
  tls_verify: boolean;
  enabled: boolean;
  hasCa?: boolean;
  hasCert?: boolean;
  hasKey?: boolean;
  hasSshPassword?: boolean;
  created_at: string;
  updated_at: string;
  status?: {
    online: boolean;
    version?: string;
    apiVersion?: string;
    error?: string;
  };
  projectCount?: number;
}

export interface DiscoveryResponse {
  projects: DiscoveredProject[];
  autoAdded: number;
  autoAddProjects: boolean;
  composeProjects: ComposeProjectSummary[];
  summary: { total: number; withPostgres: number };
  servers?: DockerServer[];
}

export interface Health {
  time: string;
  appVersion: string;
  timezone: string;
  worker: { running: number; concurrency: number };
  database: { ok: boolean; error?: string };
  docker: { ok: boolean; version?: string; apiVersion?: string; error?: string };
  borg: { ok: boolean; version?: string; error?: string };
  disk: { ok: boolean; total?: number; free?: number; usedPct?: number; error?: string };
}

export interface Stats {
  serverId?: number | null;
  projects: { total: number; enabled: number; failing: number };
  archives: number;
  originalBytes: number;
  deduplicatedBytes: number;
  compressedBytes: number;
  lastSuccessAt: string | null;
  last24: Record<string, number>;
  recentJobs: Job[];
  /** Daily totals for the last 30 days; `day` is YYYY-MM-DD in the configured timezone. */
  storageDaily: Array<{
    day: string;
    archives: number;
    original_size: number;
    deduplicated_size: number;
  }>;
}

export interface Settings {
  globalCron: string;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  notificationWebhook: string;
  autoAddProjects: boolean;
  timezone: string;
  concurrency: number;
  appVersion: string;
  borgVersion: string;
  dockerSocket: string;
  backupRoot: string;
}

export interface ProjectDetailResponse {
  project: Project;
  server?: DockerServer | null;
  archives: Archive[];
  jobs: Job[];
  container: {
    id: string;
    name: string;
    image: string;
    state: string;
    composeProject: string | null;
    databases: Array<{ name: string; sizeBytes: number }>;
    pgVersion: string;
  } | null;
}

export interface JobDetailResponse {
  job: Job;
  log: string;
}

export interface AuditEntry {
  id: number;
  actor: string | null;
  action: string;
  target: string | null;
  meta?: unknown;
  created_at: string;
}

export interface AuditResponse {
  audit: AuditEntry[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
