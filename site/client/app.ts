import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ConnectOutcome } from "../../src/api.ts";
import type { BrowserConfig } from "../public-config.ts";

interface Me {
  email: string | null;
  installsEnabled: boolean;
  testingMode: boolean;
  retentionHours: number;
  destination: string;
  crossWorkspaceConsent: boolean;
  installations: { id: string; teamId: string; teamName: string; slackUserId: string; status: "active" | "revoked" }[];
}

type Tone = "ok" | "warn" | "error" | "plain";
type Child = Node | string | null | false | undefined | Child[];

const CONNECT_MESSAGES: Record<ConnectOutcome, [Tone, string]> = {
  connected: ["ok", "Workspace connected. Send a connection test to confirm ReactPing can DM you there."],
  denied: [
    "warn",
    "Slack authorization was cancelled or not approved. If your workspace requires admin approval, connect again once an admin approves ReactPing.",
  ],
  expired: [
    "warn",
    "That Slack authorization expired, was already used, or was opened in a different browser. Start again from this page.",
  ],
  oauth_failed: ["error", "Slack authorization failed. Please try again."],
  enterprise_unsupported: [
    "warn",
    "Enterprise Grid organization-wide installs aren't supported. Connect an individual workspace instead.",
  ],
  missing_scope: ["warn", "Slack didn't grant the reactions:read permission, so the workspace wasn't connected."],
  installs_disabled: ["warn", "New Slack connections are turned off right now."],
};

const ERROR_MESSAGES: Record<string, string> = {
  installs_disabled: "New Slack connections aren't open yet.",
  wrong_origin: "Open ReactPing at its main web address to connect Slack.",
  consent_required: "Sending to another workspace needs the cross-workspace consent checkbox.",
  unknown_destination: "That workspace can't be used as a destination. Reload and try again.",
  too_many_tests: "Please wait a minute between connection tests.",
  revoked: "Slack reports this connection was revoked. Reconnect the workspace.",
  slack_error: "Slack didn't accept the test message. Try again shortly.",
  not_found: "That workspace is no longer connected. Reload the page.",
  not_configured: "The ReactPing backend isn't configured yet.",
  unauthorized: "Your session ended. Please sign in again.",
};

class ApiError extends Error {
  readonly status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

function flatten(children: Child[]): (Node | string)[] {
  return children.flatMap((child) => (Array.isArray(child) ? flatten(child) : child ? [child] : []));
}

/** Minimal DOM builder. Text is always inserted as text nodes, never parsed as HTML. */
function h(tag: string, attrs: Record<string, string | boolean | ((event: Event) => void)> = {}, ...children: Child[]) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "function") el.addEventListener(key.replace(/^on/, ""), value);
    else if (value === true) el.setAttribute(key, "");
    else if (value !== false) el.setAttribute(key, value);
  }
  el.append(...flatten(children));
  return el;
}

const root = document.getElementById("app")!;
const config = JSON.parse(document.getElementById("reactping-config")!.textContent!) as BrowserConfig;
let supabase: SupabaseClient;
let flash: [Tone, string] | null = null;

function render(...nodes: Child[]): void {
  root.replaceChildren(...flatten(nodes));
}

function notice(tone: Tone, text: string, role: "status" | "alert" = "status"): HTMLElement {
  return h("p", { class: `notice notice-${tone}`, role }, text);
}

function errorText(error: unknown): string {
  return error instanceof ApiError
    ? (ERROR_MESSAGES[error.message] ?? "Something went wrong. Please try again.")
    : "Network error. Check your connection and try again.";
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, "unauthorized");
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? "internal_error");
  return json as T;
}

function notConnected(title: string, text: string): void {
  render(
    h(
      "div",
      { class: "panel" },
      h("h2", {}, title),
      h("p", {}, text),
      h(
        "p",
        { class: "muted small" },
        "Nothing has been saved and no Slack workspace can be connected from this deployment yet.",
      ),
      h("a", { class: "btn btn-quiet", href: "/install" }, "Back to install guide"),
    ),
  );
}

// Sign-in

