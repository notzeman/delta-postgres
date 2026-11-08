import React from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import App from "./App";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Servers from "./pages/Servers";
import Activity from "./pages/Activity";
import ImportExport from "./pages/ImportExport";
import Settings from "./pages/Settings";

export const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { path: "/", element: <Dashboard /> },
      { path: "/projects", element: <Projects /> },
      { path: "/projects/:id", element: <ProjectDetail /> },
      { path: "/servers", element: <Servers /> },
      { path: "/activity", element: <Activity /> },
      { path: "/transfer", element: <ImportExport /> },
      { path: "/settings", element: <Settings /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
