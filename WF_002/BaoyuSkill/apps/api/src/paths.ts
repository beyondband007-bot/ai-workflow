import path from "node:path";

const workspaceRoot = path.resolve(process.cwd(), "../..");
const dataRoot = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(workspaceRoot, "data");

export const uploadDir = path.join(dataRoot, "uploads");
export const imageDir = path.join(dataRoot, "images");
