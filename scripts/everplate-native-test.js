#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const exists = (name) => fs.existsSync(path.join(root, name));
const pngDimensions = (name) => {
  const data = fs.readFileSync(path.join(root, name));
  assert.strictEqual(data.toString('ascii', 1, 4), 'PNG', `${name} must be a PNG`);
  return { width:data.readUInt32BE(16), height:data.readUInt32BE(20) };
};

assert(exists('dist/everplate/index.html'), 'run npm run build:everplate first');

const product = read('src/product-config.js');
for (const value of ['#274233','#1B2E26','#6C816E','#A6B3A0','#CB9A4E','#FAF7F0','#0F1412','#FAF5F2']) {
  assert(product.includes(value), `missing EverPlate token ${value}`);
}
assert(product.includes('com.benjaminaird.everplate'));
assert(product.includes('deepLinkScheme:"everplate"'));
assert(product.includes('clientId:"recipebox-web"'), 'RecipeBox must remain the default product');

const recipeConfig = read('public/app-config.js');
assert(recipeConfig.includes('product: "recipebox"'));
assert(recipeConfig.includes('native: false'));
assert(read('capacitor.config.json').includes('com.recipeboxapp.recipebox'));
assert(read('public/sw.js').includes('2026-07-20-recipe-save'));
assert(exists('public/images/categories/baked-goods.webp'));
assert(read('src/app.jsx').includes('"Baked Goods": "/images/categories/baked-goods.webp"'));

const index = read('dist/everplate/index.html');
assert(index.includes('<title>EverPlate</title>'));
assert(index.includes('/vendor.js') && index.includes('/native-bridge.js'));
assert(!/<script[^>]+https:\/\//.test(index), 'native runtime scripts must be packaged locally');
assert(!index.includes('RecipeBox'), 'EverPlate shell must not expose RecipeBox branding');
assert(!/^\s*import\s/m.test(read('dist/everplate/app.js')), 'classic app script must not contain an unbundled module import');

const builtConfig = JSON.parse(read('dist/everplate/app-config.js').match(/Object\.freeze\((\{[\s\S]*\})\);/)[1]);
assert.strictEqual(builtConfig.product, 'everplate');
assert.strictEqual(builtConfig.native, true);
assert.strictEqual(builtConfig.clientId, 'everplate-native');
assert.strictEqual(new URL(builtConfig.apiBase).protocol, 'https:');
assert(!exists('dist/everplate/sw.js'), 'native bundle must not contain a service worker');

for (const file of [
  'dist/everplate/vendor.js',
  'dist/everplate/native-bridge.js',
  'dist/everplate/vendor/pdf.worker.min.mjs',
  'dist/everplate/vendor/lora-400.woff2',
  'dist/everplate/vendor/source-sans-3-400.woff2',
]) assert(fs.statSync(path.join(root, file)).size > 100, `${file} is empty`);
assert(read('native/everplate/src/vendor-entry.js').includes('window["pdfjs-dist/build/pdf"]'));

const nativeConfig = JSON.parse(read('native/everplate/capacitor.config.json'));
assert.strictEqual(nativeConfig.appId, 'com.benjaminaird.everplate');
assert.strictEqual(nativeConfig.appName, 'EverPlate');
assert.strictEqual(nativeConfig.server.iosScheme, 'https');
assert.strictEqual(nativeConfig.server.androidScheme, 'https');
assert.strictEqual(nativeConfig.plugins.CapacitorCookies.enabled, true);
assert.strictEqual(nativeConfig.plugins.CapacitorHttp.enabled, true);

const bridge = read('native/everplate/src/native-bridge.js');
for (const feature of ['Dialog','Filesystem','Haptics','Keyboard','Network','Share','SplashScreen','StatusBar','appUrlOpen','backButton','appStateChange']) {
  assert(bridge.includes(feature), `native bridge missing ${feature}`);
}
assert(read('server.js').includes('X-App-Client, X-App-Version, X-Request-Id'));

const info = read('native/everplate/ios/App/App/Info.plist');
for (const value of ['EverPlate','everplate','NSCameraUsageDescription','NSPhotoLibraryUsageDescription','PrivacyInfo']) {
  if (value !== 'PrivacyInfo') assert(info.includes(value), `Info.plist missing ${value}`);
}
assert(!info.includes('NSPhotoLibraryAddUsageDescription'), 'iOS must not request unused Photos write permission');
assert(!info.includes('UIRequiredDeviceCapabilities'), 'iOS must not retain obsolete template device requirements');
assert(exists('native/everplate/ios/App/App/PrivacyInfo.xcprivacy'));

const xcodeProject = read('native/everplate/ios/App/App.xcodeproj/project.pbxproj');
assert.strictEqual((xcodeProject.match(/MARKETING_VERSION = 1\.0\.0;/g) || []).length, 2, 'iOS Debug and Release must use version 1.0.0');
assert.strictEqual((xcodeProject.match(/CURRENT_PROJECT_VERSION = 1;/g) || []).length, 2, 'iOS Debug and Release must use build 1');
assert.strictEqual((xcodeProject.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.benjaminaird\.everplate;/g) || []).length, 2, 'iOS bundle ID must remain stable');

const manifest = read('native/everplate/android/app/src/main/AndroidManifest.xml');
for (const value of ['android.permission.CAMERA','android.permission.READ_MEDIA_IMAGES','android:scheme="everplate"','android:allowBackup="false"','android:usesCleartextTraffic="false"']) {
  assert(manifest.includes(value), `AndroidManifest missing ${value}`);
}
assert(exists('native/everplate/android/app/src/main/res/mipmap-anydpi-v33/ic_launcher.xml'));
assert(exists('native/everplate/android/app/src/main/res/drawable/ic_launcher_monochrome.xml'));
assert(read('native/everplate/android/app/src/main/res/values/colors.xml').includes('#274233'));
assert(read('native/everplate/android/app/src/main/res/values-night/colors.xml').includes('#0F1412'));

const icon = pngDimensions('native/everplate/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024x1024@1x.png');
assert.deepStrictEqual(icon, { width:1024, height:1024 });
const splash = pngDimensions('native/everplate/ios/App/App/Assets.xcassets/Splash.imageset/Default@1x~universal~anyany.png');
assert(splash.width >= 2000 && splash.height >= 2000);

for (const asset of ['monogram.svg','wordmark.svg','wordmark-light.svg','monochrome.svg']) {
  const body = read('public/brand/everplate/masters/' + asset);
  assert(body.includes('asset-status=production'));
  assert(!body.includes('<text'), `${asset} must contain converted paths, not live lettering`);
}
assert(!product.includes('placeholder.svg'), 'EverPlate runtime assets must not reference placeholders');
assert(exists('public/brand/everplate/store/google-play-feature-1024x500.png'));
assert(exists('public/brand/everplate/native/android/ic_launcher_monochrome.xml'));

const clientBundle = read('dist/everplate/app-config.js') + read('dist/everplate/native-bridge.js');
assert(!/(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|sk-ant-|sk_live_|postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@)/i.test(clientBundle), 'client bundle appears to contain a credential');

console.log('EverPlate native configuration/build checks passed');
