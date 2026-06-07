import type { VerificationResults } from "./generation-types";

export function serializeVerificationResults(results: VerificationResults): string {
  return JSON.stringify(results, null, 2);
}
