import { readFile } from "node:fs/promises";
import path from "node:path";

const FIXTURE_ROOT = path.join(process.cwd(), "fixtures");

export async function readFixture(kind: "mavlink" | "ros2-map" | "ros2-pose" | "detection" | "spatial" | "import", name: string) {
  const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!safeName || safeName !== name) throw new Error("Invalid fixture name");
  const filePath = path.join(FIXTURE_ROOT, kind, `${safeName}.json`);
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}
