import process from "node:process";
import { runCli } from "../packages/core/src/main.ts";

runCli().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
