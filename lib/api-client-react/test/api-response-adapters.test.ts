import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  getDashboardSummary,
  listArticles,
  listDigestArticles,
  listSources,
} from "../src/generated/api";
import { ApiError, setAuthTokenGetter, setBaseUrl } from "../src/custom-fetch";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setBaseUrl(null);
  setAuthTokenGetter(null);
});

function jsonResponse(value: unknown, contentType = "application/json"): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": contentType },
  });
}

test("generated article and digest reads normalize arrays and known envelopes", async () => {
  const payloads: unknown[] = [
    [{ id: 1 }],
    { articles: [{ id: 2 }] },
    { data: [{ id: 3 }] },
    { digests: [{ id: 4 }] },
  ];
  globalThis.fetch = async () => jsonResponse(payloads.shift());

  assert.deepEqual(await listArticles(), [{ id: 1 }]);
  assert.deepEqual(await listArticles(), [{ id: 2 }]);
  assert.deepEqual(await listDigestArticles(), [{ id: 3 }]);
  assert.deepEqual(await listDigestArticles(), [{ id: 4 }]);
});

test("generated list reads return an empty array for malformed payloads", async () => {
  const payloads: unknown[] = [null, "not-an-array", {}, { items: {} }];
  globalThis.fetch = async () => jsonResponse(payloads.shift());

  assert.deepEqual(await listArticles(), []);
  assert.deepEqual(await listArticles(), []);
  assert.deepEqual(await listDigestArticles(), []);
  assert.deepEqual(await listDigestArticles(), []);
});

test("dashboard summary defaults incomplete data and preserves valid metadata", async () => {
  globalThis.fetch = async () => jsonResponse({
    pendingReview: 3,
    topArticles: { items: [{ id: 7 }] },
    topicIntelligence: null,
    contentWindowStart: "2026-07-20T00:00:00.000Z",
    minTopicScore: 7,
    signalClusters: { items: [{ topic: "Leadership" }] },
    sectionErrors: "invalid",
    degraded: true,
  });

  const result = await getDashboardSummary();
  const record = result as unknown as Record<string, unknown>;

  assert.equal(result.totalArticlesToday, 0);
  assert.equal(result.pendingReview, 3);
  assert.equal(result.approvedToday, 0);
  assert.equal(result.rejectedToday, 0);
  assert.deepEqual(result.topArticles, [{ id: 7 }]);
  assert.deepEqual(result.articlesByTag, []);
  assert.deepEqual(result.topicIntelligence, []);
  assert.equal(result.contentWindowStart, "2026-07-20T00:00:00.000Z");
  assert.equal(result.minTopicScore, 7);
  assert.deepEqual(record.signalClusters, [{ topic: "Leadership" }]);
  assert.deepEqual(record.sectionErrors, []);
  assert.equal(record.degraded, true);
});

test("dashboard summary safely handles a missing payload", async () => {
  globalThis.fetch = async () => jsonResponse(null);

  const result = await getDashboardSummary();
  assert.equal(result.totalArticlesToday, 0);
  assert.equal(result.totalSources, 0);
  assert.deepEqual(result.topArticles, []);
  assert.deepEqual(result.topicIntelligence, []);
});

test("array and dashboard adapters preserve HTTP errors", async () => {
  for (const read of [listArticles, getDashboardSummary]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "Unavailable" }), {
      status: 503,
      statusText: "Service Unavailable",
      headers: { "content-type": "application/json" },
    });

    await assert.rejects(read(), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503);
      assert.deepEqual(error.data, { error: "Unavailable" });
      return true;
    });
  }
});

test("source reads force no-store JSON handling and normalize envelopes", async () => {
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    capturedInit = init;
    return jsonResponse({ sources: [{ id: "source-1", weight: 1.25 }] }, "text/plain");
  };

  const result = await listSources({ cache: "force-cache" });
  assert.deepEqual(result, [{ id: "source-1", weight: 1.25 }]);
  assert.equal(capturedInit?.cache, "no-store");
  assert.match(new Headers(capturedInit?.headers).get("accept") ?? "", /application\/json/);
});
