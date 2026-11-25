# ReactPing

- Follow Elliot's global instructions and the shared `coding-prefs` skill.
- Keep the primary checkout on `main`; implement in sibling worktrees.
- Keep v1 to the scope and ship criteria in `README.md`.
- Verify Slack behavior with live events before claiming coverage.
- Never commit credentials or log Slack tokens, OAuth codes, or raw message content.
- Enforce workspace/user isolation: v1 delivers only within the reaction's workspace and has no cross-workspace routing.
- Format staged files and run typecheck, lint, build, and existing tests before code pushes.
- For each user-visible change, add an entry under `[Unreleased]` in `CHANGELOG.md`. Never bump versions or edit released sections: the Release workflow versions and tags every merge to `main` (see `docs/setup.md`).
- The repository is public (Elliot approved November 16, 2026). Never commit credentials, workspace/user IDs, or tester names.
