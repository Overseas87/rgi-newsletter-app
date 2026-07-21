import { expect, request as requestFactory, test } from "@playwright/test";

const EDITOR_EMAIL = "editor@rgi-e2e.test";
const EDITOR_PASSWORD = "local-emulator-editor-password";
const OUTSIDER_EMAIL = "outsider@rgi-e2e.test";
const OUTSIDER_PASSWORD = "local-emulator-outsider-password";
const API_URL = "http://127.0.0.1:3013";
const DISABLED_API_URL = "http://127.0.0.1:3014";
const READ_ONLY_API_URL = "http://127.0.0.1:3015";

type OpportunityPayload = {
  opportunity: {
    id: string;
    revision: number;
    selectedProfessor: { professorId: string } | null;
    selectionHistory: unknown[];
  };
};

async function emulatorIdToken(
  email: string,
  password: string,
): Promise<string> {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim() ?? "";
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim() ?? "";
  if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host)) {
    throw new Error("FIREBASE_AUTH_EMULATOR_HOST must be loopback.");
  }
  if (!projectId.startsWith("demo-")) {
    throw new Error("FIREBASE_PROJECT_ID must identify a demo project.");
  }
  const response = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const payload = (await response.json()) as {
    idToken?: unknown;
    error?: { message?: unknown };
  };
  if (!response.ok || typeof payload.idToken !== "string") {
    throw new Error(
      `Auth emulator sign-in failed: ${String(payload.error?.message ?? response.status)}.`,
    );
  }
  return payload.idToken;
}

