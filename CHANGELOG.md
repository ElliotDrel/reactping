# Changelog

All notable changes to ReactPing are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.1] - 2026-11-19

### Fixed

- People and channels mentioned in a DM's message preview show by name, not as raw IDs like `@U0123ABCD`.

## [1.1.0] - 2026-11-19

### Added

- DMs show the emoji's running total when more than one person used it, so polls are easy to follow.
- This changelog, also on the website at reactping.com/changelog.
- Every reaction's outcome is counted hourly, including why a DM failed, so outages can be diagnosed.
- `/api/health` reports when DMs are failing or reactions have stopped arriving.
- Failed DMs, new feedback, and a day without reactions alert the developer in Slack.

### Changed

- The privacy policy covers the hourly totals and feedback alerts.

## [1.0.0] - 2026-11-18

Public launch.

### Added

- DMs include a one-line preview of the message that got the reaction.
- Website pages: How it works, Security (each claim linked to the source lines that prove it), Privacy, and a
  `/connect` step that explains workspaces and admin approval before Slack.
- A feedback form on the website.
- Homepage totals of workspaces connected and notifications sent.
- The ReactPing logo in Slack, and a 19-second demo video.
- Search engine indexing, a sitemap, IndexNow, `llms.txt`, and structured data.
- A support email.

### Changed

- Moved to reactping.com.
- ReactPing is free forever, MIT licensed, and the source is public.
- "Add another workspace" goes straight to Slack's approval page.

### Fixed

- Link previews in iMessage, X, and Slack.
- The self-reaction testing flag could take production down.

## [0.1.0] - 2026-11-15

Pilot release.

### Added

- A DM when someone else reacts to your Slack message, showing who reacted, the emoji, and a link back.
- Each person adds ReactPing for themselves, per workspace. DMs stay in the workspace where the reaction happened.
- Your own reactions don't notify you.
- Disconnect from the app's Home tab. Uninstalling the app deletes the workspace's stored tokens.

[unreleased]: https://github.com/ElliotDrel/reactping/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/ElliotDrel/reactping/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/ElliotDrel/reactping/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ElliotDrel/reactping/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/ElliotDrel/reactping/releases/tag/v0.1.0
