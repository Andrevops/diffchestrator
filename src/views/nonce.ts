import { randomBytes } from "crypto";

/** Cryptographically random CSP nonce (128 bits, base64). */
export function getNonce(): string {
  return randomBytes(16).toString("base64");
}
