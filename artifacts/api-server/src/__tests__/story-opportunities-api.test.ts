import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import type { Article } from "@workspace/db";
import { ProfessorProfileSchema } from "@workspace/api-zod";
import { MemoryStoryOpportunityRepository } from "../lib/story-opportunity-repository";
import { StoryOpportunityService } from "../lib/story-opportunity-service";
import { createStoryOpportunitiesRouter } from "../routes/story-opportunities";

const now = new Date("2026-07-20T12:00:00.000Z");

const testArticle = {
  id: 101,
  headline: "Leadership systems face a new test",
  url: "https://example.com/story-101",
  sourceName: "Example News",
  sourceUrl: "https://example.com",
  author: "Reporter",
  authorType: "Journalist",
  platform: "news",
  isEmergingSignal: false,
  isPrimarySignal: true,
  relevancyScore: 8,
  authenticityScore: 8,
  viewpoint: null,
  topicTags: ["Leadership & Organizations"],
  teaserSummary: "A leadership story.",
  publishedAt: new Date("2026-07-20T09:00:00.000Z"),
  scrapedAt: new Date("2026-07-20T09:05:00.000Z"),
  content: null,
  status: "pending",
  disciplineAlignment: "System Vitality",
  scoreExplanation: "The development has direct organizational implications.",
  sourceAuthorityScore: 8,
  rgiProfileVersion: "rgi-v1",
} as Article;

const testProfessor = ProfessorProfileSchema.parse({
  id: "prof_api_0001",
  fullName: "Professor API",
  academicTitle: "Professor",
  department: "Management",
  coursesTaught: [],
  expertiseTags: ["Leadership & Organizations"],
  researchInterests: [],
  professionalExperienceTags: [],
  academicExperienceTags: [],
  industries: [],
  topicInterests: [],
  regions: [],
  affiliations: [],
  professionalBackground: "",
  approvedBio: "",
  publications: [],
  publicationTopicTags: [],
  recurringThemes: [],
  contactableTopics: [],
  restrictedTopics: [],
  doNotContactTopics: [],
  institutionalConflicts: [],
  affiliationConcerns: [],
  status: "active",
  schemaVersion: 2,
  profileRevision: 1,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
});

async function responseJson(response: Response): Promise<Record<string, any>> {
  return response.json() as Promise<Record<string, any>>;
}

