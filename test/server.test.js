import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Channel } from '../src/channel.js';
import { createHttpServer, parseRange } from '../src/server.js';

async function temporaryDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'waczak-tv-'));
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

test('parses normal, open-ended, and suffix byte ranges', () => {
  assert.deepEqual(parseRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseRange('bytes=7-', 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange('bytes=-4', 10), { start: 6, end: 9 });
  assert.deepEqual(parseRange('bytes=12-20', 10), { invalid: true });
});

test('serves MP4 byte ranges with exact response headers and blocks arbitrary paths', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const publicFolder = path.join(directory, 'public');
  await fs.mkdir(publicFolder);
  await fs.writeFile(path.join(publicFolder, 'index.html'), '<h1>channel</h1>');
  const mediaPath = path.join(directory, 'episode.mp4');
  const bytes = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
  await fs.writeFile(mediaPath, bytes);

  const item = { id: '0', filename: 'episode.mp4', path: mediaPath, duration: 30 };
  const channel = new Channel([item], {
    mediaFolder: directory,
    probe: async () => ({ duration: 30 }),
    log: { error: assert.fail },
  });
  const server = createHttpServer({ channel, mediaFolder: directory, publicFolder });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(address.address, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;

  const rangeResponse = await request(`${origin}/media/0`, {
    headers: { Range: 'bytes=4-9' },
  });
  assert.equal(rangeResponse.status, 206);
  assert.equal(rangeResponse.headers['content-range'], `bytes 4-9/${bytes.length}`);
  assert.equal(rangeResponse.headers['content-length'], '6');
  assert.equal(rangeResponse.headers['accept-ranges'], 'bytes');
  assert.deepEqual(rangeResponse.body, bytes.subarray(4, 10));

  const outsideResponse = await request(`${origin}/media/..%2F..%2Fpackage.json`);
  assert.equal(outsideResponse.status, 404);

  const invalidRange = await request(`${origin}/media/0`, {
    headers: { Range: `bytes=${bytes.length}-` },
  });
  assert.equal(invalidRange.status, 416);
  assert.equal(invalidRange.headers['content-range'], `bytes */${bytes.length}`);
});

test('uses the server state endpoint as the playback authority', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const publicFolder = path.join(directory, 'public');
  await fs.mkdir(publicFolder);
  const mediaPath = path.join(directory, 'episode.mp4');
  await fs.writeFile(mediaPath, 'media');
  const channel = new Channel(
    [{ id: '0', filename: 'episode.mp4', path: mediaPath, duration: 30 }],
    { mediaFolder: directory, position: 5, log: { error: assert.fail } },
  );
  const server = createHttpServer({ channel, mediaFolder: directory, publicFolder });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  assert.equal(server.address().address, '127.0.0.1');

  const response = await request(`http://127.0.0.1:${server.address().port}/api/state`);
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  const state = JSON.parse(response.body);
  assert.equal(state.status, 'playing');
  assert.equal(state.item.filename, 'episode.mp4');
  assert.ok(Number.isFinite(state.serverTimeMs));
  assert.ok(state.position >= 5);

  await new Promise((resolve) => setTimeout(resolve, 25));
  const secondResponse = await request(`http://127.0.0.1:${server.address().port}/api/state`);
  const secondState = JSON.parse(secondResponse.body);
  assert.equal(secondState.item.filename, 'episode.mp4');
  assert.ok(secondState.position > state.position);
});

test('recovers when the media route detects a missing scheduled file', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const items = [];
  for (const [index, filename] of ['a.mp4', 'b.mp4', 'c.mp4'].entries()) {
    const filePath = path.join(directory, filename);
    if (filename !== 'a.mp4') await fs.writeFile(filePath, filename);
    items.push({ id: String(index), filename, path: filePath, duration: 30 });
  }
  const errors = [];
  const channel = new Channel(items, {
    mediaFolder: directory,
    probe: async (filePath) => {
      if (path.basename(filePath) === 'b.mp4') throw new Error('invalid media');
      return { duration: 30 };
    },
    log: { error: (message) => errors.push(message) },
  });
  const server = createHttpServer({
    channel,
    mediaFolder: directory,
    publicFolder: directory,
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const missingMedia = await request(`http://127.0.0.1:${server.address().port}/media/0`);
  assert.equal(missingMedia.status, 404);

  const stateResponse = await request(`http://127.0.0.1:${server.address().port}/api/state`);
  const state = JSON.parse(stateResponse.body);
  assert.equal(state.status, 'playing');
  assert.equal(state.item.filename, 'c.mp4');
  assert.ok(errors.some((message) => message.includes('a.mp4')));
  assert.ok(errors.some((message) => message.includes('b.mp4: invalid media')));
});

test('logs request failures and returns an explicit server error', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const publicFolder = path.join(directory, 'public');
  await fs.mkdir(publicFolder);
  const errors = [];
  const server = createHttpServer({
    channel: { tick: async () => { throw new Error('clock failure'); } },
    mediaFolder: directory,
    publicFolder,
    log: { error: (message) => errors.push(message) },
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const response = await request(`http://127.0.0.1:${server.address().port}/api/state`);
  assert.equal(response.status, 500);
  assert.match(response.body.toString(), /Check the server console/);
  assert.ok(errors.some((message) => message.includes('clock failure')));
});
