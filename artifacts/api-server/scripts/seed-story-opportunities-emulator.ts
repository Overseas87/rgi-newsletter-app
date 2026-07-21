import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const EDITOR_UID = "rgi-e2e-editor";
const OUTSIDER_UID = "rgi-e2e-outsider";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assertLoopbackEmulatorHost(name: string, value: string): void {
  if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(value)) {
    throw new Error(
      `${name} must point to a loopback emulator host, received ${value}.`,
    );
  }
}

function projectIdFromEnvironment(): string {
  const values = [
    process.env.FIREBASE_PROJECT_ID,
    process.env.GCLOUD_PROJECT,
    process.env.GOOGLE_CLOUD_PROJECT,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const projectId = values[0];
  if (!projectId) throw new Error("A Firebase demo project ID is required.");
  if (!projectId.startsWith("demo-")) {
    throw new Error(`Refusing to seed non-demo Firebase project ${projectId}.`);
  }
  if (values.some((value) => value !== projectId)) {
    throw new Error(
      `Firebase project environment variables disagree: ${values.join(", ")}.`,
    );
  }
  return projectId;
}

async function clearEmulatorData(
  projectId: string,
  firestoreHost: string,
  authHost: string,
): Promise<void> {
  const responses = await Promise.all([
    fetch(
      `http://${firestoreHost}/emulator/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`,
      { method: "DELETE" },
    ),
    fetch(
      `http://${authHost}/emulator/v1/projects/${encodeURIComponent(projectId)}/accounts`,
      { method: "DELETE" },
    ),
  ]);
  for (const response of responses) {
    if (!response.ok) {
      throw new Error(
        `Failed to clear emulator fixture state: ${response.status} ${response.statusText}.`,
      );
    }
  }
}

function article(input: {
  id: number;
  headline: string;
  url: string;
  sourceName: string;
  publishedAt: string;
  relevancyScore: number;
  topicTags: string[];
  disciplineAlignment: string;
}) {
  const publishedAt = Timestamp.fromDate(new Date(input.publishedAt));
  return {
    id: input.id,
    headline: input.headline,
    url: input.url,
    sourceName: input.sourceName,
    sourceUrl: new URL(input.url).origin,
    author: "RGI Emulator Fixture",
    authorType: "Journalist",
    platform: "news",
    isEmergingSignal: false,
    isPrimarySignal: true,
    relevancyScore: input.relevancyScore,
    authenticityScore: 8,
    viewpoint: null,
    topicTags: input.topicTags,
    teaserSummary: "Deterministic Story Opportunity emulator fixture.",
    publishedAt,
    scrapedAt: Timestamp.fromMillis(publishedAt.toMillis() + 5 * 60_000),
    content:
      "A deterministic fixture used only by the local Firebase Emulator Suite.",
    status: "pending",
    disciplineAlignment: input.disciplineAlignment,
    scoreExplanation:
      "The stored RGI relevance score qualifies this fixture for the frozen shortlist.",
    scoreBreakdown: { sourceAuthority: 8 },
    sourceAuthorityScore: 8,
    reasonForAcceptance: "Deterministic emulator acceptance fixture.",
    rgiProfileVersion: "rgi-v1",
  };
}

function professorProfile(input: {
  id: string;
  fullName: string;
  topic: string;
  region: string;
  status?: "active" | "inactive";
  restrictedTopics?: string[];
}) {
  const timestamp = Timestamp.fromDate(new Date("2026-07-19T12:00:00.000Z"));
  return {
    id: input.id,
    fullName: input.fullName,
    academicTitle: "Professor",
    department: "Management",
    coursesTaught: [input.topic],
    expertiseTags: [input.topic],
    researchInterests: [input.topic],
    professionalExperienceTags: [input.topic],
    academicExperienceTags: [input.topic],
    industries: [input.topic],
    topicInterests: [input.topic],
    regions: [input.region],
    affiliations: ["RGI Emulator Faculty"],
    professionalBackground: "Approved deterministic emulator fixture.",
    approvedBio: "Approved deterministic emulator fixture.",
    publications: [`Approved writing on ${input.topic}`],
    publicationTopicTags: [input.topic],
    recurringThemes: [input.topic],
    contactableTopics: [input.topic],
    restrictedTopics: input.restrictedTopics ?? [],
    doNotContactTopics: [],
    institutionalConflicts: [],
    affiliationConcerns: [],
    status: input.status ?? "active",
    schemaVersion: 2,
    profileRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function main(): Promise<void> {
  const firestoreHost = requiredEnvironment("FIRESTORE_EMULATOR_HOST");
  const authHost = requiredEnvironment("FIREBASE_AUTH_EMULATOR_HOST");
  assertLoopbackEmulatorHost("FIRESTORE_EMULATOR_HOST", firestoreHost);
  assertLoopbackEmulatorHost("FIREBASE_AUTH_EMULATOR_HOST", authHost);
  const projectId = projectIdFromEnvironment();

  await clearEmulatorData(projectId, firestoreHost, authHost);

  const app = initializeApp({ projectId }, "story-opportunities-e2e-seed");
  try {
    const auth = getAuth(app);
    await Promise.all([
      auth.createUser({
        uid: EDITOR_UID,
        email: "editor@rgi-e2e.test",
        password: "local-emulator-editor-password",
        emailVerified: true,
      }),
      auth.createUser({
        uid: OUTSIDER_UID,
        email: "outsider@rgi-e2e.test",
        password: "local-emulator-outsider-password",
        emailVerified: true,
      }),
    ]);

    const db = getFirestore(app);
    const batch = db.batch();
    const articles = [
      article({
        id: 9101,
        headline: "Leadership systems face a new test",
        url: "https://example.test/leadership-systems",
        sourceName: "RGI Fixture News",
        publishedAt: "2026-07-20T09:00:00.000Z",
        relevancyScore: 8.4,
        topicTags: ["Leadership & Organizations", "North America"],
        disciplineAlignment: "System Vitality",
      }),
      article({
        id: 9102,
        headline: "Universities rethink executive education",
        url: "https://example.test/executive-education",
        sourceName: "RGI Fixture Campus",
        publishedAt: "2026-07-20T08:15:00.000Z",
        relevancyScore: 7.7,
        topicTags: ["Education", "Europe"],
        disciplineAlignment: "Civic Stewardship",
      }),
      article({
        id: 9103,
        headline: "Economic uncertainty changes leadership decisions",
        url: "https://example.test/economic-leadership",
        sourceName: "RGI Fixture Economics",
        publishedAt: "2026-07-20T07:30:00.000Z",
        relevancyScore: 6.8,
        topicTags: ["Economics & Macroeconomics", "Leadership & Organizations"],
        disciplineAlignment: "Strategic Foresight",
      }),
      article({
        id: 9104,
        headline: "Below-threshold fixture remains outside the shortlist",
        url: "https://example.test/below-threshold",
        sourceName: "RGI Fixture News",
        publishedAt: "2026-07-20T06:45:00.000Z",
        relevancyScore: 5.9,
        topicTags: ["Technology & AI"],
        disciplineAlignment: "System Vitality",
      }),
    ];
    for (const item of articles) {
      batch.set(db.collection("articles").doc(String(item.id)), item);
    }

    const profiles = [
      professorProfile({
        id: "prof_e2e_leadership",
        fullName: "Professor Leadership Fixture",
        topic: "Leadership & Organizations",
        region: "North America",
      }),
      professorProfile({
        id: "prof_e2e_education",
        fullName: "Professor Education Fixture",
        topic: "Education",
        region: "Europe",
      }),
      professorProfile({
        id: "prof_e2e_restricted",
        fullName: "Professor Restricted Fixture",
        topic: "Leadership & Organizations",
        region: "North America",
        restrictedTopics: ["Leadership & Organizations"],
      }),
    ];
    for (const profile of profiles) {
      batch.set(db.collection("professor_profiles").doc(profile.id), profile);
    }
    await batch.commit();

    process.stdout.write(
      `Seeded ${articles.length} articles, ${profiles.length} professor profiles, and 2 Auth users in ${projectId}.\n`,
    );
  } finally {
    await deleteApp(app);
  }
}

await main();
