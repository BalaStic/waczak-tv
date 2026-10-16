import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const appSource = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');

class FakeElement {
  constructor() {
    this.hidden = false;
    this.textContent = '';
    this.listeners = new Map();
  }

  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ listener, once: options.once === true });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((entry) => entry.listener !== listener));
  }

  async dispatch(type, event = {}) {
    for (const entry of [...(this.listeners.get(type) || [])]) {
      if (entry.once) this.removeEventListener(type, entry.listener);
      await entry.listener(event);
    }
  }
}

class FakeVideo extends FakeElement {
  constructor() {
    super();
    this.defaultMuted = false;
    this.muted = false;
    this.volume = 1;
    this.paused = true;
    this.readyState = 0;
    this.error = null;
    this.seeking = false;
    this.playCalls = 0;
    this.seekLog = [];
    this._currentTime = 0;
    this.playBehavior = async () => {};
  }

  get currentTime() {
    return this._currentTime;
  }

  set currentTime(value) {
    this.seekLog.push(value);
    this._currentTime = value;
  }

  load() {
    this.readyState = 0;
    this.error = null;
    this.paused = true;
    this._currentTime = 0;
  }

  pause() {
    this.paused = true;
  }

  async play() {
    this.playCalls += 1;
    await this.playBehavior();
    this.paused = false;
  }
}

function playingState({ id = '42', filename = 'episode.mp4', position = 10, serverTimeMs }) {
  return {
    status: 'playing',
    item: { id, filename, duration: 60 },
    position,
    serverTimeMs,
    error: null,
  };
}

async function createViewer(initialState, initialTime = 10000) {
  const elements = new Map([
    ['#video', new FakeVideo()],
    ['#channel-status', new FakeElement()],
    ['#filename', new FakeElement()],
    ['#start-button', new FakeElement()],
    ['#error-message', new FakeElement()],
    ['#video-message', new FakeElement()],
    ['#volume-button', new FakeElement()],
    ['#volume-slider', new FakeElement()],
  ]);
  const responses = [];
  const requests = [];
  const intervals = [];
  const documentListeners = new Map();
  let now = initialTime;
  const document = {
    hidden: false,
    querySelector: (selector) => elements.get(selector),
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
  };
  const window = {
    setInterval(callback, delay) {
      intervals.push({ callback, delay });
      return intervals.length;
    },
  };
  const fetch = (...args) => {
    requests.push(args);
    const response = responses.shift();
    if (!response) throw new Error('No response was queued for this state request.');
    return response();
  };
  class ViewerDate extends Date {
    static now() {
      return now;
    }
  }
  const context = vm.createContext({
    document,
    window,
    fetch,
    Date: ViewerDate,
    HTMLMediaElement: { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 },
  });

  function queueState(state) {
    responses.push(() => Promise.resolve({ ok: true, json: async () => state }));
  }

  function queueFailure(error) {
    responses.push(() => Promise.reject(error));
  }

  function queuePending() {
    let resolveResponse;
    responses.push(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    );
    return (response) => resolveResponse(response);
  }

  async function settleInitialPoll() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  queueState(initialState);
  vm.runInContext(appSource, context);
  await settleInitialPoll();

  return {
    elements,
    video: elements.get('#video'),
    intervals,
    requests,
    queueState,
    queueFailure,
    queuePending,
    setNow(value) {
      now = value;
    },
    async poll() {
      await intervals[0].callback();
    },
  };
}

test('late viewers wait for metadata, seek to the server position, and play muted', async () => {
  const viewer = await createViewer(playingState({ serverTimeMs: 9000 }));
  assert.equal(viewer.intervals[0].delay, 2000);
  assert.equal(viewer.video.src, '/media/42');
  assert.equal(viewer.video.playCalls, 0);
  assert.equal(viewer.video.muted, true);
  assert.equal(viewer.video.defaultMuted, true);

  viewer.video.readyState = 1;
  await viewer.video.dispatch('loadedmetadata');
  assert.deepEqual(viewer.video.seekLog, [11]);
  assert.equal(viewer.video.playCalls, 1);
  assert.equal(viewer.video.paused, false);
  assert.equal(viewer.elements.get('#channel-status').textContent, 'On air');
});

test('viewers can unmute and adjust volume independently', async () => {
  const viewer = await createViewer(playingState({ serverTimeMs: 10000 }));
  const volumeButton = viewer.elements.get('#volume-button');
  const volumeSlider = viewer.elements.get('#volume-slider');
  assert.equal(volumeButton.textContent, 'Unmute');
  assert.equal(volumeSlider.value, '1');

  await volumeButton.dispatch('click');
  assert.equal(viewer.video.muted, false);
  assert.equal(volumeButton.textContent, 'Mute');

  volumeSlider.value = '0.4';
  await volumeSlider.dispatch('input');
  assert.equal(viewer.video.volume, 0.4);
  assert.equal(viewer.video.muted, false);

  volumeSlider.value = '0';
  await volumeSlider.dispatch('input');
  assert.equal(viewer.video.muted, true);
  assert.equal(volumeButton.textContent, 'Unmute');
});

