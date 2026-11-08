import React, { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Servers from "./pages/Servers";
import Activity from "./pages/Activity";
import ImportExport from "./pages/ImportExport";
import Settings from "./pages/Settings";

export interface Username {
  username: string;
}

export default function App() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: Username | null }>("/auth/me"),
    retry: false,
  });

  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
    };
    window.addEventListener("dp:unauthorized", handler);
    return () => window.removeEventListener("dp:unauthorized", handler);
  }, [queryClient]);

  if (meQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <span className="live-dot h-2 w-2 rounded-full bg-accent-400" />
          Loading DeltaPostgres…
        </div>
      </div>
    );
  }

  if (!meQuery.data?.user) {
    return <Login onSuccess={() => queryClient.invalidateQueries({ queryKey: ["me"] })} />;
  }

  return (
    <Layout user={meQuery.data.user}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/servers" element={<Servers />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/transfer" element={<ImportExport />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
