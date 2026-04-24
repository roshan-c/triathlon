export function printResult(result: unknown, asJson: boolean, title?: string) {
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

  if (typeof result === "string" || typeof result === "number" || typeof result === "boolean") {
    process.stdout.write(`${result}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
