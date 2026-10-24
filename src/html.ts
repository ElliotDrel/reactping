export class SafeHtml {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Value = SafeHtml | string | number | null | undefined | false | Value[];

function render(value: Value): string {
  if (value === null || value === undefined || value === false) return "";
  if (Array.isArray(value)) return value.map(render).join("");
  return value instanceof SafeHtml ? value.value : escapeHtml(value);
}

/** Tagged template that escapes every interpolation unless it is already SafeHtml. */
export function html(strings: TemplateStringsArray, ...values: Value[]): SafeHtml {
  return new SafeHtml(strings.reduce((out, s, i) => out + s + (i < values.length ? render(values[i]) : ""), ""));
}