function signInForm(message?: [Tone, string]): void {
  const email = h("input", {
    id: "email",
    type: "email",
    name: "email",
    autocomplete: "email",
    required: true,
  }) as HTMLInputElement;
  const status = h("div", {});
  const form = h(
    "form",
    {
      class: "panel",
      onsubmit: async (event: Event) => {
        event.preventDefault();
        const button = form.querySelector("button")!;
        button.disabled = true;
        const { error } = await supabase.auth.signInWithOtp({
          email: email.value.trim(),
          options: { shouldCreateUser: true },
        });
        button.disabled = false;
        if (error) {
          status.replaceChildren(
            notice(
              "error",
              error.status === 429
                ? "Too many code requests. Wait a little and try again."
                : "We couldn't send a code. Check the address and try again.",
              "alert",
            ),
          );
          return;
        }
        codeForm(email.value.trim());
      },
    },
    h("h2", {}, "Sign in"),
    h("p", { class: "muted" }, "Enter your email and we'll send a one-time code. No password needed."),
    message && notice(message[0], message[1]),
    h("div", { class: "field" }, h("label", { for: "email" }, "Email address"), email),
    status,
    h("button", { class: "btn btn-primary", type: "submit" }, "Email me a code"),
  );
  render(form);
  email.focus();
}

function codeForm(email: string): void {
  const code = h("input", {
    id: "code",
    name: "code",
    inputmode: "numeric",
    autocomplete: "one-time-code",
    pattern: "[0-9]{6,10}",
    required: true,
  }) as HTMLInputElement;
  const status = h("div", {});
  const form = h(
    "form",
    {
      class: "panel",
      onsubmit: async (event: Event) => {
        event.preventDefault();
        const { error } = await supabase.auth.verifyOtp({ email, token: code.value.trim(), type: "email" });
        if (error) {
          status.replaceChildren(
            notice("error", "That code is invalid or expired. Check it or request a new one.", "alert"),
          );
          return;
        }
        await showAccount();
      },
    },
    h("h2", {}, "Check your email"),
    h("p", {}, "We sent a code to ", h("strong", {}, email), ". Enter it below."),
    h("div", { class: "field" }, h("label", { for: "code" }, "Sign-in code"), code),
    status,
    h(
      "div",
      { class: "row" },
      h("button", { class: "btn btn-primary", type: "submit" }, "Sign in"),
      h("button", { class: "btn btn-quiet", type: "button", onclick: () => signInForm() }, "Use a different email"),
    ),
  );
  render(form);
  code.focus();
}

// Account

async function connectWorkspace(button: HTMLButtonElement, status: HTMLElement): Promise<void> {
  button.disabled = true;
  try {
    const { url } = await api<{ url: string }>("/api/slack/install", {});
    window.location.assign(url);
  } catch (error) {
    button.disabled = false;
    status.replaceChildren(notice("error", errorText(error), "alert"));
  }
}

