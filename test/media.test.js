import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadMediaSnapshot } from '../src/media.js';

async function temporaryDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'waczak-tv-media-'));
}

test('snapshots regular MP4 files in deterministic alphabetical order and reports failures', async (t) => {
  const mediaFolder = await temporaryDirectory();
  t.after(() => fs.rm(mediaFolder, { recursive: true, force: true }));
  await fs.writeFile(path.join(mediaFolder, 'b.MP4'), 'b');
  await fs.writeFile(path.join(mediaFolder, 'A.mp4'), 'a');
  await fs.writeFile(path.join(mediaFolder, 'broken.mp4'), 'broken');
  await fs.mkdir(path.join(mediaFolder, 'directory.mp4'));
  const unavailable = [];

  const items = await loadMediaSnapshot(mediaFolder, {
    probe: async (filePath) => {
      if (path.basename(filePath) === 'broken.mp4') throw new Error('no usable duration');
      return { duration: 12 };
    },
    onUnavailable: (filename, reason) => unavailable.push({ filename, reason }),
  });

  assert.deepEqual(items.map((item) => item.filename), ['A.mp4', 'b.MP4']);
  assert.deepEqual(unavailable, [{ filename: 'broken.mp4', reason: 'no usable duration' }]);
});

test('fails if no candidate has usable media', async (t) => {
  const mediaFolder = await temporaryDirectory();
  t.after(() => fs.rm(mediaFolder, { recursive: true, force: true }));
  await fs.writeFile(path.join(mediaFolder, 'invalid.mp4'), 'invalid');

  await assert.rejects(
    loadMediaSnapshot(mediaFolder, {
      probe: async () => {
        throw new Error('missing duration');
      },
    }),
    /No playable MP4 files/,
  );
});
