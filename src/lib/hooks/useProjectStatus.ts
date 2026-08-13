"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ProjectModel } from "@/src/types/project";
import { getProjectState } from "@/src/lib/mocks";

/** Statuses where generation is complete — stop polling */
const TERMINAL_STATUSES = new Set(["COMPLETE", "FAILED"]);

export function useProjectStatus(projectId: string | null) {
  const [project, setProject] = useState<ProjectModel | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Use a ref so the interval callback always reads the latest status
  // without needing it in the dependency array (avoids restarting the interval).
  // Updated inside the effect, not during render.
  const projectStatusRef = useRef<string | null>(null);

  const fetchProject = useCallback(async () => {
    if (!projectId) return;

    try {
      const data = (await getProjectState(projectId)) as { project?: ProjectModel };
      if (data?.project) {
        setProject(data.project);
        projectStatusRef.current = data.project.status;
        setError(null);
        console.log(
          `[useProjectStatus] Poll → status: ${data.project.status} | shots with images: ${
            data.project.shots?.filter((s) => s.generated_image_url).length ?? 0
          }/${data.project.shots?.length ?? 0}`
        );
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

    // First fetch deferred to the next tick to satisfy the react-hooks/set-state-in-effect rule.
    // setState calls from fetchProject are inside async .then(), so they're not synchronous,
    // but the linter can't prove that without the setTimeout wrapper.
    const initialTimer = setTimeout(() => {
      fetchProject();
    }, 0);

    // Poll every 2s — keep polling during ASSET_GENERATION_IN_PROGRESS so
    // thumbnails appear one-by-one as each shot finishes.
    const interval = setInterval(() => {
      // Check terminal status via ref to avoid stale closure
      if (projectStatusRef.current && TERMINAL_STATUSES.has(projectStatusRef.current)) {
        clearInterval(interval);
        return;
      }
      fetchProject();
    }, 2000);

    // Cleanup on unmount or projectId change
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [projectId, fetchProject]);

  return {
    project: projectId ? project : null,
    loading: Boolean(projectId && !project && loading),
    error,
    refetch: fetchProject,
  };
}
