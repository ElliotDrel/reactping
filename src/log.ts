type Field = string | number | boolean | null | undefined;

/** Structured logs with an allowlist of scalar fields. Never pass tokens, codes, or payloads. */
export function log(level: "info" | "warn" | "error", message: string, fields: Record<string, Field> = {}): void {
  if (process.env.NODE_ENV === "test") return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  (level === "info" ? console.log : console.error)(line);
}
