const video = document.querySelector('#video');
const statusElement = document.querySelector('#channel-status');
const filenameElement = document.querySelector('#filename');
const startButton = document.querySelector('#start-button');
const errorElement = document.querySelector('#error-message');
const videoMessage = document.querySelector('#video-message');
const volumeButton = document.querySelector('#volume-button');
const volumeSlider = document.querySelector('#volume-slider');

const statePollMs = 2000;
const driftToleranceSeconds = 1.5;
let currentItemId = null;
let lastState = null;
let pendingPlay = false;

function updateVolumeControls() {
  volumeButton.textContent = video.muted ? 'Unmute' : 'Mute';
  volumeSlider.value = String(video.volume);
}

function showPlaybackError(message) {
  errorElement.textContent = message;
  errorElement.hidden = false;
  statusElement.textContent = 'Playback issue';
  videoMessage.textContent = message;
  videoMessage.hidden = false;
}

function targetPosition(state) {
  const elapsed = Math.max(0, (Date.now() - state.serverTimeMs) / 1000);
  return Math.min(state.position + elapsed, Math.max(0, state.item.duration - 0.05));
}

async function startVideo() {
  try {
    await video.play();
    pendingPlay = false;
    startButton.hidden = true;
    videoMessage.hidden = true;
    errorElement.hidden = true;
    statusElement.textContent = 'On air';
  } catch (error) {
    pendingPlay = true;
    startButton.hidden = false;
    statusElement.textContent = 'Playback needs permission';
    videoMessage.textContent = 'Your browser blocked autoplay. Select “Start playback” to watch.';
    videoMessage.hidden = false;
  }
}

async function applyState(state) {
  lastState = state;
  if (state.status !== 'playing' || !state.item) {
    filenameElement.textContent = 'No item is currently playing';
    startButton.hidden = true;
    showPlaybackError(state.error || 'The channel stopped.');
    statusElement.textContent = 'Channel stopped';
    return;
  }

  errorElement.hidden = true;
  const changed = currentItemId !== state.item.id;
  filenameElement.textContent = state.item.filename;
  statusElement.textContent = video.error
    ? 'Playback issue'
    : pendingPlay && !startButton.hidden
      ? 'Playback needs permission'
      : 'On air';
  if (!video.error && !pendingPlay && !video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    videoMessage.hidden = true;
  }

  if (changed) {
    currentItemId = state.item.id;
    pendingPlay = true;
    videoMessage.textContent = 'Loading channel…';
    videoMessage.hidden = false;
    video.src = `/media/${encodeURIComponent(state.item.id)}`;
    video.load();
    video.addEventListener(
      'loadedmetadata',
      async () => {
        if (!lastState || lastState.item?.id !== currentItemId) return;
        try {
          video.currentTime = targetPosition(lastState);
        } catch (error) {
          showPlaybackError(`Could not seek to the live channel position: ${error.message}`);
          return;
        }
        await startVideo();
      },
      { once: true },
    );
    return;
  }

  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && !video.seeking) {
    const drift = targetPosition(state) - video.currentTime;
    if (Math.abs(drift) > driftToleranceSeconds) {
      try {
        video.currentTime = targetPosition(state);
        if (video.paused && !pendingPlay) await startVideo();
      } catch (error) {
        showPlaybackError(`Could not resynchronize playback: ${error.message}`);
      }
    }
  }
}

async function pollState() {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Channel status request failed (${response.status}).`);
    await applyState(await response.json());
  } catch (error) {
    showPlaybackError(`Cannot reach the local channel: ${error.message}`);
    statusElement.textContent = 'Reconnecting…';
  }
}

video.addEventListener('error', () => {
  const code = video.error?.code;
  const reasons = {
    2: 'A network error interrupted this video.',
    3: 'This browser could not decode this video. Check the file codec and Windows media components.',
    4: 'This browser cannot play this video format.',
  };
  showPlaybackError(reasons[code] || 'The video could not be played in this browser.');
});

video.addEventListener('waiting', () => {
  videoMessage.textContent = 'Buffering…';
  videoMessage.hidden = false;
});

video.addEventListener('playing', () => {
  if (!pendingPlay) {
    videoMessage.hidden = true;
    statusElement.textContent = 'On air';
  }
});

video.addEventListener('ended', () => {
  if (lastState) applyState(lastState);
});

volumeButton.addEventListener('click', () => {
  video.muted = !video.muted;
  updateVolumeControls();
});

volumeSlider.addEventListener('input', () => {
  video.volume = Number(volumeSlider.value);
  video.muted = video.volume === 0;
  updateVolumeControls();
});

video.addEventListener('volumechange', updateVolumeControls);
updateVolumeControls();

startButton.addEventListener('click', async () => {
  pendingPlay = false;
  if (lastState?.item && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    video.currentTime = targetPosition(lastState);
  }
  await startVideo();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pollState();
});

pollState();
window.setInterval(pollState, statePollMs);
