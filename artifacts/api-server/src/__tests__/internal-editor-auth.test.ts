import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  createAdminMutationGuard,
  createRequireInternalEditor,
  verifyFirebaseEditorTokenWithAuth,
} from "../lib/internal-editor-auth";

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

test("internal editor authentication accepts approved Firebase users and fails closed", async () => {
  const previous = {
    admin: process.env.ADMIN_API_KEY,
    actor: process.env.STORY_OPPORTUNITIES_ACTOR_ID,
    editors: process.env.RGI_EDITOR_UIDS,
    nodeEnv: process.env.NODE_ENV,
  };
  const app = express();
  const seenTokens: string[] = [];
  app.use(
    createRequireInternalEditor({
      verifyEditorToken: async (token) => {
        seenTokens.push(token);
        if (token === "approved-token") return { uid: "approved-editor" };
        if (token === "unapproved-token") return { uid: "unapproved-user" };
        throw new Error("expired or malformed token");
      },
    }),
  );
  app.get("/protected", (_req, res) => {
    res.json({
      actor: res.locals.internalEditorActorId,
      method: res.locals.internalEditorAuthMethod,
    });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/protected`;

  try {
    process.env.NODE_ENV = "development";
    delete process.env.ADMIN_API_KEY;
    delete process.env.RGI_EDITOR_UIDS;

    let response = await fetch(url);
    assert.equal(response.status, 401);
    assert.equal((await json(response)).code, "AUTHORIZATION_REQUIRED");

    response = await fetch(`${url}?token=approved-token`);
    assert.equal(response.status, 401);
    assert.equal((await json(response)).code, "AUTHORIZATION_REQUIRED");

    response = await fetch(url, { headers: { authorization: "Basic nope" } });
    assert.equal(response.status, 401);
    assert.equal((await json(response)).code, "INVALID_ID_TOKEN");

    response = await fetch(url, { headers: { authorization: "Bearer token" } });
    assert.equal(response.status, 503);
    assert.equal(
      (await json(response)).code,
      "INTERNAL_EDITOR_AUTH_UNCONFIGURED",
    );
    assert.deepEqual(seenTokens, []);

    process.env.RGI_EDITOR_UIDS = "approved-editor, second-editor";
    response = await fetch(url, {
      headers: { authorization: "Bearer expired-token" },
    });
    assert.equal(response.status, 401);
    assert.equal((await json(response)).code, "INVALID_ID_TOKEN");

    response = await fetch(url, {
      headers: { authorization: "Bearer unapproved-token" },
    });
    assert.equal(response.status, 403);
    assert.equal((await json(response)).code, "INTERNAL_EDITOR_ACCESS_DENIED");

    response = await fetch(url, {
      headers: { authorization: "Bearer approved-token" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), {
      actor: "firebase:approved-editor",
      method: "firebase-id-token",
    });

    process.env.ADMIN_API_KEY = "server-only-key";
    process.env.STORY_OPPORTUNITIES_ACTOR_ID = "trusted-operator";
    response = await fetch(url, { headers: { "x-admin-api-key": "wrong" } });
    assert.equal(response.status, 401);
    assert.equal((await json(response)).code, "UNAUTHORIZED");

    response = await fetch(url, {
      headers: { "x-admin-api-key": "server-only-key" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), {
      actor: "trusted-operator",
      method: "admin-api-key",
    });

    response = await fetch(url, {
      headers: { authorization: "Bearer server-only-key" },
    });
    assert.equal(response.status, 401);
    assert.equal((await json(response)).code, "INVALID_ID_TOKEN");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const restore = (key: string, value: string | undefined) =>
      value === undefined
        ? delete process.env[key]
        : void (process.env[key] = value);
    restore("ADMIN_API_KEY", previous.admin);
    restore("STORY_OPPORTUNITIES_ACTOR_ID", previous.actor);
    restore("RGI_EDITOR_UIDS", previous.editors);
    restore("NODE_ENV", previous.nodeEnv);
  }
});

test("Firebase token verification checks revocation", async () => {
  const calls: Array<{ token: string; checkRevoked: boolean | undefined }> = [];
  const auth = {
    async verifyIdToken(token: string, checkRevoked?: boolean) {
      calls.push({ token, checkRevoked });
      if (token === "revoked-token") throw new Error("auth/id-token-revoked");
      return { uid: "approved-editor" };
    },
  };

  assert.deepEqual(
    await verifyFirebaseEditorTokenWithAuth(auth, "valid-token"),
    { uid: "approved-editor" },
  );
  await assert.rejects(
    verifyFirebaseEditorTokenWithAuth(auth, "revoked-token"),
    /auth\/id-token-revoked/,
  );
  assert.deepEqual(calls, [
    { token: "valid-token", checkRevoked: true },
    { token: "revoked-token", checkRevoked: true },
  ]);
});

test("legacy mutations use fail-closed editor authentication in development", async () => {
  const previous = {
    admin: process.env.ADMIN_API_KEY,
    editors: process.env.RGI_EDITOR_UIDS,
    nodeEnv: process.env.NODE_ENV,
  };
  const app = express();
  const editorGuard = createRequireInternalEditor({
    approvedEditorUids: () => new Set(["approved-editor"]),
    verifyEditorToken: async (token) => {
      if (token === "valid-firebase-token") return { uid: "approved-editor" };
      throw new Error("invalid token");
    },
  });
  app.use(createAdminMutationGuard(editorGuard));
  app.post("/api/legacy-auth-probe", (_req, res) => res.sendStatus(204));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/api/legacy-auth-probe`;

  try {
    process.env.NODE_ENV = "development";
    delete process.env.ADMIN_API_KEY;
    process.env.RGI_EDITOR_UIDS = "approved-editor";

    let response = await fetch(url, { method: "POST" });
    assert.equal(response.status, 401);
    assert.equal((await json(response)).code, "AUTHORIZATION_REQUIRED");
    assert.equal(response.headers.get("x-rgi-admin-guard"), null);

    process.env.ADMIN_API_KEY = "server-only-key";
    response = await fetch(url, {
      method: "POST",
      headers: { "x-admin-api-key": "server-only-key" },
    });
    assert.equal(response.status, 204);

    response = await fetch(url, {
      method: "POST",
      headers: { "x-admin-api-key": "wrong-key" },
    });
    assert.equal(response.status, 401);
    assert.equal((await json(response)).code, "UNAUTHORIZED");

    response = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer server-only-key" },
    });
    assert.equal(response.status, 401);
    assert.equal((await json(response)).code, "INVALID_ID_TOKEN");

    response = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer valid-firebase-token" },
    });
    assert.equal(response.status, 204);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const restore = (key: string, value: string | undefined) =>
      value === undefined
        ? delete process.env[key]
        : void (process.env[key] = value);
    restore("ADMIN_API_KEY", previous.admin);
    restore("RGI_EDITOR_UIDS", previous.editors);
    restore("NODE_ENV", previous.nodeEnv);
  }
});
