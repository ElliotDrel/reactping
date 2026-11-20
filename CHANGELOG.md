# Changelog

All notable changes to ReactPing are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Website analytics.** PostHog counts website visits, where they came from (including `?r=` short links), and completed installs. It never sees Slack messages.

## [1.2.0] - 2026-11-19

Next.js site.

### Changed

- **Next.js site.** The website and API run on Next.js with the same pages and links, and the site now says it runs no analytics or third-party scripts instead of no scripts at all. [aa118f2](https://github.com/ElliotDrel/reactping/commit/aa118f2) [e34dccd](https://github.com/ElliotDrel/reactping/commit/e34dccd)

## [1.1.2] - 2026-11-19

Changelog page.

### Changed

- **Changelog page.** reactping.com/changelog is formatted, and each change links to its commit. [3b0587a](https://github.com/ElliotDrel/reactping/commit/3b0587a)

## [1.1.1] - 2026-11-19

Mentions show by name.

### Fixed

- **Mentions in previews.** People and channels mentioned in a DM's message preview show by name, not as raw IDs like `@U0123ABCD`. [cb9b1ee](https://github.com/ElliotDrel/reactping/commit/cb9b1ee)

## [1.1.0] - 2026-11-19

Poll totals and outage alerts.

### Added

- **Poll totals.** DMs show the emoji's running total when more than one person used it, so polls are easy to follow. [b0848ad](https://github.com/ElliotDrel/reactping/commit/b0848ad)
- **Changelog.** This page, also kept as `CHANGELOG.md` in the source. [e32e1a2](https://github.com/ElliotDrel/reactping/commit/e32e1a2)
- **Outage diagnosis.** Every reaction's outcome is counted hourly, including why a DM failed. [a245822](https://github.com/ElliotDrel/reactping/commit/a245822) [c4bbb91](https://github.com/ElliotDrel/reactping/commit/c4bbb91)
- **Health check.** `/api/health` reports when DMs are failing or reactions have stopped arriving. [a245822](https://github.com/ElliotDrel/reactping/commit/a245822)
- **Outage alerts.** Failed DMs, new feedback, and a day without reactions alert the developer in Slack. [b0848ad](https://github.com/ElliotDrel/reactping/commit/b0848ad)

### Changed

- **Privacy policy.** Covers the hourly totals and feedback alerts. [b0848ad](https://github.com/ElliotDrel/reactping/commit/b0848ad)

## [1.0.0] - 2026-11-18

Public launch.

### Added

- **Message previews.** DMs include a one-line preview of the message that got the reaction. [7f9ddb0](https://github.com/ElliotDrel/reactping/commit/7f9ddb0)
- **Website.** How it works, Security (each claim linked to the source lines that prove it), Privacy, and a `/connect` step that explains workspaces and admin approval. [7bfe638](https://github.com/ElliotDrel/reactping/commit/7bfe638)
- **Feedback form.** Send feedback from the website, including from links in Slack. [ce35be3](https://github.com/ElliotDrel/reactping/commit/ce35be3)
- **Live totals.** The homepage shows workspaces connected and notifications sent. [ad684a3](https://github.com/ElliotDrel/reactping/commit/ad684a3)
- **Logo.** ReactPing has its own icon in Slack. [d38c62c](https://github.com/ElliotDrel/reactping/commit/d38c62c)
- **Demo video.** A 19-second walkthrough. [279d23c](https://github.com/ElliotDrel/reactping/commit/279d23c)
- **Search.** Search engines can index the site, with a sitemap, IndexNow, `llms.txt`, and structured data. [f05e145](https://github.com/ElliotDrel/reactping/commit/f05e145) [fb87e4f](https://github.com/ElliotDrel/reactping/commit/fb87e4f)
- **Support email.** Reach the developer without an account. [15a25de](https://github.com/ElliotDrel/reactping/commit/15a25de)

### Changed

- **New home.** Moved to reactping.com. [8989e03](https://github.com/ElliotDrel/reactping/commit/8989e03)
- **Free forever.** ReactPing is free forever and MIT licensed, with public source. [704fea3](https://github.com/ElliotDrel/reactping/commit/704fea3) [8586fa6](https://github.com/ElliotDrel/reactping/commit/8586fa6)
- **More workspaces.** "Add another workspace" goes straight to Slack's approval page. [1f68aa3](https://github.com/ElliotDrel/reactping/commit/1f68aa3)

### Fixed

- **Link previews.** Links to the site preview properly in iMessage, X, and Slack. [121e425](https://github.com/ElliotDrel/reactping/commit/121e425)
- **Testing flag.** A testing setting could take the app down. [dbfea12](https://github.com/ElliotDrel/reactping/commit/dbfea12)

## [0.1.0] - 2026-11-15

Pilot release.

### Added

- **Reaction DMs.** A DM when someone else reacts to your Slack message, showing who reacted, the emoji, and a link back. Your own reactions don't notify you. [e3f44f0](https://github.com/ElliotDrel/reactping/commit/e3f44f0)
- **Per person, per workspace.** Each person adds ReactPing for themselves. DMs stay in the workspace where the reaction happened. [5f6d336](https://github.com/ElliotDrel/reactping/commit/5f6d336)
- **Disconnect.** Disconnect from the app's Home tab. Uninstalling the app deletes the workspace's stored tokens. [5f6d336](https://github.com/ElliotDrel/reactping/commit/5f6d336)

[unreleased]: https://github.com/ElliotDrel/reactping/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/ElliotDrel/reactping/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/ElliotDrel/reactping/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/ElliotDrel/reactping/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/ElliotDrel/reactping/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ElliotDrel/reactping/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/ElliotDrel/reactping/releases/tag/v0.1.0