function tokenWithExpiredPayload(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 3)
    throw new Error("Auth emulator returned a malformed ID token.");
  const payload = JSON.parse(
    Buffer.from(parts[1], "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  payload.exp = Math.floor(Date.now() / 1000) - 3600;
  return `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${parts[2]}`;
}

async function updateEmulatorProfessorRevision(
  professorId: string,
  profileRevision: number,
): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST?.trim() ?? "";
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim() ?? "";
  if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host)) {
    throw new Error("FIRESTORE_EMULATOR_HOST must be loopback.");
  }
  if (!projectId.startsWith("demo-")) {
    throw new Error("FIREBASE_PROJECT_ID must identify a demo project.");
  }
  const response = await fetch(
    `http://${host}/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/professor_profiles/${encodeURIComponent(professorId)}?updateMask.fieldPaths=profileRevision`,
    {
      method: "PATCH",
      headers: {
        authorization: "Bearer owner",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fields: { profileRevision: { integerValue: String(profileRevision) } },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Firestore emulator profile update failed: ${response.status} ${response.statusText}.`,
    );
  }
}

test("an allowlisted editor completes the real Firestore-backed selection workflow", async ({
  page,
}) => {
  const unauthenticated = await requestFactory.newContext({ baseURL: API_URL });
  const unauthenticatedResponse = await unauthenticated.get(
    "/api/opportunity-windows/config",
  );
  expect(unauthenticatedResponse.status()).toBe(401);
  expect(await unauthenticatedResponse.json()).toMatchObject({
    code: "AUTHORIZATION_REQUIRED",
  });
  await unauthenticated.dispose();

  const malformed = await requestFactory.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { authorization: "Bearer malformed-token" },
  });
  const malformedResponse = await malformed.get(
    "/api/opportunity-windows/config",
  );
  expect(malformedResponse.status()).toBe(401);
  expect(await malformedResponse.json()).toMatchObject({
    code: "INVALID_ID_TOKEN",
  });
  await malformed.dispose();

  const outsiderToken = await emulatorIdToken(
    OUTSIDER_EMAIL,
    OUTSIDER_PASSWORD,
  );
  const outsider = await requestFactory.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { authorization: `Bearer ${outsiderToken}` },
  });
  const outsiderResponse = await outsider.get(
    "/api/opportunity-windows/config",
  );
  expect(outsiderResponse.status()).toBe(403);
  expect(await outsiderResponse.json()).toMatchObject({
    code: "INTERNAL_EDITOR_ACCESS_DENIED",
  });
  await outsider.dispose();

  const editorToken = await emulatorIdToken(EDITOR_EMAIL, EDITOR_PASSWORD);
  const expired = await requestFactory.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: {
      authorization: `Bearer ${tokenWithExpiredPayload(editorToken)}`,
    },
  });
  const expiredResponse = await expired.get("/api/opportunity-windows/config");
  expect(expiredResponse.status()).toBe(401);
  expect(await expiredResponse.json()).toMatchObject({
    code: "INVALID_ID_TOKEN",
  });
  await expired.dispose();

  const editorApi = await requestFactory.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { authorization: `Bearer ${editorToken}` },
  });

  const disabledApi = await requestFactory.newContext({
    baseURL: DISABLED_API_URL,
    extraHTTPHeaders: { authorization: `Bearer ${editorToken}` },
  });
  const readsDisabled = await disabledApi.get(
    "/api/opportunity-windows/current",
  );
  expect(readsDisabled.status()).toBe(403);
  expect(await readsDisabled.json()).toMatchObject({
    code: "STORY_OPPORTUNITIES_READS_DISABLED",
  });
  const writesDisabled = await disabledApi.post(
    "/api/opportunity-windows/calculate",
    { data: { asOf: "2026-07-20T15:00:00.000Z" } },
  );
  expect(writesDisabled.status()).toBe(403);
  expect(await writesDisabled.json()).toMatchObject({
    code: "STORY_OPPORTUNITIES_WRITES_DISABLED",
  });
  await disabledApi.dispose();

  const readOnlyApi = await requestFactory.newContext({
    baseURL: READ_ONLY_API_URL,
    extraHTTPHeaders: { authorization: `Bearer ${editorToken}` },
  });
  const readOnlyWrite = await readOnlyApi.post(
    "/api/opportunity-windows/calculate",
    { data: { asOf: "2026-07-20T15:00:00.000Z" } },
  );
  expect(readOnlyWrite.status()).toBe(403);
  expect(await readOnlyWrite.json()).toMatchObject({
    code: "READ_ONLY_STARTUP",
  });
  await readOnlyApi.dispose();

  await page.goto("/opportunities");
  await page.getByTestId("editor-auth-email").fill(EDITOR_EMAIL);
  await page.getByTestId("editor-auth-password").fill(EDITOR_PASSWORD);
  await page.getByTestId("editor-auth-sign-in").click();
  await expect(page.getByTestId("editor-auth-signed-in")).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Daily Story Opportunities" }),
  ).toBeVisible();
  await expect(
    page.getByText("No calculated opportunity window"),
  ).toBeVisible();

  await page
    .getByLabel("Calculate selected as-of time")
    .fill("2026-07-20T11:00");
  await page.getByTestId("calculate-opportunity-window").click();

  await expect(page.getByTestId("frozen-window-summary")).toContainText(
    "3 qualifying stories",
  );
  await expect(
    page.getByText("Leadership systems face a new test", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Below-threshold fixture remains outside the shortlist", {
      exact: true,
    }),
  ).toHaveCount(0);

  await page
    .getByRole("link", { name: /Open opportunity/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Professor Matches" }),
  ).toBeVisible();
  await expect(page.getByText("RGI relevance", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Professor fit", { exact: true }).first(),
  ).toBeVisible();
  const strongMatch = page.getByTestId("professor-match-prof_e2e_leadership");
  await expect(strongMatch).toContainText("Strong match");
  await expect(strongMatch).toContainText("Profile coverage");
  await expect(strongMatch).toContainText("Core expertise");
  await expect(strongMatch).toContainText(
    "matched “Leadership & Organizations”",
  );
  const weakMatch = page.getByTestId("professor-match-prof_e2e_education");
  await expect(weakMatch).toContainText("Weak match");
  await expect(weakMatch).toContainText("Missing profile dimensions");
  const excludedMatch = page.getByTestId("professor-match-prof_e2e_restricted");
  await expect(excludedMatch).toContainText("Hard exclusion");
  await expect(
    page.getByTestId("select-professor-prof_e2e_restricted"),
  ).toBeDisabled();
  await expect(page.getByText("No professor has been selected")).toBeVisible();

  const opportunityId = new URL(page.url()).pathname.split("/").at(-1)!;
  let detailResponse = await editorApi.get(
    `/api/story-opportunities/${opportunityId}`,
  );
  expect(detailResponse.status()).toBe(200);
  let persisted = (await detailResponse.json()) as OpportunityPayload;
  const excludedResponse = await editorApi.post(
    `/api/story-opportunities/${opportunityId}/select-professor`,
    {
      data: {
        professorId: "prof_e2e_restricted",
        expectedRevision: persisted.opportunity.revision,
      },
    },
  );
  expect(excludedResponse.status()).toBe(409);
  expect(await excludedResponse.json()).toMatchObject({
    code: "PROFESSOR_HARD_EXCLUDED",
  });
  detailResponse = await editorApi.get(
    `/api/story-opportunities/${opportunityId}`,
  );
  persisted = (await detailResponse.json()) as OpportunityPayload;
  expect(persisted.opportunity.revision).toBe(1);
  expect(persisted.opportunity.selectedProfessor).toBeNull();
  expect(persisted.opportunity.selectionHistory).toHaveLength(0);

  await page.getByTestId("select-professor-prof_e2e_leadership").click();
  await expect(
    page.getByTestId("professor-selection-confirmation"),
  ).toContainText("No override reason is required");
  await page.getByTestId("confirm-professor-selection").click();

  await expect(
    page.getByText("Selected: Professor Leadership Fixture", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Actor: firebase:rgi-e2e-editor/)).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("editor-auth-signed-in")).toBeVisible();
  await expect(
    page.getByText("Selected: Professor Leadership Fixture", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Actor: firebase:rgi-e2e-editor/)).toBeVisible();

  await page.getByRole("button", { name: "Clear professor selection" }).click();
  await expect(page.getByTestId("opportunity-workflow-state")).toHaveText(
    "shortlisted",
  );
  await expect(
    page.getByRole("button", { name: "Clear professor selection" }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/selected: Professor Leadership Fixture/i),
  ).toBeVisible();
  await expect(page.getByText(/cleared: selection cleared/i)).toBeVisible();
  await expect(page.getByText(/Actor: firebase:rgi-e2e-editor/)).toHaveCount(2);

  detailResponse = await editorApi.get(
    `/api/story-opportunities/${opportunityId}`,
  );
  persisted = (await detailResponse.json()) as OpportunityPayload;
  const weakWithoutReason = await editorApi.post(
    `/api/story-opportunities/${opportunityId}/select-professor`,
    {
      data: {
        professorId: "prof_e2e_education",
        expectedRevision: persisted.opportunity.revision,
      },
    },
  );
  expect(weakWithoutReason.status()).toBe(400);
  expect(await weakWithoutReason.json()).toMatchObject({
    code: "WEAK_MATCH_REASON_REQUIRED",
  });
  detailResponse = await editorApi.get(
    `/api/story-opportunities/${opportunityId}`,
  );
  const afterRejectedWeak = (await detailResponse.json()) as OpportunityPayload;
  expect(afterRejectedWeak.opportunity.revision).toBe(
    persisted.opportunity.revision,
  );
  expect(afterRejectedWeak.opportunity.selectedProfessor).toBeNull();
  expect(afterRejectedWeak.opportunity.selectionHistory).toHaveLength(2);

  await page.getByTestId("select-professor-prof_e2e_education").click();
  await expect(
    page.getByTestId("professor-selection-confirmation"),
  ).toContainText("requires an override reason");
  await expect(page.getByTestId("confirm-professor-selection")).toBeDisabled();
  await page
    .getByTestId("selection-override-reason")
    .fill("The editor has a specific education perspective to explore.");
  await page.getByTestId("confirm-professor-selection").click();
  await expect(
    page.getByText("Selected: Professor Education Fixture", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Reason: The editor has a specific education perspective to explore.",
      { exact: true },
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Clear professor selection" }).click();
  await expect(page.getByTestId("opportunity-workflow-state")).toHaveText(
    "shortlisted",
  );
  detailResponse = await editorApi.get(
    `/api/story-opportunities/${opportunityId}`,
  );
  const beforeRevisionConflict =
    (await detailResponse.json()) as OpportunityPayload;
  expect(beforeRevisionConflict.opportunity.selectionHistory).toHaveLength(4);

  await updateEmulatorProfessorRevision("prof_e2e_education", 2);
  await page.getByTestId("select-professor-prof_e2e_education").click();
  await page
    .getByTestId("selection-override-reason")
    .fill("This stale selection must be rejected without mutation.");
  await page.getByTestId("confirm-professor-selection").click();
  await expect(
    page.getByText("Professor Profile changed", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("opportunity-workflow-state")).toHaveText(
    "shortlisted",
  );

  detailResponse = await editorApi.get(
    `/api/story-opportunities/${opportunityId}`,
  );
  const afterRevisionConflict =
    (await detailResponse.json()) as OpportunityPayload;
  expect(afterRevisionConflict.opportunity.revision).toBe(
    beforeRevisionConflict.opportunity.revision,
  );
  expect(afterRevisionConflict.opportunity.selectedProfessor).toBeNull();
  expect(afterRevisionConflict.opportunity.selectionHistory).toHaveLength(4);

  await editorApi.dispose();
});
