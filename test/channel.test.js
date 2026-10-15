import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Channel, restorePosition } from '../src/channel.js';

async function temporaryDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'waczak-tv-'));
}

test('restores valid checkpoints and falls forward for stale positions', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const checkpointPath = path.join(directory, 'checkpoint.json');
  const items = [
    { id: '0', filename: 'a.mp4', path: path.join(directory, 'a.mp4'), duration: 10 },
    { id: '1', filename: 'b.mp4', path: path.join(directory, 'b.mp4'), duration: 20 },
  ];

  await fs.writeFile(checkpointPath, JSON.stringify({ filename: 'b.mp4', position: 5 }));
  assert.deepEqual(await restorePosition(items, checkpointPath), { index: 1, position: 5 });

  await fs.writeFile(checkpointPath, JSON.stringify({ filename: 'a.mp4', position: 10 }));
  assert.deepEqual(await restorePosition(items, checkpointPath), { index: 1, position: 0 });

  await fs.writeFile(checkpointPath, JSON.stringify({ filename: 'a1.mp4', position: 1 }));
  assert.deepEqual(await restorePosition(items, checkpointPath), { index: 1, position: 0 });
});

test('ignores malformed checkpoints and logs the reason', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const checkpointPath = path.join(directory, 'checkpoint.json');
  const items = [{ id: '0', filename: 'a.mp4', path: '', duration: 10 }];
  const errors = [];
  await fs.writeFile(checkpointPath, '{broken');

  assert.deepEqual(await restorePosition(items, checkpointPath, { error: (message) => errors.push(message) }), {
    index: 0,
    position: 0,
  });
  assert.equal(errors.length, 1);
});

test('advances by the server clock and writes an atomic checkpoint', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const mediaPath = path.join(directory, 'a.mp4');
  await fs.writeFile(mediaPath, 'media');
  const checkpointPath = path.join(directory, 'checkpoint.json');
  const item = { id: '0', filename: 'a.mp4', path: mediaPath, duration: 5 };
  const channel = new Channel([item], {
    mediaFolder: directory,
    checkpointPath,
    probe: async () => ({ duration: 5 }),
    log: { error: assert.fail },
  });

  await channel.tick(channel.startedAtMs + 6000);
  assert.equal(channel.state(channel.startedAtMs + 6000).status, 'playing');
  assert.equal(channel.state(channel.startedAtMs + 6000).item.filename, 'a.mp4');
  const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
  assert.equal(checkpoint.filename, 'a.mp4');
  assert.ok(checkpoint.position >= 0 && checkpoint.position < 5);
});

test('skips a media file that becomes unusable and keeps the alphabetical schedule', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const items = [];
  for (const [index, filename] of ['a.mp4', 'b.mp4', 'c.mp4'].entries()) {
    const filePath = path.join(directory, filename);
    await fs.writeFile(filePath, filename);
    items.push({ id: String(index), filename, path: filePath, duration: 1 });
  }
  const errors = [];
  const channel = new Channel(items, {
    mediaFolder: directory,
    probe: async (filePath) => {
      if (path.basename(filePath) === 'b.mp4') throw new Error('invalid duration');
      return { duration: 1 };
    },
    log: { error: (message) => errors.push(message) },
  });
  const scheduleStart = channel.startedAtMs;

  await channel.tick(scheduleStart + 1500);
  assert.equal(channel.state(scheduleStart + 1500).item.filename, 'c.mp4');
  assert.equal(channel.state(scheduleStart + 1500).position, 0.5);
  assert.deepEqual(channel.items.map((item) => item.filename), ['a.mp4', 'c.mp4']);
  assert.match(errors[0], /b\.mp4: invalid duration/);

  await channel.tick(scheduleStart + 2500);
  assert.equal(channel.state(scheduleStart + 2500).item.filename, 'a.mp4');
  assert.equal(channel.state(scheduleStart + 2500).position, 0.5);
});

test('stops with an explicit error when the last file becomes unavailable', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'only.mp4');
  await fs.writeFile(filePath, 'media');
  const errors = [];
  const channel = new Channel(
    [{ id: '0', filename: 'only.mp4', path: filePath, duration: 10 }],
    { mediaFolder: directory, log: { error: (message) => errors.push(message) } },
  );

  await channel.markUnavailable('0', 'removed during playback');

  assert.equal(channel.state().status, 'stopped');
  assert.match(channel.state().error, /No playable media remains/);
  assert.ok(errors.some((message) => message.includes('removed during playback')));
});