test("protected API is fail-closed, feature-gated, idempotent, and validates selection server-side", async () => {
  const previous = {
    admin: process.env.ADMIN_API_KEY,
    actor: process.env.STORY_OPPORTUNITIES_ACTOR_ID,
    reads: process.env.STORY_OPPORTUNITIES_READS_ENABLED,
    writes: process.env.STORY_OPPORTUNITIES_WRITES_ENABLED,
    readOnly: process.env.RGI_READ_ONLY_STARTUP,
  };
  let currentProfessor = testProfessor;
  const repository = new MemoryStoryOpportunityRepository((professorId) =>
    professorId === currentProfessor.id ? currentProfessor : null,
  );
  const service = new StoryOpportunityService({
    repository,
    loadArticles: async () => [testArticle],
    loadProfessorProfiles: async () => [testProfessor],
    now: () => now,
  });
  const app = express();
  app.use(express.json());
  app.use("/api", createStoryOpportunitiesRouter(service));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}/api`;
  const authorized = () => ({
    "x-admin-api-key": "integration-secret",
    "content-type": "application/json",
  });

  try {
    delete process.env.ADMIN_API_KEY;
    process.env.NODE_ENV = "development";
    let response = await fetch(`${base}/opportunity-windows/current`);
    assert.equal(response.status, 401);
    assert.equal(
      (await responseJson(response)).code,
      "AUTHORIZATION_REQUIRED",
    );

    process.env.ADMIN_API_KEY = "integration-secret";
    response = await fetch(`${base}/opportunity-windows/current`, {
      headers: { "x-admin-api-key": "wrong" },
    });
    assert.equal(response.status, 401);

    response = await fetch(`${base}/opportunity-windows/calculate`, {
      method: "POST",
      headers: {
        "x-admin-api-key": "wrong",
        "content-type": "application/json",
      },
      body: JSON.stringify({ asOf: "2026-07-20T15:00:00.000Z" }),
    });
    assert.equal(response.status, 401);

    delete process.env.STORY_OPPORTUNITIES_READS_ENABLED;
    response = await fetch(`${base}/opportunity-windows/current`, {
      headers: authorized(),
    });
    assert.equal(response.status, 403);
    assert.equal(
      (await responseJson(response)).code,
      "STORY_OPPORTUNITIES_READS_DISABLED",
    );

    process.env.STORY_OPPORTUNITIES_READS_ENABLED = "true";
    response = await fetch(`${base}/opportunity-windows/current`, {
      headers: authorized(),
    });
    assert.equal(response.status, 200);
    assert.equal((await responseJson(response)).window, null);

    delete process.env.STORY_OPPORTUNITIES_WRITES_ENABLED;
    response = await fetch(`${base}/opportunity-windows/calculate`, {
      method: "POST",
      headers: authorized(),
      body: JSON.stringify({ asOf: "2026-07-20T15:00:00.000Z" }),
    });
    assert.equal(response.status, 403);
    assert.equal(
      (await responseJson(response)).code,
      "STORY_OPPORTUNITIES_WRITES_DISABLED",
    );

    process.env.STORY_OPPORTUNITIES_WRITES_ENABLED = "true";
    process.env.RGI_READ_ONLY_STARTUP = "true";
    response = await fetch(`${base}/opportunity-windows/calculate`, {
      method: "POST",
      headers: authorized(),
      body: JSON.stringify({ asOf: "2026-07-20T15:00:00.000Z" }),
    });
    assert.equal(response.status, 403);
    assert.equal((await responseJson(response)).code, "READ_ONLY_STARTUP");

    process.env.RGI_READ_ONLY_STARTUP = "false";
    process.env.STORY_OPPORTUNITIES_ACTOR_ID = "integration-editor";
    response = await fetch(`${base}/opportunity-windows/calculate`, {
      method: "POST",
      headers: authorized(),
      body: JSON.stringify({ asOf: "2026-07-20T15:00:00.000Z" }),
    });
    assert.equal(response.status, 201);
    const created = await responseJson(response);
    assert.equal(created.created, true);
    assert.equal(created.opportunities.length, 1);
    const opportunity = created.opportunities[0];

    response = await fetch(
      `${base}/story-opportunities/${opportunity.id}/select-professor`,
      {
        method: "POST",
        headers: authorized(),
        body: JSON.stringify({
          professorId: testProfessor.id,
          expectedRevision: 1,
          reason: "x".repeat(1001),
        }),
      },
    );
    assert.equal(response.status, 400);
    assert.equal((await responseJson(response)).code, "VALIDATION_FAILED");

    response = await fetch(`${base}/opportunity-windows/calculate`, {
      method: "POST",
      headers: authorized(),
      body: JSON.stringify({ asOf: "2026-07-20T15:00:00.000Z" }),
    });
    assert.equal(response.status, 200);
    assert.equal((await responseJson(response)).created, false);

    response = await fetch(
      `${base}/story-opportunities/${opportunity.id}/select-professor`,
      {
        method: "POST",
        headers: authorized(),
        body: JSON.stringify({
          professorId: testProfessor.id,
          expectedRevision: opportunity.revision,
        }),
      },
    );
    assert.equal(response.status, 400);
    assert.equal(
      (await responseJson(response)).code,
      "WEAK_MATCH_REASON_REQUIRED",
    );

    currentProfessor = { ...currentProfessor, profileRevision: 2 };
    response = await fetch(
      `${base}/story-opportunities/${opportunity.id}/select-professor`,
      {
        method: "POST",
        headers: authorized(),
        body: JSON.stringify({
          professorId: testProfessor.id,
          expectedRevision: opportunity.revision,
          reason: "Relevant practitioner experience",
        }),
      },
    );
    assert.equal(response.status, 409);
    const profileConflict = await responseJson(response);
    assert.equal(
      profileConflict.code,
      "PROFESSOR_PROFILE_REVISION_CONFLICT",
    );
    assert.equal(profileConflict.retryable, false);
    assert.match(profileConflict.userMessage, /Recalculate an explicit snapshot revision/);
    const unchangedAfterProfileConflict = await repository.getOpportunity(
      opportunity.id,
    );
    assert.equal(unchangedAfterProfileConflict?.revision, 1);
    assert.equal(unchangedAfterProfileConflict?.selectedProfessor, null);
    assert.deepEqual(unchangedAfterProfileConflict?.selectionHistory, []);

    currentProfessor = {
      ...testProfessor,
      restrictedTopics: ["Leadership & Organizations"],
    };
    response = await fetch(
      `${base}/story-opportunities/${opportunity.id}/select-professor`,
      {
        method: "POST",
        headers: authorized(),
        body: JSON.stringify({
          professorId: testProfessor.id,
          expectedRevision: opportunity.revision,
          reason: "Relevant practitioner experience",
        }),
      },
    );
    assert.equal(response.status, 409);
    assert.equal((await responseJson(response)).code, "PROFESSOR_HARD_EXCLUDED");

    currentProfessor = testProfessor;

    response = await fetch(
      `${base}/story-opportunities/${opportunity.id}/select-professor`,
      {
        method: "POST",
        headers: authorized(),
        body: JSON.stringify({
          professorId: testProfessor.id,
          expectedRevision: opportunity.revision,
          reason: "Relevant practitioner experience",
        }),
      },
    );
    assert.equal(response.status, 200);
    const selected = (await responseJson(response)).opportunity;
    assert.equal(selected.workflowState, "professor_selected");
    assert.equal(selected.selectedProfessor.selectedBy, "integration-editor");
    assert.equal(selected.selectionHistory.length, 1);

    response = await fetch(
      `${base}/story-opportunities/${opportunity.id}/select-professor`,
      {
        method: "POST",
        headers: authorized(),
        body: JSON.stringify({
          professorId: testProfessor.id,
          expectedRevision: opportunity.revision,
          reason: "Relevant practitioner experience",
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal(
      (await responseJson(response)).opportunity.revision,
      selected.revision,
    );

    response = await fetch(
      `${base}/story-opportunities/${opportunity.id}/clear-professor`,
      {
        method: "POST",
        headers: authorized(),
        body: JSON.stringify({ expectedRevision: opportunity.revision }),
      },
    );
    assert.equal(response.status, 409);
    assert.equal(
      (await responseJson(response)).code,
      "OPPORTUNITY_REVISION_CONFLICT",
    );

    response = await fetch(
      `${base}/story-opportunities/${opportunity.id}/update-angle`,
      {
        method: "POST",
        headers: authorized(),
        body: JSON.stringify({
          expectedRevision: selected.revision,
          angle: "  A revised   editor-controlled angle.  ",
        }),
      },
    );
    assert.equal(response.status, 200);
    const angleUpdated = (await responseJson(response)).opportunity;
    assert.equal(
      angleUpdated.recommendedAngle,
      "A revised editor-controlled angle.",
    );

    response = await fetch(
      `${base}/story-opportunities/${opportunity.id}/close`,
      {
        method: "POST",
        headers: authorized(),
        body: JSON.stringify({ expectedRevision: angleUpdated.revision }),
      },
    );
    assert.equal(response.status, 200);
    const closed = (await responseJson(response)).opportunity;
    assert.equal(closed.workflowState, "closed");

    response = await fetch(
      `${base}/story-opportunities/${opportunity.id}/clear-professor`,
      {
        method: "POST",
        headers: authorized(),
        body: JSON.stringify({ expectedRevision: closed.revision }),
      },
    );
    assert.equal(response.status, 409);
    assert.equal((await responseJson(response)).code, "OPPORTUNITY_CLOSED");

    response = await fetch(
      `${base}/story-opportunities/${opportunity.id}/reopen`,
      {
        method: "POST",
        headers: authorized(),
        body: JSON.stringify({ expectedRevision: closed.revision }),
      },
    );
    assert.equal(response.status, 200);
    const reopened = (await responseJson(response)).opportunity;
    assert.equal(reopened.workflowState, "professor_selected");

    response = await fetch(
      `${base}/story-opportunities/${opportunity.id}/clear-professor`,
      {
        method: "POST",
        headers: authorized(),
        body: JSON.stringify({
          expectedRevision: reopened.revision,
          reason: "Editorial direction changed",
        }),
      },
    );
    assert.equal(response.status, 200);
    const cleared = (await responseJson(response)).opportunity;
    assert.equal(cleared.workflowState, "shortlisted");
    assert.equal(cleared.selectedProfessor, null);
    assert.equal(cleared.selectionHistory.at(-1)?.action, "cleared");
    assert.equal(
      cleared.selectionHistory.at(-1)?.reason,
      "Editorial direction changed",
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const restore = (key: string, value: string | undefined) =>
      value === undefined
        ? delete process.env[key]
        : void (process.env[key] = value);
    restore("ADMIN_API_KEY", previous.admin);
    restore("STORY_OPPORTUNITIES_ACTOR_ID", previous.actor);
    restore("STORY_OPPORTUNITIES_READS_ENABLED", previous.reads);
    restore("STORY_OPPORTUNITIES_WRITES_ENABLED", previous.writes);
    restore("RGI_READ_ONLY_STARTUP", previous.readOnly);
  }
});
