import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { getConfigPath, loadConfig } from '../src/config.js';

async function temporaryDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'waczak-tv-config-'));
}

test('uses config.json in the application root unless overridden', () => {
  const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  assert.equal(getConfigPath({}), path.join(applicationRoot, 'config.json'));

  const override = path.join('custom', 'config.json');
  assert.equal(getConfigPath({ WACZAK_TV_CONFIG: override }), path.resolve(override));
});

test('loads a relative media folder from a valid config', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const mediaFolder = path.join(directory, 'videos');
  await fs.mkdir(mediaFolder);
  const configPath = path.join(directory, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({ mediaFolder: 'videos' }));

  const config = await loadConfig(configPath);
  assert.equal(config.mediaFolder, await fs.realpath(mediaFolder));
});

test('loads multiple media folders with unique URL paths', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const firstFolder = path.join(directory, 'first');
  const secondFolder = path.join(directory, 'second');
  await fs.mkdir(firstFolder);
  await fs.mkdir(secondFolder);
  const configPath = path.join(directory, 'config.json');
  await fs.writeFile(
    configPath,
    JSON.stringify({
      mediaFolders: [
        { mediaFolder: 'first', urlPath: 'waczak-tv' },
        { mediaFolder: 'second', urlPath: 'other-channel' },
      ],
    }),
  );

  const config = await loadConfig(configPath);
  assert.deepEqual(config.mediaFolders, [
    { mediaFolder: await fs.realpath(firstFolder), urlPath: 'waczak-tv' },
    { mediaFolder: await fs.realpath(secondFolder), urlPath: 'other-channel' },
  ]);
});

test('rejects empty, unsafe, and duplicate media folder URL paths', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'videos'));
  const configPath = path.join(directory, 'config.json');
  for (const mediaFolders of [
    [{ mediaFolder: 'videos', urlPath: '' }],
    [{ mediaFolder: 'videos', urlPath: '../escape' }],
    [
      { mediaFolder: 'videos', urlPath: 'Channel' },
      { mediaFolder: 'videos', urlPath: 'channel' },
    ],
  ]) {
    await fs.writeFile(configPath, JSON.stringify({ mediaFolders }));
    await assert.rejects(loadConfig(configPath), /urlPath/);
  }
});

test('reports missing, malformed, and unusable configuration', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'config.json');

  await assert.rejects(loadConfig(configPath), /Configuration file not found/);
  await fs.writeFile(configPath, '{bad json');
  await assert.rejects(loadConfig(configPath), /not valid JSON/);
  await fs.writeFile(configPath, JSON.stringify({ mediaFolder: 'missing-folder' }));
  await assert.rejects(loadConfig(configPath), /Configured media folder cannot be used/);
});
