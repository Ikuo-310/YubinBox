// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

test('build rejects missing config and preserves SDK bytes and notices in a disposable fixture', async () => {
  const source = fileURLToPath(new URL('../', import.meta.url));
  const temporary = await mkdtemp(path.join(tmpdir(), 'yubinbox-build-test-'));
  const fixture = path.join(temporary, 'extension');
  try {
    await mkdir(fixture);
    for (const item of ['scripts', 'src', 'manifest.json', 'package.json', 'THIRD_PARTY_NOTICES.md', 'third-party', 'node_modules/@inboxsdk/core']) {
      await cp(path.join(source, item), path.join(fixture, item), { recursive: true });
    }
    await cp(path.join(source, '../LICENSE'), path.join(temporary, 'LICENSE'));
    const run = () => spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: fixture, encoding: 'utf8' });
    assert.notEqual(run().status, 0);
    // Synthetic syntax-only fixture, never installed in a browser or used to load SDK.
    await writeFile(path.join(fixture, 'config.local.json'), JSON.stringify({ appId: 'sdk_fixture_0000000000' }));
    const built = run();
    assert.equal(built.status, 0, built.stderr);
    const builtConfig = {};
    vm.runInNewContext(await readFile(path.join(fixture, 'dist/config.js'), 'utf8'), builtConfig);
    assert.equal(builtConfig.YubinBoxPocConfig.diagnosticOutput, false);
    for (const diagnosticOutput of [true, 'true']) {
      await writeFile(path.join(fixture, 'config.local.json'), JSON.stringify({ appId: 'sdk_fixture_0000000000', diagnosticOutput }));
      assert.equal(run().status, 0);
      const configured = {};
      vm.runInNewContext(await readFile(path.join(fixture, 'dist/config.js'), 'utf8'), configured);
      assert.equal(configured.YubinBoxPocConfig.diagnosticOutput, diagnosticOutput === true);
    }
    const manifest = JSON.parse(await readFile(path.join(fixture, 'dist/manifest.json')));
    assert.deepEqual(manifest.permissions, ['scripting']);
    assert.deepEqual(manifest.host_permissions, ['https://mail.google.com/*']);
    assert.equal(manifest.background.service_worker, undefined);
    for (const name of ['inboxsdk.js', 'pageWorld.js', 'inboxsdk.js.map', 'pageWorld.js.map']) {
      assert.deepEqual(await readFile(path.join(fixture, 'dist', name)), await readFile(path.join(source, 'node_modules/@inboxsdk/core', name)));
    }
    for (const name of ['COPYRIGHT.txt', 'LICENSE-MIT.txt', 'LICENSE-APACHE.txt']) {
      assert.deepEqual(await readFile(path.join(fixture, 'dist/third-party/inboxsdk', name)), await readFile(path.join(source, 'third-party/inboxsdk', name)));
    }
    for (const name of [...manifest.content_scripts[0].js, ...manifest.background.scripts, 'pageWorld.js']) {
      const checked = spawnSync(process.execPath, ['--check', path.join(fixture, 'dist', name)], { encoding: 'utf8' });
      assert.equal(checked.status, 0, checked.stderr);
    }
  } finally {
    // mkdtemp returned this exact task-owned directory under the OS temp directory.
    assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
    assert.ok(path.basename(temporary).startsWith('yubinbox-build-test-'));
    await rm(temporary, { recursive: true, force: true });
  }
});
