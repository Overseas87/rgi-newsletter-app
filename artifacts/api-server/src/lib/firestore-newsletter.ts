import { getFirebaseBundle } from "./firebase";

export type NewsletterSubscriber = {
  id: number;
  email: string;
  name: string | null;
  topics: string[];
  isActive: boolean;
  subscribedAt: Date;
  updatedAt?: Date | null;
};

export type NewsletterDigestRecord = {
  id: number;
  weekOf: string;
  headline: string;
  body: string;
  topicTags: string[];
  subscriberCount: number;
  generatedAt: Date;
};

function arr(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function dateFrom(value: unknown): Date {
  if (!value) return new Date(0);
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  if (typeof (value as { toDate?: unknown }).toDate === "function") return (value as { toDate: () => Date }).toDate();
  return new Date(0);
}

async function nextNumericId(collection: string): Promise<number> {
  const { db, FieldValue } = await getFirebaseBundle();
  const ref = db.collection("_meta").doc("counters");
  return Number(await db.runTransaction(async (tx: any) => {
    const snapshot = await tx.get(ref);
    const current = Number(snapshot.data?.()?.[collection] ?? 0);
    const next = current + 1;
    tx.set(ref, { [collection]: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return next;
  }));
}

function subscriberFromDoc(doc: any): NewsletterSubscriber {
  const data = doc.data?.() ?? doc;
  return {
    id: Number(data.id ?? doc.id),
    email: String(data.email ?? ""),
    name: typeof data.name === "string" ? data.name : null,
    topics: arr(data.topics),
    isActive: data.isActive !== false,
    subscribedAt: dateFrom(data.subscribedAt),
    updatedAt: dateFrom(data.updatedAt),
  };
}

function digestFromDoc(doc: any): NewsletterDigestRecord {
  const data = doc.data?.() ?? doc;
  return {
    id: Number(data.id ?? doc.id),
    weekOf: String(data.weekOf ?? ""),
    headline: String(data.headline ?? ""),
    body: String(data.body ?? ""),
    topicTags: arr(data.topicTags),
    subscriberCount: Number(data.subscriberCount ?? 0),
    generatedAt: dateFrom(data.generatedAt),
  };
}

export async function listFirestoreNewsletterSubscribers(activeOnly = true): Promise<NewsletterSubscriber[]> {
  const { db } = await getFirebaseBundle();
  let ref: any = db.collection("newsletter_subscribers");
  if (activeOnly) ref = ref.where("isActive", "==", true);
  const snapshot = await ref.limit(1000).get();
  return snapshot.docs
    .map(subscriberFromDoc)
    .sort((a: NewsletterSubscriber, b: NewsletterSubscriber) => Number(b.subscribedAt) - Number(a.subscribedAt));
}

export async function upsertFirestoreNewsletterSubscriber(input: {
  email: string;
  name?: string | null;
  topics?: string[];
}): Promise<{ subscriber: NewsletterSubscriber; updated: boolean }> {
  const { db, FieldValue } = await getFirebaseBundle();
  const email = input.email.toLowerCase().trim();
  const existing = await db.collection("newsletter_subscribers").where("email", "==", email).limit(1).get();
  if (!existing.empty) {
    const ref = existing.docs[0].ref;
    await ref.set({
      name: input.name?.trim() || existing.docs[0].data()?.name || null,
      topics: Array.isArray(input.topics) ? input.topics : existing.docs[0].data()?.topics ?? [],
      isActive: true,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { subscriber: subscriberFromDoc(await ref.get()), updated: true };
  }

  const id = await nextNumericId("newsletter_subscribers");
  const ref = db.collection("newsletter_subscribers").doc(String(id));
  await ref.set({
    id,
    email,
    name: input.name?.trim() || null,
    topics: Array.isArray(input.topics) ? input.topics : [],
    isActive: true,
    subscribedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { subscriber: subscriberFromDoc(await ref.get()), updated: false };
}

export async function unsubscribeFirestoreNewsletterSubscriber(id: number): Promise<boolean> {
  const { db, FieldValue } = await getFirebaseBundle();
  const ref = db.collection("newsletter_subscribers").doc(String(id));
  const snapshot = await ref.get();
  if (!snapshot.exists) return false;
  await ref.set({ isActive: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return true;
}

export async function listFirestoreNewsletterDigests(limit = 20): Promise<NewsletterDigestRecord[]> {
  const { db } = await getFirebaseBundle();
  const snapshot = await db.collection("newsletter_digests").limit(Math.min(limit, 100)).get();
  return snapshot.docs
    .map(digestFromDoc)
    .sort((a: NewsletterDigestRecord, b: NewsletterDigestRecord) => Number(b.generatedAt) - Number(a.generatedAt));
}

export async function createFirestoreNewsletterDigest(input: {
  weekOf: string;
  headline: string;
  body: string;
  topicTags: string[];
  subscriberCount: number;
}): Promise<NewsletterDigestRecord> {
  const { db, FieldValue } = await getFirebaseBundle();
  const id = await nextNumericId("newsletter_digests");
  const ref = db.collection("newsletter_digests").doc(String(id));
  await ref.set({
    id,
    weekOf: input.weekOf,
    headline: input.headline,
    body: input.body,
    topicTags: input.topicTags,
    subscriberCount: input.subscriberCount,
    generatedAt: FieldValue.serverTimestamp(),
  });
  return digestFromDoc(await ref.get());
}
