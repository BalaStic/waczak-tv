import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

async function temporaryDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'waczak-tv-config-'));
}

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
