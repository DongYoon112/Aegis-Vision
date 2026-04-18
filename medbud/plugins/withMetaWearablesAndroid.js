const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withSettingsGradle,
} = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-meta-wearables-android';
const PLUGIN_VERSION = '2.0.0';

const DAT_REPOSITORY_URL =
  'https://maven.pkg.github.com/facebook/meta-wearables-dat-android';
const DAT_VERSION = process.env.META_WEARABLES_DAT_VERSION || '0.6.0';
const DAT_APP_ID = process.env.META_WEARABLES_APP_ID || '';
const DAT_CLIENT_TOKEN = process.env.META_WEARABLES_CLIENT_TOKEN || '';
const DAT_ANALYTICS_OPT_OUT =
  (process.env.META_WEARABLES_ANALYTICS_OPT_OUT || 'false').toLowerCase() ===
  'true';
const DAT_ENABLE_MOCK_DEVICE =
  (process.env.META_WEARABLES_ENABLE_MOCK_DEVICE || 'false').toLowerCase() ===
  'true';

const SETTINGS_SNIPPET = `
def metaWearablesGithubToken = System.getenv("GITHUB_TOKEN")
if (!metaWearablesGithubToken) {
  def metaWearablesLocalProperties = new Properties()
  def metaWearablesLocalPropertiesFile = new File(rootDir, "local.properties")
  if (metaWearablesLocalPropertiesFile.exists()) {
    metaWearablesLocalPropertiesFile.withInputStream { stream ->
      metaWearablesLocalProperties.load(stream)
    }
    metaWearablesGithubToken = metaWearablesLocalProperties.getProperty("github_token")
  }
}

gradle.settingsEvaluated { settings ->
  def metaWearablesRepoUrl = uri("${DAT_REPOSITORY_URL}")
  def existingMetaWearablesRepo =
    settings.dependencyResolutionManagement.repositories.find { repo ->
      repo.hasProperty("url") && repo.url?.toString() == metaWearablesRepoUrl.toString()
    }

  if (!existingMetaWearablesRepo) {
    settings.dependencyResolutionManagement.repositories.maven {
      url = metaWearablesRepoUrl
      credentials {
        username = ""
        password = metaWearablesGithubToken
      }
    }
  }
}
`.trim();

const APP_GRADLE_SNIPPET = `
def metaWearablesDatVersion = System.getenv("META_WEARABLES_DAT_VERSION") ?: "${DAT_VERSION}"
def metaWearablesAppId = System.getenv("META_WEARABLES_APP_ID") ?: "${DAT_APP_ID}"
def metaWearablesClientToken = System.getenv("META_WEARABLES_CLIENT_TOKEN") ?: "${DAT_CLIENT_TOKEN}"
def metaWearablesAnalyticsOptOut =
  (System.getenv("META_WEARABLES_ANALYTICS_OPT_OUT") ?: "${String(DAT_ANALYTICS_OPT_OUT)}").toBoolean()
def metaWearablesEnableMockDevice =
  (System.getenv("META_WEARABLES_ENABLE_MOCK_DEVICE") ?: "${String(DAT_ENABLE_MOCK_DEVICE)}").toBoolean()
def metaWearablesGithubToken = System.getenv("GITHUB_TOKEN")
if (!metaWearablesGithubToken) {
  def metaWearablesLocalProperties = new Properties()
  def metaWearablesLocalPropertiesFile = new File(rootProject.projectDir, "local.properties")
  if (metaWearablesLocalPropertiesFile.exists()) {
    metaWearablesLocalPropertiesFile.withInputStream { stream ->
      metaWearablesLocalProperties.load(stream)
    }
    metaWearablesGithubToken = metaWearablesLocalProperties.getProperty("github_token")
  }
}

android {
  defaultConfig {
    manifestPlaceholders += [
      mwdat_application_id: metaWearablesAppId,
      mwdat_client_token: metaWearablesClientToken,
    ]

    buildConfigField "String", "META_WEARABLES_DAT_VERSION", "\\"${metaWearablesDatVersion}\\""
    buildConfigField "String", "META_WEARABLES_APP_ID", "\\"${metaWearablesAppId}\\""
    buildConfigField "String", "META_WEARABLES_CLIENT_TOKEN", "\\"${metaWearablesClientToken}\\""
    buildConfigField "boolean", "META_WEARABLES_ANALYTICS_OPT_OUT", String.valueOf(metaWearablesAnalyticsOptOut)
    buildConfigField "boolean", "META_WEARABLES_ENABLE_MOCK_DEVICE", String.valueOf(metaWearablesEnableMockDevice)
    buildConfigField "boolean", "META_WEARABLES_REPO_CONFIGURED", String.valueOf(metaWearablesGithubToken != null && !metaWearablesGithubToken.isEmpty())
    buildConfigField "boolean", "META_WEARABLES_APPLICATION_ID_CONFIGURED", String.valueOf(metaWearablesAppId != null && !metaWearablesAppId.isEmpty())
  }
}

dependencies {
  implementation("com.meta.wearable:mwdat-core:${metaWearablesDatVersion}")
  implementation("com.meta.wearable:mwdat-camera:${metaWearablesDatVersion}")
  if (metaWearablesEnableMockDevice) {
    implementation("com.meta.wearable:mwdat-mockdevice:${metaWearablesDatVersion}")
  }
}
`.trim();

