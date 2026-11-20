import { SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

const token = process.env.POSTHOG_PROJECT_TOKEN;
const host = process.env.POSTHOG_HOST;

let loggerProvider: LoggerProvider | undefined;
let posthogLogger: ReturnType<LoggerProvider["getLogger"]> | undefined;

if (token && host) {
  loggerProvider = new LoggerProvider({
    resource: resourceFromAttributes({
      "service.name": "reactping",
      "deployment.environment": process.env.NODE_ENV ?? "development",
    }),
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: `${host.replace(/\/$/, "")}/i/v1/logs`,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }),
      }),
    ],
  });
  // Use the constructed provider directly; existing application logs stay outside this export.
  posthogLogger = loggerProvider.getLogger("reactping.posthog");
} else if (process.env.NODE_ENV !== "production") {
  const missingVariable = token ? "POSTHOG_HOST" : "POSTHOG_PROJECT_TOKEN";
  console.error(
    `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
  );
}

export function register(): void {
  // Next.js 15+ invokes this module for server instrumentation; setup happens above so the provider is reusable.
}

/** Emits only purpose-written PostHog operational logs; application console logs remain local. */
export function posthogLog(message: string, attributes: Record<string, string | number | boolean> = {}): void {
  posthogLogger?.emit({ body: message, severityNumber: SeverityNumber.INFO, attributes });
}

/** Allows serverless work to finish exporting after its response has been sent. */
export function flushPosthogLogs(): Promise<void> {
  return loggerProvider?.forceFlush() ?? Promise.resolve();
}
