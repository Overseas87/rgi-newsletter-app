import type { Article } from "@workspace/db";
import type { ProfessorProfile } from "@workspace/api-zod";
import {
  EXPECTED_FIREBASE_PROJECT_ID,
  FIREBASE_PROJECT_ID,
  getFirebaseBundle,
  isFirestoreTemporarilyDegraded,
  withFirestoreRetry,
} from "./firebase";
import {
  PROFESSOR_PROFILES_COLLECTION,
  professorProfileFromDoc,
} from "./professor-profiles";
import type {
  StoryOpportunity,
  StoryOpportunityWindow,
} from "./story-opportunities";

export const STORY_OPPORTUNITY_WINDOWS_COLLECTION = "story_opportunity_windows";
export const STORY_OPPORTUNITIES_COLLECTION = "story_opportunities";

export type FrozenSnapshotResult = {
  created: boolean;
  window: StoryOpportunityWindow;
  opportunities: StoryOpportunity[];
};

export interface StoryOpportunityRepository {
  createFrozenSnapshot(
    window: StoryOpportunityWindow,
    opportunities: StoryOpportunity[],
  ): Promise<FrozenSnapshotResult>;
  listWindows(): Promise<StoryOpportunityWindow[]>;
  getWindow(id: string): Promise<StoryOpportunityWindow | null>;
  getLatestWindow(): Promise<StoryOpportunityWindow | null>;
  listOpportunities(windowId: string): Promise<StoryOpportunity[]>;
  getOpportunity(id: string): Promise<StoryOpportunity | null>;
  mutateOpportunity(
    id: string,
    mutate: (opportunity: StoryOpportunity) => StoryOpportunity,
  ): Promise<StoryOpportunity | null>;
  mutateOpportunityWithProfessor(
    id: string,
    professorId: string,
    mutate: (
      opportunity: StoryOpportunity,
      professorProfile: ProfessorProfile | null,
    ) => StoryOpportunity,
  ): Promise<StoryOpportunity | null>;
}

