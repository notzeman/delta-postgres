import React, { useState } from "react";
import { LockKeyhole } from "lucide-react";
import { api } from "../api";
import { Button, Card, ErrorBox, Field, Input } from "../components/ui";
import DeltaMark from "../components/DeltaMark";
import ChunkStrip from "../components/ChunkStrip";

const SETUP_COMMAND = "docker compose exec dashboard npm run create-admin";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
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
      setError(err instanceof Error ? err.message : "Sign-in failed. Check your username and password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <DeltaMark className="h-10 w-10" />
          <h1 className="mt-5 text-[34px] font-light leading-tight tracking-tight text-slate-100">
            Sign in to DeltaPostgres
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">
            Encrypted, deduplicated backups for your PostgreSQL containers.
          </p>
          <ChunkStrip logical={10} stored={2} count={24} className="mt-6 opacity-80" />
        </div>

        <Card className="p-6">
          <form onSubmit={submit} className="space-y-4">
            <Field label="Username">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                required
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            {error ? <ErrorBox message={error} /> : null}
            <Button type="submit" variant="primary" className="w-full" loading={loading}>
              {loading ? null : <LockKeyhole className="h-4 w-4" />}
              Sign in
            </Button>
          </form>
        </Card>

        <div className="mt-6 text-[13px] text-slate-500">
          <p>No admin account yet? Create one on the server:</p>
          <code className="mt-2 block font-mono overflow-x-auto whitespace-nowrap glass rounded-2xl px-4 py-2.5 text-xs text-slate-300">
            {SETUP_COMMAND}
          </code>
        </div>
      </div>
    </main>
  );
}