function workspacesPanel(me: Me): HTMLElement {
  const status = h("div", {});
  const connect = h(
    "button",
    { class: "btn btn-primary", type: "button", disabled: !me.installsEnabled },
    "Connect a workspace",
  ) as HTMLButtonElement;
  connect.addEventListener("click", () => connectWorkspace(connect, status));

  const list = h(
    "ul",
    { class: "workspaces" },
    ...me.installations.map((i) => {
      const active = i.status === "active";
      const item = h(
        "li",
        { class: "workspace" },
        h(
          "div",
          {},
          h("span", { class: "workspace-name" }, i.teamName),
          h("span", { class: `badge ${active ? "badge-ok" : "badge-bad"}` }, active ? "Active" : "Revoked"),
          h("div", { class: "muted small" }, `Slack user ${i.slackUserId}`),
        ),
        h(
          "div",
          { class: "row" },
          active
            ? h(
                "button",
                {
                  class: "btn btn-quiet btn-small",
                  type: "button",
                  onclick: async () => {
                    try {
                      await api("/api/installations/test", { installation: i.id });
                      status.replaceChildren(
                        notice(
                          "ok",
                          `Connection test sent to your ReactPing DM in ${i.teamName}. It checks connectivity only; it is not a reaction notification.`,
                        ),
                      );
                    } catch (error) {
                      status.replaceChildren(notice("error", errorText(error), "alert"));
                      if (error instanceof ApiError && error.message === "revoked") await showAccount();
                    }
                  },
                },
                "Send test DM",
              )
            : h(
                "button",
                {
                  class: "btn btn-primary btn-small",
                  type: "button",
                  disabled: !me.installsEnabled,
                  onclick: (event: Event) => connectWorkspace(event.currentTarget as HTMLButtonElement, status),
                },
                "Reconnect",
              ),
          h(
            "button",
            {
              class: "btn btn-danger btn-small",
              type: "button",
              onclick: async () => {
                if (
                  !window.confirm(
                    `Disconnect ${i.teamName}? ReactPing will revoke its Slack access and delete its data.`,
                  )
                )
                  return;
                try {
                  const { revoked } = await api<{ revoked: boolean }>("/api/installations/disconnect", {
                    installation: i.id,
                  });
                  flash = revoked
                    ? ["ok", `${i.teamName} disconnected and its Slack tokens revoked.`]
                    : [
                        "warn",
                        `${i.teamName} was removed from ReactPing, but Slack didn't confirm revocation. You can also remove the app in Slack.`,
                      ];
                  await showAccount();
                } catch (error) {
                  status.replaceChildren(notice("error", errorText(error), "alert"));
                }
              },
            },
            "Disconnect",
          ),
        ),
      );
      return item;
    }),
  );

  return h(
    "section",
    { class: "panel", "aria-labelledby": "ws-heading" },
    h("h2", { id: "ws-heading" }, "Connected workspaces"),
    me.installations.length ? list : h("p", { class: "muted" }, "No workspaces connected yet."),
    status,
    h("div", { class: "row" }, connect),
    h(
      "p",
      { class: "muted small" },
      me.installsEnabled
        ? "Each workspace is authorized separately. Slack asks for reactions:read (you) and chat:write (the ReactPing bot). If your workspace needs admin approval, Slack will show a request form."
        : "New Slack connections aren't open yet. ReactPing is in a private pilot.",
    ),
  );
}

function destinationPanel(me: Me): HTMLElement | null {
  const active = me.installations.filter((i) => i.status === "active");
  if (active.length === 0) return null;
  const status = h("div", {});
  const radio = (value: string, label: Child, checked: boolean) =>
    h(
      "label",
      { class: "choice" },
      h("input", { type: "radio", name: "destination", value, checked }),
      h("span", {}, label),
    );
  const consent = h("input", {
    type: "checkbox",
    name: "consent",
    checked: me.crossWorkspaceConsent,
  }) as HTMLInputElement;
  const form = h(
    "form",
    {
      class: "panel",
      "aria-labelledby": "dest-heading",
      onsubmit: async (event: Event) => {
        event.preventDefault();
        const destination =
          (form.querySelector("input[name=destination]:checked") as HTMLInputElement | null)?.value ?? "same";
        try {
          await api("/api/destination", { destination, crossWorkspaceConsent: consent.checked });
          flash = ["ok", "Delivery destination saved."];
          await showAccount();
        } catch (error) {
          status.replaceChildren(notice("error", errorText(error), "alert"));
        }
      },
    },
    h("h2", { id: "dest-heading" }, "Where notifications go"),
    h(
      "fieldset",
      {},
      h("legend", { class: "sr-only" }, "Destination"),
      radio("same", "In the same workspace as the reacted message (default)", me.destination === "same"),
      ...active.map((i) =>
        radio(i.id, ["Everything to my DM in ", h("strong", {}, i.teamName)], me.destination === i.id),
      ),
    ),
    h(
      "label",
      { class: "choice" },
      consent,
      h(
        "span",
        {},
        "I allow ReactPing to send reaction details (emoji, source workspace name, and a message link) from my other workspaces into the selected workspace. Reactors are shown as “Someone” across workspaces.",
      ),
    ),
    status,
    h("button", { class: "btn btn-primary", type: "submit" }, "Save destination"),
  );
  return form;
}