type ProfessorProfileLoader = (
  professorId: string,
) => ProfessorProfile | null | Promise<ProfessorProfile | null>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stableTextCompare(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function windowFromDoc(doc: any): StoryOpportunityWindow {
  return clone((doc.data?.() ?? doc) as StoryOpportunityWindow);
}

function opportunityFromDoc(doc: any): StoryOpportunity {
  return clone((doc.data?.() ?? doc) as StoryOpportunity);
}

function dateFromFirestore(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

function articleCandidateFromDoc(doc: any): Article | null {
  const data = doc.data?.() ?? doc;
  const id = Number(data.id ?? doc.id);
  const score = Number(data.relevancyScore);
  if (!Number.isInteger(id) || !Number.isFinite(score)) return null;
  return {
    id,
    headline: String(data.headline ?? ""),
    url: String(data.url ?? ""),
    sourceName: String(data.sourceName ?? ""),
    sourceUrl: typeof data.sourceUrl === "string" ? data.sourceUrl : null,
    author: typeof data.author === "string" ? data.author : null,
    authorType: typeof data.authorType === "string" ? data.authorType : null,
    platform:
      data.platform === "twitter" || data.platform === "linkedin"
        ? data.platform
        : "news",
    isEmergingSignal: Boolean(data.isEmergingSignal),
    isPrimarySignal: Boolean(data.isPrimarySignal),
    relevancyScore: score,
    authenticityScore: Number.isFinite(Number(data.authenticityScore))
      ? Number(data.authenticityScore)
      : 5,
    viewpoint: typeof data.viewpoint === "string" ? data.viewpoint : null,
    topicTags: Array.isArray(data.topicTags)
      ? data.topicTags.filter(
          (value: unknown): value is string => typeof value === "string",
        )
      : [],
    teaserSummary:
      typeof data.teaserSummary === "string" ? data.teaserSummary : null,
    publishedAt: dateFromFirestore(data.publishedAt),
    scrapedAt: dateFromFirestore(data.scrapedAt) ?? new Date(Number.NaN),
    content: typeof data.content === "string" ? data.content : null,
    status:
      data.status === "selected" || data.status === "dismissed"
        ? data.status
        : "pending",
    disciplineAlignment:
      typeof data.disciplineAlignment === "string"
        ? data.disciplineAlignment
        : null,
    scoreExplanation:
      typeof data.scoreExplanation === "string" ? data.scoreExplanation : null,
    scoreBreakdown:
      data.scoreBreakdown && typeof data.scoreBreakdown === "object"
        ? data.scoreBreakdown
        : null,
    sourceAuthorityScore:
      data.sourceAuthorityScore == null
        ? null
        : Number(data.sourceAuthorityScore),
    reasonForAcceptance:
      typeof data.reasonForAcceptance === "string"
        ? data.reasonForAcceptance
        : null,
    rgiProfileVersion:
      typeof data.rgiProfileVersion === "string"
        ? data.rgiProfileVersion
        : null,
  } as Article;
}

function assertCanonicalOpportunityWriteTarget(): void {
  if (process.env.FIRESTORE_EMULATOR_HOST) return;
  if (FIREBASE_PROJECT_ID !== EXPECTED_FIREBASE_PROJECT_ID) {
    throw new Error(
      `Story Opportunity writes require Firebase project ${EXPECTED_FIREBASE_PROJECT_ID}.`,
    );
  }
}

/**
 * Reads candidates directly from Firestore so a frozen production window can
 * never be materialized from the legacy local/stale fallback cache.
 */
export async function listOpportunityCandidateArticles(
  windowStart: Date,
  windowEnd: Date,
): Promise<Article[]> {
  if (isFirestoreTemporarilyDegraded())
    throw new Error("Firestore is temporarily degraded");
  const { db } = await getFirebaseBundle();
  return withFirestoreRetry("Read Story Opportunity candidates", () =>
    listOpportunityCandidateArticlesFromDb(db, windowStart, windowEnd),
  );
}

export async function listOpportunityCandidateArticlesFromDb(
  db: any,
  windowStart: Date,
  windowEnd: Date,
): Promise<Article[]> {
  const [published, scraped]: any[] = await Promise.all([
    db
      .collection("articles")
      .where("publishedAt", ">=", windowStart)
      .where("publishedAt", "<", windowEnd)
      .get(),
    db
      .collection("articles")
      .where("scrapedAt", ">=", windowStart)
      .where("scrapedAt", "<", windowEnd)
      .get(),
  ]);
  const candidates = new Map<number, Article>();
  for (const doc of published.docs) {
    const article = articleCandidateFromDoc(doc);
    if (article) candidates.set(article.id, article);
  }
  for (const doc of scraped.docs) {
    const article = articleCandidateFromDoc(doc);
    if (
      article &&
      !dateFromFirestore(article.publishedAt) &&
      !candidates.has(article.id)
    )
      candidates.set(article.id, article);
  }
  return [...candidates.values()];
}

export class FirestoreStoryOpportunityRepository implements StoryOpportunityRepository {
  async createFrozenSnapshot(
    window: StoryOpportunityWindow,
    opportunities: StoryOpportunity[],
  ): Promise<FrozenSnapshotResult> {
    if (isFirestoreTemporarilyDegraded())
      throw new Error("Firestore is temporarily degraded");
    assertCanonicalOpportunityWriteTarget();
    const { db } = await getFirebaseBundle();
    const windowRef = db
      .collection(STORY_OPPORTUNITY_WINDOWS_COLLECTION)
      .doc(window.id);
    const created = await withFirestoreRetry(
      "Create frozen story opportunity snapshot",
      () =>
        db.runTransaction(async (transaction: any) => {
          const existing = await transaction.get(windowRef);
          if (existing.exists) return false;
          transaction.create(windowRef, window);
          for (const opportunity of opportunities) {
            transaction.create(
              db.collection(STORY_OPPORTUNITIES_COLLECTION).doc(opportunity.id),
              opportunity,
            );
          }
          return true;
        }),
    );
    if (!created) {
      const existingWindow = await this.getWindow(window.id);
      if (!existingWindow)
        throw new Error(
          "Frozen opportunity window disappeared during idempotent read",
        );
      return {
        created: false,
        window: existingWindow,
        opportunities: await this.listOpportunities(window.id),
      };
    }
    return {
      created: true,
      window: clone(window),
      opportunities: clone(opportunities),
    };
  }

  async listWindows(): Promise<StoryOpportunityWindow[]> {
    if (isFirestoreTemporarilyDegraded())
      throw new Error("Firestore is temporarily degraded");
    const { db } = await getFirebaseBundle();
    const snapshot: any = await withFirestoreRetry(
      "List story opportunity windows",
      () =>
        db
          .collection(STORY_OPPORTUNITY_WINDOWS_COLLECTION)
          .orderBy("windowEnd", "desc")
          .limit(30)
          .get(),
    );
    return snapshot.docs
      .map(windowFromDoc)
      .sort(
        (left: StoryOpportunityWindow, right: StoryOpportunityWindow) =>
          stableTextCompare(right.windowEnd, left.windowEnd) ||
          stableTextCompare(right.calculatedAt, left.calculatedAt) ||
          stableTextCompare(right.id, left.id),
      );
  }

  async getWindow(id: string): Promise<StoryOpportunityWindow | null> {
    if (isFirestoreTemporarilyDegraded())
      throw new Error("Firestore is temporarily degraded");
    const { db } = await getFirebaseBundle();
    const snapshot: any = await withFirestoreRetry(
      "Read story opportunity window",
      () => db.collection(STORY_OPPORTUNITY_WINDOWS_COLLECTION).doc(id).get(),
    );
    return snapshot.exists ? windowFromDoc(snapshot) : null;
  }

  async getLatestWindow(): Promise<StoryOpportunityWindow | null> {
    const windows = await this.listWindows();
    return windows[0] ?? null;
  }

  async listOpportunities(windowId: string): Promise<StoryOpportunity[]> {
    if (isFirestoreTemporarilyDegraded())
      throw new Error("Firestore is temporarily degraded");
    const { db } = await getFirebaseBundle();
    const snapshot: any = await withFirestoreRetry(
      "List story opportunities",
      () =>
        db
          .collection(STORY_OPPORTUNITIES_COLLECTION)
          .where("windowId", "==", windowId)
          .get(),
    );
    return snapshot.docs
      .map(opportunityFromDoc)
      .sort(
        (left: StoryOpportunity, right: StoryOpportunity) =>
          left.shortlistPosition - right.shortlistPosition ||
          stableTextCompare(left.id, right.id),
      );
  }

  async getOpportunity(id: string): Promise<StoryOpportunity | null> {
    if (isFirestoreTemporarilyDegraded())
      throw new Error("Firestore is temporarily degraded");
    const { db } = await getFirebaseBundle();
    const snapshot: any = await withFirestoreRetry(
      "Read story opportunity",
      () => db.collection(STORY_OPPORTUNITIES_COLLECTION).doc(id).get(),
    );
    return snapshot.exists ? opportunityFromDoc(snapshot) : null;
  }

  async mutateOpportunity(
    id: string,
    mutate: (opportunity: StoryOpportunity) => StoryOpportunity,
  ): Promise<StoryOpportunity | null> {
    if (isFirestoreTemporarilyDegraded())
      throw new Error("Firestore is temporarily degraded");
    assertCanonicalOpportunityWriteTarget();
    const { db } = await getFirebaseBundle();
    const ref = db.collection(STORY_OPPORTUNITIES_COLLECTION).doc(id);
    return withFirestoreRetry("Update story opportunity", () =>
      db.runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return null;
        const current = opportunityFromDoc(snapshot);
        const updated = mutate(current);
        if (updated !== current) transaction.set(ref, updated);
        return clone(updated);
      }),
    );
  }

  async mutateOpportunityWithProfessor(
    id: string,
    professorId: string,
    mutate: (
      opportunity: StoryOpportunity,
      professorProfile: ProfessorProfile | null,
    ) => StoryOpportunity,
  ): Promise<StoryOpportunity | null> {
    if (isFirestoreTemporarilyDegraded())
      throw new Error("Firestore is temporarily degraded");
    assertCanonicalOpportunityWriteTarget();
    const { db } = await getFirebaseBundle();
    const opportunityRef = db
      .collection(STORY_OPPORTUNITIES_COLLECTION)
      .doc(id);
    const professorRef = db
      .collection(PROFESSOR_PROFILES_COLLECTION)
      .doc(professorId);
    return db.runTransaction(async (transaction: any) => {
      const opportunitySnapshot = await transaction.get(opportunityRef);
      if (!opportunitySnapshot.exists) return null;
      const professorSnapshot = await transaction.get(professorRef);
      const current = opportunityFromDoc(opportunitySnapshot);
      const professorProfile = professorSnapshot.exists
        ? professorProfileFromDoc(professorSnapshot)
        : null;
      const updated = mutate(current, professorProfile);
      if (updated !== current) transaction.set(opportunityRef, updated);
      return clone(updated);
    });
  }
}

