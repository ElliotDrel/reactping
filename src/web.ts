import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "./config.ts";
import { deriveKey, hmacHex, randomToken, safeEqual } from "./crypto.ts";
import type { Installation, Session, Store } from "./db.ts";
import { handleEventCallback, verifySlackSignature } from "./events.ts";
import { html, type SafeHtml } from "./html.ts";
import { log } from "./log.ts";
import { BOT_SCOPES, classifySlackError, USER_SCOPES, type SlackApi } from "./slack.ts";

export interface AppDeps {
  config: Config;
  store: Store;
  slack: SlackApi;
  now?: () => number;
  /** Called after an event is durably enqueued so delivery can start immediately. */
  onEnqueued?: () => void;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const NOTICES: Record<string, string> = {
  connected: "Workspace connected.",
  cancelled: "Slack authorization was cancelled.",
  disconnected: "Workspace disconnected and its tokens revoked.",
  disconnected_local:
    "Workspace removed. Slack did not confirm token revocation; you can also remove the app in Slack.",
  saved: "Delivery destination saved.",
  consent_required: "Sending to another workspace requires the cross-workspace consent checkbox.",
  enterprise_unsupported: "Enterprise Grid org-wide installs are not supported in v1.",
  missing_scope: "Slack did not grant reactions:read, so the workspace was not connected.",
  oauth_failed: "Slack authorization failed. Please try again.",
};

const PAGE_STYLE = `body{font:16px/1.5 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 1rem;color:#1d1c1d}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.4rem;border-bottom:1px solid #ddd}
button{font:inherit;padding:.4rem .9rem;cursor:pointer}.notice{background:#eef6ff;padding:.6rem 1rem;border-radius:4px}
.danger{color:#a00}small{color:#555}fieldset{border:1px solid #ddd;border-radius:4px}label{display:block;margin:.3rem 0}`;

export function createHandler(deps: AppDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const { config, store, slack } = deps;
  const now = deps.now ?? Date.now;
  const secureCookie = config.baseUrl.startsWith("https://");
  const cookieName = secureCookie ? "__Host-reactping_session" : "reactping_session";
  const stateKey = deriveKey(config.encryptionKey, "oauth-state");
  const redirectUri = `${config.baseUrl}/slack/oauth/callback`;

  function send(res: ServerResponse, status: number, body: string, type = "text/html; charset=utf-8"): void {
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://slack.com; frame-ancestors 'none'; base-uri 'none'",
      ...(secureCookie ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
    });
    res.end(body);
  }

  function redirect(res: ServerResponse, location: string, cookie?: string): void {
    res.writeHead(303, {
      Location: location,
      "Cache-Control": "no-store",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    });
    res.end();
  }

  function page(title: string, body: SafeHtml): string {
    return html`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${title} · ReactPing</title>
          <style>
            ${PAGE_STYLE}
          </style>
        </head>
        <body>
          <h1>ReactPing</h1>
          ${body}
        </body>
      </html>`.value;
  }

  function sessionCookie(value: string, maxAgeSec: number): string {
    return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secureCookie ? "; Secure" : ""}`;
  }

  function currentSession(req: IncomingMessage): Session | undefined {
    const header = req.headers.cookie ?? "";
    for (const part of header.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === cookieName) return store.getSession(rest.join("="));
    }
    return undefined;
  }

  function assertSameOrigin(req: IncomingMessage): void {
    const origin = req.headers.origin;
    if (origin && origin !== config.baseUrl) throw new HttpError(403, "Cross-origin request rejected");
    if (req.headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "Cross-site request rejected");
  }

  /** Session-bound mutation: same origin, valid session, and matching CSRF token. */
  async function mutation(req: IncomingMessage): Promise<{ session: Session; form: URLSearchParams }> {
    assertSameOrigin(req);
    const session = currentSession(req);
    if (!session) throw new HttpError(401, "Your session has expired. Return to the start page.");
    const form = new URLSearchParams(await readBody(req, 16 * 1024));
    if (!safeEqual(form.get("csrf") ?? "", session.csrfToken)) throw new HttpError(403, "Invalid CSRF token");
    return { session, form };
  }

  function stateSignature(nonce: string, sessionHash: string): string {
    return hmacHex(stateKey, `${nonce}.${sessionHash}`);
  }

  async function revokeQuietly(token: string | null): Promise<boolean> {
    if (!token) return true;
    try {
      await slack.revoke(token);
      return true;
    } catch (error) {
      const code = classifySlackError(error).message;
      log("warn", "revoke_failed", { error: code });
      // An already-invalid token is as good as revoked.
      return classifySlackError(error).kind === "revoked";
    }
  }

  /** Revokes the user's token and, if nobody else in the workspace still uses it, the bot token. */
  async function disconnect(installation: Installation): Promise<boolean> {
    // Disable local collection/delivery immediately, even if Slack is slow or unavailable.
    store.deleteInstallation(installation.id);
    const userOk = await revokeQuietly(installation.userToken);
    const botOk =
      store.countActiveInTeam(installation.teamId, installation.id) === 0
        ? installation.botToken !== null && (await revokeQuietly(installation.botToken))
        : true;
    return userOk && botOk;
  }

  function settingsPage(session: Session, notice: string | null): string {
    const account = store.getAccount(session.accountId)!;
    const installations = store.listInstallations(session.accountId);
    const active = installations.filter((i) => i.status === "active");
    const csrf = html`<input type="hidden" name="csrf" value="${session.csrfToken}" />`;
    const destination = account.destinationInstallationId;
    return page(
      "Settings",
      html`
        ${notice ? html`<p class="notice" role="status">${notice}</p>` : ""}
        <h2>Connected workspaces</h2>
        ${
          installations.length === 0
            ? html`<p>No workspaces connected yet.</p>`
            : html`<table>
                <tr>
                  <th>Workspace</th>
                  <th>Slack user</th>
                  <th>Status</th>
                  <th></th>
                </tr>
                ${installations.map(
                  (i) =>
                    html`<tr>
                      <td>${i.teamName}</td>
                      <td><code>${i.userId}</code></td>
                      <td>
                        ${i.status === "active" ? "Active" : html`<span class="danger">Revoked — reconnect</span>`}
                      </td>
                      <td>
                        <form method="post" action="/installations/disconnect">
                          ${csrf}<input type="hidden" name="installation" value="${i.id}" />
                          <button>Disconnect</button>
                        </form>
                      </td>
                    </tr>`,
                )}
              </table>`
        }
        <form method="post" action="/slack/install">
          ${csrf}
          <p><button>Connect a Slack workspace</button></p>
          <small>
            Requests user scope <code>${USER_SCOPES.join(",")}</code> and bot scope
            <code>${BOT_SCOPES.join(",")}</code>. Each workspace is authorized separately.
          </small>
        </form>

