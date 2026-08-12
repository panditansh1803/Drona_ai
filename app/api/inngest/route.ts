import { serve } from "inngest/next";
import { inngest } from "@/src/inngest/client";
import { generateProject } from "@/src/inngest/functions/generate-project";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generateProject],
});