export class MemoryStoryOpportunityRepository implements StoryOpportunityRepository {
  private readonly windows = new Map<string, StoryOpportunityWindow>();
  private readonly opportunities = new Map<string, StoryOpportunity>();

  constructor(
    private readonly loadProfessorProfile: ProfessorProfileLoader = () => null,
  ) {}

  async createFrozenSnapshot(
    window: StoryOpportunityWindow,
    opportunities: StoryOpportunity[],
  ): Promise<FrozenSnapshotResult> {
    const existing = this.windows.get(window.id);
    if (existing) {
      return {
        created: false,
        window: clone(existing),
        opportunities: await this.listOpportunities(window.id),
      };
    }
    this.windows.set(window.id, clone(window));
    for (const opportunity of opportunities)
      this.opportunities.set(opportunity.id, clone(opportunity));
    return {
      created: true,
      window: clone(window),
      opportunities: clone(opportunities),
    };
  }

  async listWindows(): Promise<StoryOpportunityWindow[]> {
    return [...this.windows.values()]
      .map(clone)
      .sort(
        (left, right) =>
          stableTextCompare(right.windowEnd, left.windowEnd) ||
          stableTextCompare(right.calculatedAt, left.calculatedAt) ||
          stableTextCompare(right.id, left.id),
      );
  }

