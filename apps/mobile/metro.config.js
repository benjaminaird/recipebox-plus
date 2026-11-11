// Metro, taught to see one directory outside the app.
//
// `public/shopping-list.js` is the production shopping-list algorithm: it
// aggregates ingredients across recipes, decides what may be combined and what
// must not be, and orders a list by supermarket aisle. The native app needs it
// to behave *identically*, because a list that differs between the phone and
// the laptop is a bug discovered in a supermarket with a trolley.
//
// ADR 0003's answer is `packages/recipe-core`, one copy consumed by both
// surfaces. That is the right end state and it is still the plan. But the
// extraction edits `src/app.jsx` and `server.js`, which are production web
// files, and this work is not allowed to touch them.
//
// So Metro is pointed at the file where it already lives. No production file
// changes, no second copy to drift, and the extraction stays available as its
// own milestone later. The folder is named precisely rather than adding the
// repository root, so Metro is not made to watch every node_modules in the
// tree.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const sharedDomain = path.resolve(projectRoot, "../../public");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...(config.watchFolders ?? []), sharedDomain];

module.exports = config;
