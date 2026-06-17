const { withMainApplication } = require("@expo/config-plugins");

/**
 * Stock emulators often cannot reach 10.0.2.2 on low-RAM Macs.
 * localhost:8081 + `adb reverse tcp:8081 tcp:8081` is reliable.
 */
function withAndroidMetroHost(config) {
  return withMainApplication(config, (config) => {
    let contents = config.modResults.contents;
    if (contents.includes("debug_http_host")) {
      return config;
    }

    if (!contents.includes("import android.preference.PreferenceManager")) {
      contents = contents.replace(
        "import android.app.Application",
        "import android.app.Application\nimport android.preference.PreferenceManager"
      );
    }

    contents = contents.replace(
      "override fun onCreate() {\n    super.onCreate()",
      `override fun onCreate() {
    super.onCreate()
    if (BuildConfig.DEBUG) {
      PreferenceManager.getDefaultSharedPreferences(this)
        .edit()
        .putString("debug_http_host", "localhost:8081")
        .apply()
    }`
    );

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = withAndroidMetroHost;