test('drift at the tolerance is ignored and larger drift is corrected on the next poll', async () => {
  const viewer = await createViewer(playingState({ serverTimeMs: 10000 }));
  viewer.video.readyState = 1;
  await viewer.video.dispatch('loadedmetadata');
  viewer.video._currentTime = 8.5;

  viewer.queueState(playingState({ serverTimeMs: 10000 }));
  await viewer.poll();
  assert.deepEqual(viewer.video.seekLog, [10]);

  viewer.video._currentTime = 8.49;
  viewer.queueState(playingState({ serverTimeMs: 10000 }));
  await viewer.poll();
  assert.deepEqual(viewer.video.seekLog, [10, 10]);
});

test('state polling never overlaps requests', async () => {
  const viewer = await createViewer(playingState({ serverTimeMs: 10000 }));
  const resolveResponse = viewer.queuePending();
  const firstPoll = viewer.intervals[0].callback();
  const overlappingPoll = viewer.intervals[0].callback();
  assert.equal(viewer.requests.length, 2);

  resolveResponse({ ok: true, json: async () => playingState({ serverTimeMs: 10000 }) });
  await Promise.all([firstPoll, overlappingPoll]);
  assert.equal(viewer.requests.length, 2);
});

test('a late metadata event from a replaced item cannot start stale playback', async () => {
  const viewer = await createViewer(playingState({ serverTimeMs: 10000 }));
  viewer.queueState(
    playingState({ id: '43', filename: 'next.mp4', position: 5, serverTimeMs: 10000 }),
  );
  await viewer.poll();

  viewer.video.readyState = 1;
  await viewer.video.dispatch('loadedmetadata');
  assert.deepEqual(viewer.video.seekLog, [5]);
  assert.equal(viewer.video.playCalls, 1);
  assert.equal(viewer.video.src, '/media/43');
});

test('a failed state poll retries and reconciles the latest item after reconnecting', async () => {
  const viewer = await createViewer(playingState({ serverTimeMs: 10000 }));
  viewer.video.readyState = 1;
  await viewer.video.dispatch('loadedmetadata');

  viewer.setNow(30000);
  viewer.queueFailure(new Error('offline'));
  await viewer.poll();
  assert.equal(viewer.elements.get('#channel-status').textContent, 'Reconnecting…');
  assert.match(viewer.elements.get('#error-message').textContent, /offline/);
  assert.equal(viewer.video.src, '/media/42');

  viewer.queueState(
    playingState({ id: '43', filename: 'next.mp4', position: 5, serverTimeMs: 30000 }),
  );
  await viewer.poll();
  assert.equal(viewer.video.src, '/media/43');
  assert.equal(viewer.elements.get('#filename').textContent, 'next.mp4');
  assert.equal(viewer.elements.get('#error-message').hidden, true);

  viewer.video.readyState = 1;
  await viewer.video.dispatch('loadedmetadata');
  assert.deepEqual(viewer.video.seekLog, [10, 5]);
});

test('an autoplay rejection offers a user gesture and a media error stays local to the viewer', async () => {
  const viewer = await createViewer(playingState({ serverTimeMs: 10000 }));
  viewer.video.readyState = 1;
  viewer.video.playBehavior = async () => {
    throw Object.assign(new Error('autoplay denied'), { name: 'NotAllowedError' });
  };
  await viewer.video.dispatch('loadedmetadata');
  assert.equal(viewer.elements.get('#start-button').hidden, false);
  assert.match(viewer.elements.get('#video-message').textContent, /Start playback/);

  viewer.video.playBehavior = async () => {};
  await viewer.elements.get('#start-button').dispatch('click');
  assert.equal(viewer.elements.get('#start-button').hidden, true);
  assert.equal(viewer.video.paused, false);
  assert.equal(viewer.video.muted, true);

  viewer.video.error = { code: 3 };
  await viewer.video.dispatch('error');
  const errorMessage = viewer.elements.get('#error-message').textContent;
  assert.match(errorMessage, /could not decode/);
  viewer.queueState(playingState({ serverTimeMs: 10000 }));
  await viewer.poll();
  assert.equal(viewer.video.src, '/media/42');
  assert.equal(viewer.elements.get('#error-message').textContent, errorMessage);
  assert.equal(viewer.elements.get('#channel-status').textContent, 'Playback issue');
});
