import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyOtaBuildArtifact } from "../scripts/verify-ota-build-provenance.mjs";

const tempDirs = [];
const expected = {
  runId: "41632512398",
  runtimeVersion: "1.0.0-beta.457",
  channel: "production",
  projectId: "00000000-0000-4000-8000-000000000001",
  sourceSha: "a".repeat(40),
  sourceBranch: "main",
  eventName: "push",
};

function makeArtifact(overrides = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "luckread-ota-provenance-"));
  tempDirs.push(directory);
  const apkFile = "LuckRead-Android-Beta-1.0.0-beta.457-test-code457.apk";
  const apkBytes = Buffer.from("verified-test-apk");
  writeFileSync(path.join(directory, apkFile), apkBytes);
  const metadata = {
    workflowName: "LuckRead Android Beta Release",
    workflowRunId: expected.runId,
    sourceSha: expected.sourceSha,
    sourceBranch: expected.sourceBranch,
    eventName: expected.eventName,
    channel: expected.channel,
    runtimeVersion: expected.runtimeVersion,
    versionName: expected.runtimeVersion,
    androidVersionCode: 457,
    otaEnabled: true,
    projectId: expected.projectId,
    updateUrl: "https://u.expo.dev/" + expected.projectId,
    updateChannel: expected.channel,
    runtimeVersionPolicy: "appVersion",
    apkFile,
    apkSha256: createHash("sha256").update(apkBytes).digest("hex"),
    ...overrides,
  };
  const manifestPath = path.join(directory, "ota-build-metadata.json");
  writeFileSync(manifestPath, JSON.stringify(metadata));
  return { directory, manifestPath, metadata, apkFile };
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

test("accepts the exact successful Android APK, EAS channel, runtime and verified checksum", () => {
  const artifact = makeArtifact();
  const result = verifyOtaBuildArtifact(artifact.manifestPath, expected);
  expect(result.metadata.apkFile).toBe(artifact.apkFile);
  expect(result.apkPath).toBe(path.join(artifact.directory, artifact.apkFile));
});

test("rejects a mismatched runtime version", () => {
  const artifact = makeArtifact();
  expect(() => verifyOtaBuildArtifact(artifact.manifestPath, {
    ...expected,
    runtimeVersion: "1.0.0-beta.456",
  })).toThrow("runtime version does not match");
});

test("rejects a channel or project mismatch", () => {
  const channelArtifact = makeArtifact({ updateChannel: "preview" });
  expect(() => verifyOtaBuildArtifact(channelArtifact.manifestPath, expected))
    .toThrow("embedded EAS channel does not match");

  const projectArtifact = makeArtifact();
  expect(() => verifyOtaBuildArtifact(projectArtifact.manifestPath, {
    ...expected,
    projectId: "00000000-0000-4000-8000-000000000002",
  })).toThrow("EAS project ID does not match");
});

test("rejects a build that did not embed EAS Update", () => {
  const artifact = makeArtifact({ otaEnabled: false });
  expect(() => verifyOtaBuildArtifact(artifact.manifestPath, expected))
    .toThrow("EAS Update disabled");
});

test("rejects a replaced APK even when its manifest claims the original checksum", () => {
  const artifact = makeArtifact();
  writeFileSync(path.join(artifact.directory, artifact.apkFile), "different-apk");
  expect(() => verifyOtaBuildArtifact(artifact.manifestPath, expected))
    .toThrow("APK SHA-256 does not match");
});