const appendIfMissing = (contents, snippet, marker) =>
  contents.includes(marker) ? contents : `${contents}\n\n// ${marker}\n${snippet}\n`;

const ensureUsesPermission = (manifest, permissionName) => {
  manifest.manifest['uses-permission'] =
    manifest.manifest['uses-permission'] || [];

  const alreadyPresent = manifest.manifest['uses-permission'].some(
    (permission) => permission.$['android:name'] === permissionName
  );

  if (!alreadyPresent) {
    manifest.manifest['uses-permission'].push({
      $: { 'android:name': permissionName },
    });
  }

  return manifest;
};

const ensureUsesFeature = (manifest, name, required = 'false') => {
  manifest.manifest['uses-feature'] = manifest.manifest['uses-feature'] || [];
  const existing = manifest.manifest['uses-feature'].find(
    (feature) => feature.$['android:name'] === name
  );

  if (existing) {
    existing.$['android:required'] = required;
    return manifest;
  }

  manifest.manifest['uses-feature'].push({
    $: {
      'android:name': name,
      'android:required': required,
    },
  });
  return manifest;
};

const ensureMetaDataItem = (app, name, value) => {
  app['meta-data'] = app['meta-data'] || [];
  const existing = app['meta-data'].find((item) => item.$['android:name'] === name);

  if (existing) {
    existing.$['android:value'] = value;
    return;
  }

  app['meta-data'].push({
    $: {
      'android:name': name,
      'android:value': value,
    },
  });
};

const withMetaWearablesAndroid = (config) => {
  config = withAndroidManifest(config, (mod) => {
    mod.modResults = ensureUsesPermission(mod.modResults, 'android.permission.BLUETOOTH');
    mod.modResults = ensureUsesPermission(
      mod.modResults,
      'android.permission.BLUETOOTH_CONNECT'
    );
    mod.modResults = ensureUsesPermission(mod.modResults, 'android.permission.CAMERA');
    mod.modResults = ensureUsesPermission(mod.modResults, 'android.permission.INTERNET');
    mod.modResults = ensureUsesFeature(
      mod.modResults,
      'android.hardware.camera',
      'false'
    );

    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(
      mod.modResults
    );

    ensureMetaDataItem(
      mainApplication,
      'com.meta.wearable.mwdat.APPLICATION_ID',
      '${mwdat_application_id}'
    );
    ensureMetaDataItem(
      mainApplication,
      'com.meta.wearable.mwdat.CLIENT_TOKEN',
      '${mwdat_client_token}'
    );

    if (DAT_ANALYTICS_OPT_OUT) {
      ensureMetaDataItem(
        mainApplication,
        'com.meta.wearable.mwdat.ANALYTICS_OPT_OUT',
        'true'
      );
    }

    return mod;
  });

  config = withSettingsGradle(config, (mod) => {
    mod.modResults.contents = appendIfMissing(
      mod.modResults.contents,
      SETTINGS_SNIPPET,
      'Meta Wearables DAT settings'
    );
    return mod;
  });

  config = withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = appendIfMissing(
      mod.modResults.contents,
      APP_GRADLE_SNIPPET,
      'Meta Wearables DAT app setup'
    );
    return mod;
  });

  return config;
};

module.exports = createRunOncePlugin(
  withMetaWearablesAndroid,
  PLUGIN_NAME,
  PLUGIN_VERSION
);
