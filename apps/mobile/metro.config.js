// Metro, taught to see one directory outside the app.
//
// `packages/recipe-core` is RecipeBox's portable domain logic — the import
// extractor, the normalizer, the grounding check, the tag rules and the
// shopping-list algorithm. The native app consumes it rather than reimplementing
// it, because a shopping list that differs between the phone and the laptop is a
// bug discovered in a supermarket with a trolley, and an import that parses
// differently on each surface is two products.
//
// This is ADR 0003's shared package, and it is a real extraction: the package
// holds the only editable copy, `public/` holds generated copies for the
// browser, and `npm run core:check` fails if they drift. So nothing here is a
// second implementation that can quietly diverge.
//
// The package's `src` folder is named precisely rather than adding the
// repository root, so Metro is not made to watch every node_modules in the tree.
// Resolution stays by relative path: nothing links this package into
// node_modules, and the CI job that runs the domain regression scripts installs
// nothing at all, which is how the dependency-free contract is enforced.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const sharedDomain = path.resolve(projectRoot, "../../packages/recipe-core/src");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...(config.watchFolders ?? []), sharedDomain];

module.exports = config;
