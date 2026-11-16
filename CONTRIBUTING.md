# Contributing

Issues and small pull requests are welcome. ReactPing stays deliberately small; read the scope in the [README](README.md) before proposing a feature.

1. Use Node 24 and Docker (for the disposable test database).
2. Run the full check before opening a pull request:

   ```sh
   npm ci
   npm run db:test:start
   export TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres
   npm run check
   npm run db:test:stop
   ```

3. Add or update tests in `test/` for behavior changes. Tests mock Slack; never point them at a hosted database.
4. Never commit credentials, and never log Slack tokens, OAuth codes, or message content.
5. If you change a source line the website links to, update the link; `test/site.test.ts` checks every one.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
