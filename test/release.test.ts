import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextRelease } from "../scripts/release.mjs";

const REPO = "https://github.com/ElliotDrel/reactping";
const changelog = (unreleased: string) =>
  `# Changelog\n\n## [Unreleased]\n${unreleased}\n## [1.3.0] - 2026-11-20\n\n- Old.\n\n` +
  `[unreleased]: ${REPO}/compare/v1.3.0...HEAD\n[1.3.0]: ${REPO}/compare/v1.2.0...v1.3.0\n`;

describe("release", () => {
  it("does nothing when [Unreleased] has no entries", () => {
    assert.equal(nextRelease(changelog("\n"), "1.3.0", "2026-11-24"), null);
  });

  it("bumps the minor version for features and moves the entries under it", () => {
    const release = nextRelease(changelog("\n### Added\n\n- New thing.\n"), "1.3.0", "2026-11-24")!;
    assert.equal(release.version, "1.4.0");
    assert.equal(
      release.changelog,
      `# Changelog\n\n## [Unreleased]\n\n## [1.4.0] - 2026-11-24\n\n### Added\n\n- New thing.\n\n` +
        `## [1.3.0] - 2026-11-20\n\n- Old.\n\n[unreleased]: ${REPO}/compare/v1.4.0...HEAD\n` +
        `[1.4.0]: ${REPO}/compare/v1.3.0...v1.4.0\n[1.3.0]: ${REPO}/compare/v1.2.0...v1.3.0\n`,
    );
  });

  it("bumps the patch version for fixes alone", () => {
    assert.equal(nextRelease(changelog("\n### Fixed\n\n- A bug.\n"), "1.4.0", "2026-11-25")!.version, "1.4.1");
  });

  it("releases the real changelog's current entries", async () => {
    const { readFile } = await import("node:fs/promises");
    const real = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    const release = nextRelease(real, "9.9.9", "2026-01-01");
    if (release) assert.match(release.changelog, /^\[unreleased\]: .+\/compare\/v9\.10\.0\.\.\.HEAD$/m);
  });
});
