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

  it("maps every category to its bump and copies entries verbatim", () => {
    for (const [heading, version] of [
      ["Changed", "1.5.0"],
      ["Deprecated", "1.5.0"],
      ["Removed", "1.5.0"],
      ["Security", "1.4.1"],
    ]) {
      const release = nextRelease(changelog(`\n### ${heading}\n\n- Costs $& and $1.\n`), "1.4.0", "2026-11-25")!;
      assert.equal(release.version, version, heading);
      assert.ok(release.changelog.includes("- Costs $& and $1.\n"), heading);
    }
  });

  it("bumps the patch version for fixes alone", () => {
    assert.equal(nextRelease(changelog("\n### Fixed\n\n- A bug.\n"), "1.4.0", "2026-11-25")!.version, "1.4.1");
  });

  it("ignores empty feature headings when choosing the bump", () => {
    const fixOnly = changelog("\n### Added\n\n### Fixed\n\n- A bug.\n");
    assert.equal(nextRelease(fixOnly, "1.4.0", "2026-11-25")!.version, "1.4.1");
  });

  it("can always release the real CHANGELOG.md, so its format stays parseable", async () => {
    const { readFile } = await import("node:fs/promises");
    const real = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    const withFix = real.replace("## [Unreleased]\n", "## [Unreleased]\n\n### Fixed\n\n- Probe.\n");
    const release = nextRelease(withFix, "9.9.9", "2026-01-01")!;
    const v = release.version;
    assert.ok(["9.9.10", "9.10.0"].includes(v));
    assert.ok(release.changelog.includes(`## [Unreleased]\n\n## [${v}] - 2026-01-01\n`));
    assert.ok(release.changelog.includes(`/compare/v${v}...HEAD\n[${v}]: `));
  });
});
