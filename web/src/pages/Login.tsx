import React, { useState } from "react";
import { Database, HardDrive, LockKeyhole } from "lucide-react";
import { api } from "../api";
import { Button, Card, ErrorBox, Field, Input } from "../components/ui";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent-500/20 bg-accent-500/10 shadow-glow">
            <HardDrive className="h-7 w-7 text-accent-400" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">DeltaPostgres</h1>
          <p className="mt-1 text-sm text-slate-500">
            Borg-backed backup console for PostgreSQL containers
          </p>
        </div>

        <Card className="p-6">
          <form onSubmit={submit} className="space-y-4">
            <Field label="Username">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="admin"
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                autoFocus
              />
            </Field>
            {error ? <ErrorBox message={error} /> : null}
            <Button type="submit" variant="primary" className="w-full" loading={loading}>
              <LockKeyhole className="h-4 w-4" />
              Sign in
            </Button>
          </form>
          <div className="mt-5 flex items-center justify-center gap-4 border-t border-white/5 pt-4 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <Database className="h-3 w-3" /> PostgreSQL
            </span>
            <span className="flex items-center gap-1">
              <HardDrive className="h-3 w-3" /> Borg dedup
            </span>
          </div>
        </Card>
        <p className="mt-4 text-center text-[11px] text-slate-600">
          First run? Create an admin with{" "}
          <span className="font-mono text-slate-500">docker compose exec dashboard npm run create-admin</span>
        </p>
      </div>
    </div>
  );
}