function accountPanel(me: Me): HTMLElement {
  const confirmInput = h("input", { id: "confirm-delete", autocomplete: "off" }) as HTMLInputElement;
  const status = h("div", {});
  return h(
    "section",
    { class: "panel", "aria-labelledby": "acct-heading" },
    h("h2", { id: "acct-heading" }, "Your account and data"),
    h("p", {}, "Signed in as ", h("strong", {}, me.email ?? "your email"), "."),
    h(
      "p",
      { class: "muted small" },
      `ReactPing never reads message text. It stores encrypted Slack tokens, your Slack IDs, and for ${me.retentionHours} hours the emoji, reactor ID, channel ID, and message timestamp needed for each notification.`,
    ),
    h(
      "button",
      {
        class: "btn btn-quiet",
        type: "button",
        onclick: async () => {
          await supabase.auth.signOut();
          signInForm(["plain", "Signed out."]);
        },
      },
      "Sign out",
    ),
    h("h3", {}, "Delete my account"),
    h(
      "p",
      { class: "small" },
      "Disconnects every workspace, revokes ReactPing's Slack access, and deletes all stored data and your sign-in email. This can't be undone.",
    ),
    h("div", { class: "field" }, h("label", { for: "confirm-delete" }, "Type delete to confirm"), confirmInput),
    status,
    h(
      "button",
      {
        class: "btn btn-danger",
        type: "button",
        onclick: async () => {
          if (confirmInput.value.trim().toLowerCase() !== "delete") {
            status.replaceChildren(notice("warn", "Type delete in the box to confirm.", "alert"));
            return;
          }
          try {
            const result = await api<{ authUserDeleted: boolean; revoked: boolean }>("/api/account/delete", {
              confirm: "delete",
            });
            await supabase.auth.signOut({ scope: "local" });
            render(
              h(
                "div",
                { class: "panel" },
                h("h2", {}, "Account deleted"),
                h("p", {}, "Your workspaces and ReactPing data have been deleted."),
                !result.revoked &&
                  h(
                    "p",
                    { class: "small" },
                    "Slack didn't confirm every token revocation; you can also remove the ReactPing app in Slack.",
                  ),
                !result.authUserDeleted &&
                  h(
                    "p",
                    { class: "small" },
                    "Your sign-in email could not be removed automatically. Contact support to finish deleting it.",
                  ),
              ),
            );
          } catch (error) {
            status.replaceChildren(notice("error", errorText(error), "alert"));
          }
        },
      },
      "Delete everything",
    ),
  );
}

async function showAccount(): Promise<void> {
  let me: Me;
  try {
    me = await api<Me>("/api/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await supabase.auth.signOut({ scope: "local" });
      return signInForm(["warn", "Your session ended. Please sign in again."]);
    }
    render(notice("error", errorText(error), "alert"));
    return;
  }
  const message = flash;
  flash = null;
  render(
    message && notice(message[0], message[1]),
    me.testingMode && notice("warn", "Testing mode: reactions you add to your own messages also send notifications."),
    workspacesPanel(me),
    destinationPanel(me),
    accountPanel(me),
  );
}

async function start(): Promise<void> {
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    return notConnected(
      "Setup not connected",
      "This deployment doesn't have a sign-in service configured yet, so you can't sign in here.",
    );
  }
  try {
    const res = await fetch("/api/health");
    const health = (await res.json()) as { ready?: boolean };
    if (!health.ready) throw new Error("not ready");
  } catch {
    return notConnected(
      "Backend not connected",
      "The ReactPing service for this deployment isn't configured or reachable yet.",
    );
  }

  const params = new URLSearchParams(window.location.search);
  const outcome = params.get("slack") as ConnectOutcome | null;
  if (outcome && Object.hasOwn(CONNECT_MESSAGES, outcome)) flash = CONNECT_MESSAGES[outcome];
  if (params.has("slack")) history.replaceState(null, "", "/app");

  supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  const { data } = await supabase.auth.getSession();
  if (data.session) return showAccount();
  const pending = flash;
  flash = null;
  signInForm(pending ?? undefined);
}

void start();
