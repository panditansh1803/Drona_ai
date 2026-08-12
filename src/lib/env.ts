import path from "path";
import fs from "fs";

/**
 * Robustly reads an environment variable, fallback-loading from .env.local if missing or empty string.
 * If required is true (default) and the variable is missing from both process.env and disk,
 * throws a clear error naming the missing variable for production safety (e.g. Vercel deployments).
 */
export function getEnvVar(key: string, required: boolean = true): string | undefined {
  let val = process.env[key];

  if (!val || val.trim() === "") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const dotenv = require("dotenv");
      const envLocalPath = path.join(process.cwd(), ".env.local");
      if (fs.existsSync(envLocalPath)) {
        const parsed = dotenv.parse(fs.readFileSync(envLocalPath));
        if (parsed[key]) {
          val = parsed[key];
        }
      }
    } catch {
      /* ignore dotenv error */
    }
  }

  const finalVal = val && val.trim() !== "" ? val.trim() : undefined;

  if (!finalVal && required) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return finalVal;
}
