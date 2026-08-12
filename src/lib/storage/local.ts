import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export class StorageError extends Error {
  constructor(message: string, public override cause?: unknown) {
    super(`Storage Error: ${message}`);
    this.name = "StorageError";
  }
}

/**
 * Unified storage helper for saving AI-generated images, videos, audio, and assets.
 * Handles production R2 uploads when credentials are present, falling back to
 * local `public/generated/<subDir>/` storage with mandatory directory creation,
 * async file writing, and immediate fs.statSync size verification.
 */
export async function saveGeneratedFile(
  buffer: Buffer,
  fileName: string,
  subDir: "images" | "videos" | "audio" | "temp" = "images",
  contentType: string = "application/octet-stream"
): Promise<string> {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  // 1. Production R2 storage upload if credentials are provided
  if (accessKeyId && secretAccessKey && bucketName) {
    try {
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

      const key = `generated-${subDir}/${fileName}`;

      await s3.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        })
      );

      const baseUrl = publicUrl ? publicUrl.replace(/\/$/, "") : `https://${bucketName}.r2.dev`;
      const url = `${baseUrl}/${key}`;
      console.log(`[Storage Success - R2] Key: ${key} | URL: ${url} | Size: ${buffer.length} bytes`);
      return url;
    } catch (err) {
      console.warn("[saveGeneratedFile] R2 upload failed, falling back to local public directory:", err);
    }
  }

  // 2. Local public directory storage fallback
  const folderPath = path.join(process.cwd(), "public", "generated", subDir);
  
  // Mandatory: ensure directory exists before writing
  if (!fsSync.existsSync(folderPath)) {
    fsSync.mkdirSync(folderPath, { recursive: true });
  }

  const filePath = path.join(folderPath, fileName);
  await fs.writeFile(filePath, buffer);

  // Mandatory: verify file exists on disk and has size > 0
  const stats = fsSync.statSync(filePath);
  if (stats.size === 0) {
    throw new StorageError(`Failed to save file: 0-byte file written at ${filePath}`);
  }

  const relativeUrl = `/generated/${subDir}/${fileName}`;
  console.log(`[Storage Success - Local] Path: ${filePath} | URL: ${relativeUrl} | Size: ${stats.size} bytes`);
  return relativeUrl;
}
