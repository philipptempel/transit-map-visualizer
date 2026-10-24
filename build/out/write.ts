import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Writes `text` unless the file already holds exactly that. Returns whether it differed. */
export async function writeIfChanged(file: string, text: string, dryRun = false): Promise<boolean> {
  const old = await readFile(file, "utf8").catch(() => null);
  if (old === text) return false;
  if (!dryRun) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  return true;
}
