import path from "path";
import os from "os";
import fs from "fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import type { RenderShot } from "./types";

export class RenderError extends Error {
  constructor(message: string, public override cause?: unknown) {
    super(`Render Error: ${message}`);
    this.name = "RenderError";
  }
}

/**
 * Uploads a local file buffer to Cloudflare R2 bucket and returns public CDN URL.
 */
async function uploadToR2(filePath: string, key: string): Promise<string> {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!accessKeyId || !secretAccessKey || !bucketName) {
    console.warn("[R2 Upload] Cloudflare R2 credentials missing. Returning local render path.");
    return `/renders/${key}`;
  }

  const accountId = process.env.R2_ACCOUNT_ID || "";
  const endpoint = accountId
    ? `https://${accountId}.r2.cloudflarestorage.com`
    : process.env.R2_ENDPOINT || "";

  const s3 = new S3Client({
    region: "auto",
    endpoint: endpoint || undefined,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const fileBuffer = fs.readFileSync(filePath);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: "video/mp4",
    })
  );

  const baseUrl = publicUrl ? publicUrl.replace(/\/$/, "") : `https://${bucketName}.r2.dev`;
  return `${baseUrl}/${key}`;
}

/**
 * Bundles and renders the Remotion video composition for a project,
 * then uploads the MP4 output to Cloudflare R2 and returns its CDN URL.
 */
export async function renderAndUploadVideo(
  projectId: string,
  shots: RenderShot[]
): Promise<string> {
  try {
    const entryPoint = path.join(process.cwd(), "render", "index.ts");
    const tmpDir = os.tmpdir();
    const outputFileName = `render_${projectId}_${Date.now()}.mp4`;
    const outputPath = path.join(tmpDir, outputFileName);

    // 1. Bundle the Remotion project
    const bundled = await bundle({
      entryPoint,
      webpackOverride: (config) => config,
    });

    // 2. Select composition metadata
    const composition = await selectComposition({
      serveUrl: bundled,
      id: "DronaVideo",
      inputProps: {
        shots,
        fps: 30,
      },
    });

    // 3. Render MP4 video file
    await renderMedia({
      composition,
      serveUrl: bundled,
      codec: "h264",
      outputLocation: outputPath,
      inputProps: {
        shots,
        fps: 30,
      },
    });

    // 4. Upload output MP4 to Cloudflare R2 CDN
    const r2Key = `renders/${projectId}/${outputFileName}`;
    const cdnUrl = await uploadToR2(outputPath, r2Key);

    return cdnUrl;
  } catch (error) {
    if (error instanceof RenderError) throw error;
    throw new RenderError(`Failed to render video for project ${projectId}`, error);
  }
}
