/**
 * Frontend API client methods for interacting with Next.js backend API routes.
 * Replaces client mocks with real API route calls keeping standard signatures.
 */

async function handleResponse<T>(res: Response, fallbackError: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || fallbackError);
  }
  return res.json();
}

export async function createProject(topic: string, description: string): Promise<{ projectId: string }> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, description }),
  });
  return handleResponse(res, "Failed to create project");
}

export async function approveTopic(projectId: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/projects/${projectId}/approve-topic`, {
    method: "POST",
  });
  return handleResponse(res, "Failed to approve topic");
}

export async function rejectTopic(projectId: string, feedback: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/projects/${projectId}/reject-topic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedback }),
  });
  return handleResponse(res, "Failed to reject topic");
}

export async function approveScript(projectId: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/projects/${projectId}/approve-script`, {
    method: "POST",
  });
  return handleResponse(res, "Failed to approve script");
}

export async function updateShotText(projectId: string, shotId: string, text: string) {
  const res = await fetch(`/api/projects/${projectId}/shots/${shotId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return handleResponse(res, "Failed to update shot text");
}

export async function regenerateShotAsset(
  projectId: string,
  shotId: string,
  assetType: "image" | "video" | "voiceover"
) {
  const res = await fetch(`/api/projects/${projectId}/shots/${shotId}/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetType }),
  });
  return handleResponse(res, "Failed to regenerate asset");
}

export async function requestRender(projectId: string): Promise<{ success: boolean }> {
  console.log(`[requestRender] Calling POST /api/projects/${projectId}/render`);
  const res = await fetch(`/api/projects/${projectId}/render`, {
    method: "POST",
  });
  console.log(`[requestRender] Response status: ${res.status} ${res.statusText}`);
  return handleResponse(res, "Failed to request render");
}

export async function getProjectState(projectId: string) {
  const res = await fetch(`/api/projects/${projectId}`);
  const data = await handleResponse<{ project?: { status: string; shots?: { shot_id: string; generated_image_url?: string | null; generated_video_url?: string | null; generated_voiceover_url?: string | null }[] } }>(res, "Failed to fetch project state");

  // Diagnostic: log the response shape once to verify URL fields arrive from the database
  if (data?.project?.shots?.length) {
    const sample = data.project.shots[0];
    console.log(
      `[getProjectState] project.status=${data.project.status} | shots=${data.project.shots.length}`,
      `| shot[0] urls: img=${sample.generated_image_url ?? "null"} vid=${sample.generated_video_url ?? "null"} vo=${sample.generated_voiceover_url ?? "null"}`
    );
  }

  return data;
}
