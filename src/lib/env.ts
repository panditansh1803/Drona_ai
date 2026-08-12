import path from "path";
import fs from "fs";

/**
 * Robustly reads an environment variable, fallback-loading from .env.local if missing or empty string.
 */
export function getEnvVar(key: string): string | undefined {
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

  return val && val.trim() !== "" ? val.trim() : undefined;
}