  async getWindow(id: string): Promise<StoryOpportunityWindow | null> {
    const value = this.windows.get(id);
    return value ? clone(value) : null;
  }

  async getLatestWindow(): Promise<StoryOpportunityWindow | null> {
    return (await this.listWindows())[0] ?? null;
  }

  async listOpportunities(windowId: string): Promise<StoryOpportunity[]> {
    return [...this.opportunities.values()]
      .filter((opportunity) => opportunity.windowId === windowId)
      .map(clone)
      .sort(
        (left, right) =>
          left.shortlistPosition - right.shortlistPosition ||
          stableTextCompare(left.id, right.id),
      );
  }

  async getOpportunity(id: string): Promise<StoryOpportunity | null> {
    const value = this.opportunities.get(id);
    return value ? clone(value) : null;
  }

  async mutateOpportunity(
    id: string,
    mutate: (opportunity: StoryOpportunity) => StoryOpportunity,
  ): Promise<StoryOpportunity | null> {
    const current = this.opportunities.get(id);
    if (!current) return null;
    const updated = mutate(clone(current));
    this.opportunities.set(id, clone(updated));
    return clone(updated);
  }

  async mutateOpportunityWithProfessor(
    id: string,
    professorId: string,
    mutate: (
      opportunity: StoryOpportunity,
      professorProfile: ProfessorProfile | null,
    ) => StoryOpportunity,
  ): Promise<StoryOpportunity | null> {
    const current = this.opportunities.get(id);
    if (!current) return null;
    const professorProfile = await this.loadProfessorProfile(professorId);
    const updated = mutate(
      clone(current),
      professorProfile ? clone(professorProfile) : null,
    );
    this.opportunities.set(id, clone(updated));
    return clone(updated);
  }
}
