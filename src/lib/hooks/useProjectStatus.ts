"use client";

import { useState, useEffect, useCallback } from "react";
import type { ProjectModel } from "@/src/types/project";
import { getProjectState } from "@/src/lib/mocks";

export function useProjectStatus(projectId: string | null) {
  const [project, setProject] = useState<ProjectModel | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProject = useCallback(async () => {
    if (!projectId) return;

    try {
      const data = (await getProjectState(projectId)) as { project?: ProjectModel };
      if (data?.project) {
        setProject(data.project);
        setError(null);
      }
    } catch (err) {
      console.error("[useProjectStatus] Poll error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch status");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;

    const timer = setTimeout(() => {
      fetchProject();
    }, 0);

    const interval = setInterval(() => {
      fetchProject();
    }, 2000);

    if (project?.status === "COMPLETE" || project?.status === "FAILED") {
      clearInterval(interval);
    }

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [projectId, fetchProject, project?.status]);

  return {
    project: projectId ? project : null,
    loading: Boolean(projectId && !project && loading),
    error,
    refetch: fetchProject,
  };
}
