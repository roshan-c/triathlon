import { test } from "node:test";
import assert from "node:assert/strict";
import { TriathlonClient } from "../src/index.js";

test("request invokes fetch with the platform receiver", async () => {
  const fetcher: typeof globalThis.fetch = function (this: typeof globalThis) {
    assert.equal(this, globalThis);
    return Promise.resolve(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  const client = new TriathlonClient({ baseUrl: "http://localhost:8080", fetch: fetcher });

  assert.deepEqual(await client.projects(), []);
});
