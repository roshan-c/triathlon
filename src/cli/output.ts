import type { JSONValue } from "convex/values";
import { z } from "zod";

const printableScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

export function printResult(result: JSONValue | undefined, asJson: boolean, title?: string) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (title) {
    process.stdout.write(`${title}\n`);
  }

  if (result === null || result === undefined) {
    process.stdout.write("OK\n");
    return;
  }

  const scalar = printableScalarSchema.safeParse(result);
  if (scalar.success) {
    process.stdout.write(`${scalar.data}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
