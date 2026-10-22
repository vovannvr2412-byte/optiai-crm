export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function asString(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function unixSecondsToIso(value: unknown) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : new Date().toISOString();
}

export async function providerJson(response: Response) {
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const nested = asRecord(data?.error);
    const message = asString(nested?.message) || asString(data?.message) || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}
