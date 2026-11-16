# Security policy

Please report vulnerabilities privately through GitHub's [private vulnerability reporting](https://github.com/ElliotDrel/reactping/security/advisories/new) for this repository, not in a public issue. Include the affected route or file and steps to reproduce. Never include real Slack tokens, OAuth codes, or message content.

Supported version: the latest commit on `main`, which is what [reactping.vercel.app](https://reactping.vercel.app) runs.

## In scope

- Slack request signature checks, OAuth state, and token encryption (`src/handler.ts`, `src/oauth-state.ts`, `src/crypto.ts`).
- Anything that could notify a user outside the reaction's own workspace, or about someone else's messages.
- Anything that logs or stores tokens, OAuth codes, or message content.
