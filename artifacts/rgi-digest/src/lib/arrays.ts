export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function safeDate(value: unknown, fallback: Date = new Date(0)): Date {
  const date = value instanceof Date ? value : new Date(asString(value));
  return Number.isNaN(date.getTime()) ? fallback : date;
}

export function safeTextBlocks(value: unknown): string[] {
  return asString(value).split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
}

export function safeLines(value: unknown): string[] {
  return asString(value).split("\n").map((item) => item.trim()).filter(Boolean);
}
