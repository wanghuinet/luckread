import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fail = (message) => {
  throw new Error("OTA target build provenance invalid: " + message);
};

const same = (actual, expected, label) => {
  if (String(actual ?? "") !== String(expected ?? "")) {
    fail(label + " does not match the selected successful Android build.");
  }
};

export function verifyOtaBuildArtifact(metadataPath, expected) {
  const manifestPath = path.resolve(metadataPath);
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    fail("metadata file is missing or not valid JSON.");
  }

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    fail("metadata must be a JSON object.");
  }
  same(metadata.workflowName, "LuckRead Android Beta Release", "workflow");
  same(metadata.workflowRunId, expected.runId, "workflow run ID");
  same(metadata.sourceSha, expected.sourceSha, "source commit SHA");
  same(metadata.sourceBranch, expected.sourceBranch, "source branch");
  same(metadata.eventName, expected.eventName, "trigger event");
  same(metadata.channel, expected.channel, "EAS channel");
  same(metadata.runtimeVersion, expected.runtimeVersion, "runtime version");
  same(metadata.versionName, expected.runtimeVersion, "APK versionName");
  same(metadata.projectId, expected.projectId, "EAS project ID");

  if (metadata.otaEnabled !== true) fail("the APK was built with EAS Update disabled.");
  if (metadata.updateUrl !== "https://u.expo.dev/" + expected.projectId) {
    fail("the embedded EAS Update URL does not match the configured project.");
  }
  same(metadata.updateChannel, expected.channel, "embedded EAS channel");
  same(metadata.runtimeVersionPolicy, "appVersion", "runtime version policy");

  if (!Number.isSafeInteger(metadata.androidVersionCode) || metadata.androidVersionCode < 1) {
    fail("APK versionCode is missing or invalid.");
  }
  const apkName = metadata.apkFile;
  if (
    typeof apkName !== "string" ||
    path.basename(apkName) !== apkName ||
    !apkName.startsWith("LuckRead-Android-Beta-" + expected.runtimeVersion + "-") ||
    !apkName.endsWith("-code" + metadata.androidVersionCode + ".apk") ||
    !/^LuckRead-Android-Beta-.+-(?:signed|test)-code[1-9][0-9]*\.apk$/.test(apkName)
  ) {
    fail("APK filename does not encode the verified runtime and versionCode.");
  }
  if (typeof metadata.apkSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(metadata.apkSha256)) {
    fail("APK SHA-256 is missing or invalid.");
  }

  const apkPath = path.join(path.dirname(manifestPath), apkName);
  let actualSha256;
  try {
    actualSha256 = createHash("sha256").update(readFileSync(apkPath)).digest("hex");
  } catch {
    fail("the APK referenced by the build manifest is missing.");
  }
  if (actualSha256.toLowerCase() !== metadata.apkSha256.toLowerCase()) {
    fail("APK SHA-256 does not match the signed APK artifact.");
  }

  return { metadata, apkPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [metadataPath, runId, runtimeVersion, channel, projectId, sourceSha, sourceBranch, eventName] =
    process.argv.slice(2);
  if ([metadataPath, runId, runtimeVersion, channel, projectId, sourceSha, sourceBranch, eventName].some((value) => !value)) {
    console.error("Usage: node scripts/verify-ota-build-provenance.mjs <metadata.json> <run-id> <runtime-version> <channel> <project-id> <source-sha> <source-branch> <event>");
    process.exit(2);
  }
  const result = verifyOtaBuildArtifact(metadataPath, {
    runId,
    runtimeVersion,
    channel,
    projectId,
    sourceSha,
    sourceBranch,
    eventName,
  });
  console.log("Verified exact APK artifact: " + result.metadata.apkFile);
  console.log("Verified runtime " + result.metadata.runtimeVersion + ", channel " + result.metadata.channel +
    ", build run " + result.metadata.workflowRunId + ", SHA-256 " + result.metadata.apkSha256 + ".");
}
