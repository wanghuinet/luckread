const { withAppBuildGradle } = require("@expo/config-plugins");

/**
 * Configure a stable, repository-secret-backed Android Release signing key.
 *
 * The signing values are read from the build environment; no keystore or
 * credential is checked into the repository.
 */
function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      throw new Error(
        "LuckRead Android release signing currently expects app/build.gradle (Groovy)."
      );
    }

    let contents = config.modResults.contents;

    // Expo prebuild regenerates this file from scratch, so fail loudly if
    // the expected structure changes instead of producing an incorrectly signed APK.
    if (!contents.includes("signingConfigs.release")) {
      const signingConfigsPattern = /(\n    signingConfigs\s*\{\n)([\s\S]*?)(\n    \})/;
      if (!signingConfigsPattern.test(contents)) {
        throw new Error(
          "Unable to configure LuckRead Release signing: signingConfigs block not found."
        );
      }

      contents = contents.replace(
        signingConfigsPattern,
        (_match, start, existingConfigs, end) =>
          `${start}${existingConfigs}
        release {
            def keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
            def keystorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            def keyAliasValue = System.getenv("ANDROID_KEY_ALIAS")
            def keyPasswordValue = System.getenv("ANDROID_KEY_PASSWORD")
            if (!keystorePath || !keystorePassword || !keyAliasValue || !keyPasswordValue) {
                throw new GradleException("Missing Android Release signing environment variables.")
            }
            storeFile file(keystorePath)
            storePassword keystorePassword
            keyAlias keyAliasValue
            keyPassword keyPasswordValue
        }${end}`
      );
    }

    const buildTypesStart = contents.indexOf("\n    buildTypes {");
    const releaseBlockStart =
      buildTypesStart >= 0
        ? contents.indexOf("\n        release {", buildTypesStart)
        : -1;
    const debugSigningIndex =
      releaseBlockStart >= 0
        ? contents.indexOf("signingConfig signingConfigs.debug", releaseBlockStart)
        : -1;

    if (debugSigningIndex >= 0) {
      contents =
        contents.slice(0, debugSigningIndex) +
        "signingConfig signingConfigs.release" +
        contents.slice(
          debugSigningIndex + "signingConfig signingConfigs.debug".length
        );
    } else if (releaseBlockStart < 0) {
      throw new Error(
        "Unable to configure LuckRead Release signing: buildTypes.release block not found."
      );
    } else if (
      !contents.slice(releaseBlockStart).includes("signingConfig signingConfigs.release")
    ) {
      throw new Error(
        "Unable to configure LuckRead Release signing: expected Release signing line not found."
      );
    }

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = withAndroidReleaseSigning;
