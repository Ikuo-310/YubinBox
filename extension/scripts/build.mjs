// SPDX-License-Identifier: AGPL-3.0-only
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist');
let config;
try {
  config = JSON.parse(await readFile(path.join(root, 'config.local.json'), 'utf8'));
} catch {
  throw new Error('Copy config.example.json to config.local.json and set your registered InboxSDK App ID.');
}
if (typeof config.appId !== 'string' || !/^sdk_.{5,15}_[0-9a-f]{10}$/.test(config.appId)) {
  throw new Error('Set a registered sdk_... App ID in config.local.json; placeholders are not accepted.');
}
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const sdkDir = path.join(root, 'node_modules/@inboxsdk/core');
const sdk = JSON.parse(await readFile(path.join(sdkDir, 'package.json'), 'utf8'));
if (sdk.version !== pkg.dependencies['@inboxsdk/core']) {
  throw new Error('Installed SDK differs from package.json. Run npm ci --ignore-scripts.');
}
await mkdir(out, { recursive: true });
// Copy upstream bundles verbatim: no minification or removal of license comments.
for (const name of ['inboxsdk.js', 'pageWorld.js', 'inboxsdk.js.map', 'pageWorld.js.map']) {
  await copyFile(path.join(sdkDir, name), path.join(out, name));
}
for (const name of ['background.js', 'probe.js', 'content.js']) {
  await copyFile(path.join(root, 'src', name), path.join(out, name));
}
await copyFile(path.join(root, 'manifest.json'), path.join(out, 'manifest.json'));
await copyFile(path.join(root, '../LICENSE'), path.join(out, 'LICENSE'));
await copyFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(out, 'THIRD_PARTY_NOTICES.md'));
await cp(path.join(root, 'third-party'), path.join(out, 'third-party'), { recursive: true });
await writeFile(path.join(out, 'config.js'),
  `// Local build configuration; do not commit.\nglobalThis.YubinBoxPocConfig = Object.freeze(${JSON.stringify({ appId: config.appId, sdkVersion: sdk.version, diagnosticOutput: config.diagnosticOutput === true })});\n`);
console.log(`Built extension/dist/manifest.json (InboxSDK ${sdk.version}). Gmail runtime remains unverified.`);
