import { createHash } from "node:crypto";

export function sha256Hex(input: string | Buffer) {
  return createHash("sha256").update(input).digest("hex");
}

