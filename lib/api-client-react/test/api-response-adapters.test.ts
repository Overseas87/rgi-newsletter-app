import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  getCurrentStoryOpportunityWindow,
  getDashboardSummary,
  listArticles,
  listDigestArticles,
  listSources,
  selectStoryOpportunityProfessor,
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

test("Story Opportunity operations use the generated endpoint-specific method, body, and bearer credential", async () => {
  const requests: { input: string; init?: RequestInit }[] = [];
  setAuthTokenGetter(() => "editor-test-token");
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return jsonResponse(
      requests.length === 1
        ? {
            window: null,
            items: [],
            total: 0,
            readsEnabled: true,
            writesEnabled: true,
          }
        : {
            opportunity: { id: "opp_test_01" },
            readsEnabled: true,
            writesEnabled: true,
          },
    );
  };

  await getCurrentStoryOpportunityWindow();
  await selectStoryOpportunityProfessor("opp_test_01", {
    professorId: "prof_test_01",
    expectedRevision: 1,
    reason: "Editorial rationale",
  });

  assert.equal(requests[0]?.input, "/api/opportunity-windows/current");
  assert.equal(requests[0]?.init?.method, "GET");
  assert.equal(new Headers(requests[0]?.init?.headers).get("authorization"), "Bearer editor-test-token");
  assert.equal(requests[1]?.input, "/api/story-opportunities/opp_test_01/select-professor");
  assert.equal(requests[1]?.init?.method, "POST");
  assert.equal(new Headers(requests[1]?.init?.headers).get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    professorId: "prof_test_01",
    expectedRevision: 1,
    reason: "Editorial rationale",
  });
});

test("Story Opportunity reads preserve authorization and feature errors", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: "Story Opportunity reads are disabled",
        code: "STORY_OPPORTUNITIES_READS_DISABLED",
      }),
      {
        status: 403,
        statusText: "Forbidden",
        headers: { "content-type": "application/json" },
      },
    );

  await assert.rejects(getCurrentStoryOpportunityWindow(), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 403);
    assert.deepEqual(error.data, {
      error: "Story Opportunity reads are disabled",
      code: "STORY_OPPORTUNITIES_READS_DISABLED",
    });
    return true;
  });
});