        <h2>Where to send notifications</h2>
        <form method="post" action="/destination">
          ${csrf}
          <fieldset>
            <label>
              <input type="radio" name="destination" value="same" ${destination ? "" : html`checked`} />
              In the same workspace as the reacted message (default)
            </label>
            ${active.map(
              (i) =>
                html`<label>
                  <input type="radio" name="destination" value="${i.id}" ${destination === i.id ? html`checked` : ""} />
                  Everything to my DM in <strong>${i.teamName}</strong>
                </label>`,
            )}
          </fieldset>
          <label>
            <input
              type="checkbox"
              name="cross_workspace_consent"
              value="yes"
              ${account.crossWorkspaceConsentAt ? html`checked` : ""}
            />
            I allow ReactPing to send reaction metadata (emoji, source workspace name, and a message link) from my other
            workspaces into the selected workspace. Reactor identities are not shared across workspaces.
          </label>
          <p><button>Save destination</button></p>
        </form>

        <h2>Your data</h2>
        <p>
          <small>
            ReactPing never reads message text or history. It stores encrypted Slack tokens, your Slack user IDs, and
            for up to ${config.retentionHours} hours the emoji, reactor ID, channel ID, and message timestamp needed to
            deliver each notification.
          </small>
        </p>
        <form method="post" action="/account/delete">
          ${csrf}
          <button class="danger">Disconnect everything and delete my data</button>
        </form>
      `,
    );
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", config.baseUrl);
    const key = `${req.method} ${url.pathname}`;

    switch (key) {
      case "GET /healthz": {
        store.db.prepare("SELECT 1").get();
        return send(res, 200, JSON.stringify({ ok: true }), "application/json");
      }

      case "POST /slack/events":
        return handleSlackEvent(req, res);

      case "GET /": {
        if (currentSession(req)) return redirect(res, "/settings");
        return send(
          res,
          200,
          page(
            "Welcome",
            html`<p>Get a bot DM when someone reacts to your Slack messages.</p>
              <p>
                Your ReactPing account lives in this browser session. Workspaces are linked only by completing Slack
                authorization from this session.
              </p>
              <form method="post" action="/start"><button>Get started</button></form>`,
          ),
        );
      }

      case "POST /start": {
        assertSameOrigin(req);
        await readBody(req, 1024);
        if (currentSession(req)) return redirect(res, "/settings");
        const { sessionId } = store.createAccountSession();
        return redirect(res, "/settings", sessionCookie(sessionId, 30 * 24 * 60 * 60));
      }

      case "GET /settings": {
        const session = currentSession(req);
        if (!session) return redirect(res, "/");
        return send(res, 200, settingsPage(session, NOTICES[url.searchParams.get("notice") ?? ""] ?? null));
      }

      case "POST /slack/install": {
        const { session } = await mutation(req);
        const nonce = randomToken();
        store.createOAuthState(nonce, session.idHash);
        const authorize = new URL("https://slack.com/oauth/v2/authorize");
        authorize.searchParams.set("client_id", config.slackClientId);
        authorize.searchParams.set("scope", BOT_SCOPES.join(","));
        authorize.searchParams.set("user_scope", USER_SCOPES.join(","));
        authorize.searchParams.set("redirect_uri", redirectUri);
        authorize.searchParams.set("state", `${nonce}.${stateSignature(nonce, session.idHash)}`);
        return redirect(res, authorize.href);
      }

      case "GET /slack/oauth/callback":
        return handleOAuthCallback(req, res, url);

      case "POST /destination": {
        const { session, form } = await mutation(req);
        const choice = form.get("destination") ?? "same";
        const consent = form.get("cross_workspace_consent") === "yes";
        if (choice === "same") {
          store.setDestination(session.accountId, null, false);
          return redirect(res, "/settings?notice=saved");
        }
        const dest = store.getInstallation(choice);
        if (!dest || dest.accountId !== session.accountId || dest.status !== "active") {
          throw new HttpError(400, "Unknown destination");
        }
        const crossWorkspace = store.listInstallations(session.accountId).some((i) => i.teamId !== dest.teamId);
        if (crossWorkspace && !consent) return redirect(res, "/settings?notice=consent_required");
        store.setDestination(session.accountId, dest.id, crossWorkspace && consent);
        return redirect(res, "/settings?notice=saved");
      }

      case "POST /installations/disconnect": {
        const { session, form } = await mutation(req);
        const installation = store.getInstallation(form.get("installation") ?? "");
        if (!installation || installation.accountId !== session.accountId) throw new HttpError(404, "Not found");
        const revoked = await disconnect(installation);
        return redirect(res, `/settings?notice=${revoked ? "disconnected" : "disconnected_local"}`);
      }

      case "POST /account/delete": {
        const { session } = await mutation(req);
        const installations = store.listInstallations(session.accountId);
        store.deleteAccount(session.accountId);
        for (const installation of installations) await disconnect(installation);
        return redirect(res, "/", sessionCookie("", 0));
      }

      default:
        throw new HttpError(404, "Not found");
    }
  }

  async function handleOAuthCallback(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const session = currentSession(req);
    if (!session) throw new HttpError(400, "Finish Slack authorization in the same browser session that started it.");
    const [nonce, signature] = (url.searchParams.get("state") ?? "").split(".");
    if (
      !nonce ||
      !signature ||
      !safeEqual(signature, stateSignature(nonce, session.idHash)) ||
      !store.consumeOAuthState(nonce, session.idHash)
    ) {
      throw new HttpError(
        400,
        "This authorization link is invalid, expired, or already used. Start again from settings.",
      );
    }
    if (url.searchParams.get("error")) return redirect(res, "/settings?notice=cancelled");
    const code = url.searchParams.get("code");
    if (!code) throw new HttpError(400, "Missing authorization code");

    let result;
    try {
      result = await slack.oauthAccess(code, redirectUri);
    } catch (error) {
      log("warn", "oauth_exchange_failed", { error: classifySlackError(error).message });
      return redirect(res, "/settings?notice=oauth_failed");
    }
    if (result.isEnterpriseInstall || !result.userScopes.includes("reactions:read")) {
      await revokeQuietly(result.userToken);
      if (store.countActiveInTeam(result.teamId, "") === 0) await revokeQuietly(result.botToken);
      return redirect(
        res,
        `/settings?notice=${result.isEnterpriseInstall ? "enterprise_unsupported" : "missing_scope"}`,
      );
    }
    let teamUrl: string | null = null;
    try {
      teamUrl = await slack.teamUrl(result.botToken);
    } catch (error) {
      log("info", "team_url_unavailable", { error: classifySlackError(error).message });
    }
    store.upsertInstallation(session.accountId, {
      teamId: result.teamId,
      teamName: result.teamName,
      teamUrl,
      userId: result.userId,
      botUserId: result.botUserId,
      userToken: result.userToken,
      botToken: result.botToken,
    });
    log("info", "installation_connected", { teamId: result.teamId });
    return redirect(res, "/settings?notice=connected");
  }

  async function handleSlackEvent(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req, 1024 * 1024);
    const timestamp = req.headers["x-slack-request-timestamp"];
    const signature = req.headers["x-slack-signature"];
    if (
      !verifySlackSignature(
        config.slackSigningSecret,
        raw,
        typeof timestamp === "string" ? timestamp : undefined,
        typeof signature === "string" ? signature : undefined,
        now(),
      )
    ) {
      throw new HttpError(401, "Invalid signature");
    }
    let body: { type?: string; challenge?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "Invalid JSON");
    }
    if (body.type === "url_verification" && typeof body.challenge === "string") {
      return send(res, 200, body.challenge, "text/plain; charset=utf-8");
    }
    if (body.type === "event_callback") {
      // Committed to SQLite before the 200, so a crash before this point makes Slack retry.
      const outcome = handleEventCallback(store, body as Parameters<typeof handleEventCallback>[1]);
      log("info", "event_processed", { outcome });
      if (outcome === "enqueued") deps.onEnqueued?.();
    }
    return send(res, 200, "", "text/plain");
  }

  return (req, res) => {
    route(req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Something went wrong.";
      if (status === 500)
        log("error", "request_failed", { path: req.url?.split("?")[0], error: (error as Error)?.name });
      if (res.headersSent) return res.destroy();
      send(
        res,
        status,
        page(
          "Error",
          html`<p>${message}</p>
            <p><a href="/">Back to ReactPing</a></p>`,
        ),
      );
    });
  };
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, "Request too large"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
