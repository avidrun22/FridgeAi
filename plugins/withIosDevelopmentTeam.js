/**
 * Expo config plugin: set DEVELOPMENT_TEAM on every Xcode build configuration.
 *
 * Without this, each `npx expo prebuild` regenerates the ios/ folder without
 * a team selected, and archive fails with "Signing for 'ok2eat' requires a
 * development team." You then have to open Xcode and pick the team by hand.
 *
 * With this plugin in app.json's `plugins` array, the team is applied on
 * prebuild, so the generated project is archive-ready out of the box.
 */
const { withXcodeProject } = require("@expo/config-plugins");

const DEVELOPMENT_TEAM = "VU4973B972"; // Apple Team ID for Gregory Goldberg

module.exports = function withIosDevelopmentTeam(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const buildConfigurations = project.pbxXCBuildConfigurationSection();
    Object.keys(buildConfigurations).forEach((key) => {
      const buildConfig = buildConfigurations[key];
      if (buildConfig && buildConfig.buildSettings) {
        buildConfig.buildSettings.DEVELOPMENT_TEAM = DEVELOPMENT_TEAM;
        // Ensure automatic signing stays on so Apple-provided profiles are used
        buildConfig.buildSettings.CODE_SIGN_STYLE = "Automatic";
      }
    });
    return cfg;
  });
};
