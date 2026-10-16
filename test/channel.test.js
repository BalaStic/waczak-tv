import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Channel, restorePosition } from '../src/channel.js';
import { loadMediaSnapshot } from '../src/media.js';

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

  await fs.writeFile(checkpointPath, JSON.stringify({ filename: 'z.mp4', position: 1 }));
  assert.deepEqual(await restorePosition(items, checkpointPath), { index: 0, position: 0 });
});

test('starts at the first item when the checkpoint is missing and resumes without downtime', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const checkpointPath = path.join(directory, 'checkpoint.json');
  const items = [
    { id: '0', filename: 'a.mp4', path: '', duration: 10 },
    { id: '1', filename: 'b.mp4', path: '', duration: 20 },
  ];

  const firstRun = await restorePosition(items, checkpointPath);
  assert.deepEqual(firstRun, { index: 0, position: 0 });
  const firstChannel = new Channel(items, firstRun);
  assert.equal(firstChannel.state().item.filename, 'a.mp4');
  assert.ok(firstChannel.state().position < 0.2);

  await fs.writeFile(checkpointPath, JSON.stringify({ filename: 'b.mp4', position: 5 }));
  const restored = await restorePosition(items, checkpointPath);
  const restartedChannel = new Channel(items, restored);
  const state = restartedChannel.state();
  assert.equal(state.item.filename, 'b.mp4');
  assert.ok(state.position >= 5 && state.position < 5.2);
});

test('ignores malformed checkpoints and warns about the reason', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const checkpointPath = path.join(directory, 'checkpoint.json');
  const items = [{ id: '0', filename: 'a.mp4', path: '', duration: 10 }];
  const warnings = [];
  await fs.writeFile(checkpointPath, '{broken');

  assert.deepEqual(await restorePosition(items, checkpointPath, { warn: (message) => warnings.push(message) }), {
    index: 0,
    position: 0,
  });
  assert.equal(warnings.length, 1);
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

test('continues playback after a checkpoint failure and saves successfully on a later retry', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const mediaPath = path.join(directory, 'a.mp4');
  await fs.writeFile(mediaPath, 'media');
  const checkpointFolder = path.join(directory, 'state');
  await fs.writeFile(checkpointFolder, 'not a directory');
  const errors = [];
  const channel = new Channel(
    [{ id: '0', filename: 'a.mp4', path: mediaPath, duration: 10 }],
    {
      mediaFolder: directory,
      checkpointPath: path.join(checkpointFolder, 'checkpoint.json'),
      log: { error: (message) => errors.push(message) },
    },
  );

  await channel.writeCheckpoint();

  assert.equal(channel.state().status, 'playing');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Cannot write playback checkpoint/);

  await fs.unlink(checkpointFolder);
  await fs.mkdir(checkpointFolder);
  await channel.writeCheckpoint();

  const checkpoint = JSON.parse(
    await fs.readFile(path.join(checkpointFolder, 'checkpoint.json'), 'utf8'),
  );
  assert.equal(checkpoint.filename, 'a.mp4');
  assert.equal(errors.length, 1);
});

test('plays the alphabetical playlist by probed duration and wraps at its end', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const durations = { 'a.mp4': 2, 'b.mp4': 3, 'c.mp4': 4 };
  for (const filename of ['c.mp4', 'a.mp4', 'b.mp4']) {
    await fs.writeFile(path.join(directory, filename), filename);
  }

  const probe = async (filePath) => ({ duration: durations[path.basename(filePath)] });
  const items = await loadMediaSnapshot(directory, {
    probe,
  });
  const channel = new Channel(items, {
    mediaFolder: directory,
    probe,
    log: { error: assert.fail },
  });
  const start = channel.startedAtMs;

  assert.equal(channel.state(start).item.filename, 'a.mp4');
  await channel.tick(start + 1500);
  assert.equal(channel.state(start + 1500).item.filename, 'a.mp4');
  assert.equal(channel.state(start + 1500).position, 1.5);

  await channel.tick(start + 2000);
  assert.equal(channel.state(start + 2000).item.filename, 'b.mp4');
  assert.equal(channel.state(start + 2000).position, 0);

  await channel.tick(start + 5000);
  assert.equal(channel.state(start + 5000).item.filename, 'c.mp4');
  assert.equal(channel.state(start + 5000).position, 0);

  await channel.tick(start + 9000);
  assert.equal(channel.state(start + 9000).item.filename, 'a.mp4');
  assert.equal(channel.state(start + 9000).position, 0);
  await channel.tick(start + 11000);
  assert.equal(channel.state(start + 11000).item.filename, 'b.mp4');
  assert.equal(channel.state(start + 11000).position, 0);
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

test('checks later candidates when the scheduled file becomes unavailable', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const items = [
    { id: '0', filename: 'a.mp4', path: path.join(directory, 'a.mp4'), duration: 30 },
    { id: '1', filename: 'b.mp4', path: path.join(directory, 'b.mp4'), duration: 30 },
    { id: '2', filename: 'c.mp4', path: path.join(directory, 'c.mp4'), duration: 30 },
  ];
  await fs.writeFile(items[1].path, 'broken');
  await fs.writeFile(items[2].path, 'playable');
  const errors = [];
  const channel = new Channel(items, {
    mediaFolder: directory,
    probe: async (filePath) => {
      if (path.basename(filePath) === 'b.mp4') throw new Error('invalid media');
      return { duration: 30 };
    },
    log: { error: (message) => errors.push(message) },
  });
  const now = channel.startedAtMs + 500;

  await channel.tick(now);

  assert.equal(channel.state(now).status, 'playing');
  assert.equal(channel.state(now).item.filename, 'c.mp4');
  assert.deepEqual(channel.items.map((item) => item.filename), ['c.mp4']);
  assert.ok(errors.some((message) => message.includes('a.mp4')));
  assert.ok(errors.some((message) => message.includes('b.mp4: invalid media')));
});

test('wraps through remaining candidates once and stops when they are unusable', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const items = [];
  for (const [index, filename] of ['a.mp4', 'b.mp4', 'c.mp4'].entries()) {
    const filePath = path.join(directory, filename);
    if (filename !== 'b.mp4') await fs.writeFile(filePath, 'broken');
    items.push({ id: String(index), filename, path: filePath, duration: 1 });
  }
  const probeCalls = [];
  const errors = [];
  const channel = new Channel(items, {
    mediaFolder: directory,
    index: 1,
    probe: async (filePath) => {
      probeCalls.push(path.basename(filePath));
      throw new Error('invalid media');
    },
    log: { error: (message) => errors.push(message) },
  });
  const now = channel.startedAtMs + 500;

  await channel.tick(now);

  assert.deepEqual(probeCalls, ['c.mp4', 'a.mp4']);
  assert.equal(channel.state(now).status, 'stopped');
  assert.equal(channel.state(now).item, null);
  assert.match(channel.state(now).error, /No playable media remains/);
  assert.ok(errors.some((message) => message.includes('b.mp4')));
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
