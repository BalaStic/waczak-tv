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
video.defaultMuted = true;
video.muted = true;
let currentItemId = null;
let lastState = null;
let pendingPlay = false;
let loadGeneration = 0;
let metadataHandler = null;
let pollInProgress = null;
let connectionError = null;
let playbackError = null;
let playbackNotice = null;

function renderMessages() {
  const visibleError = playbackError || connectionError;
  errorElement.textContent = visibleError || '';
  errorElement.hidden = !visibleError;

  const message = visibleError || playbackNotice;
  videoMessage.textContent = message || '';
  videoMessage.hidden = !message;
}

function updateVolumeControls() {
  volumeButton.textContent = video.muted ? 'Unmute' : 'Mute';
  volumeSlider.value = String(video.volume);
}

function showPlaybackError(message) {
  playbackError = message;
  playbackNotice = null;
  renderMessages();
  statusElement.textContent = 'Playback issue';
}

function isCurrentLoad(itemId, generation) {
  return currentItemId === itemId && loadGeneration === generation;
}

function removeMetadataHandler() {
  if (!metadataHandler) return;
  video.removeEventListener('loadedmetadata', metadataHandler);
  metadataHandler = null;
}

function targetPosition(state) {
  const elapsed = Math.max(0, (Date.now() - state.serverTimeMs) / 1000);
  return Math.min(state.position + elapsed, Math.max(0, state.item.duration - 0.05));
}

async function startVideo(itemId, generation) {
  try {
    await video.play();
    if (!isCurrentLoad(itemId, generation)) return;
    pendingPlay = false;
    startButton.hidden = true;
    playbackError = null;
    playbackNotice = null;
    renderMessages();
    statusElement.textContent = connectionError ? 'Reconnecting…' : 'On air';
  } catch (error) {
    if (!isCurrentLoad(itemId, generation)) return;
    if (error?.name !== 'NotAllowedError') {
      showPlaybackError(`Could not start playback: ${error?.message || 'Unknown playback error.'}`);
      return;
    }
    pendingPlay = true;
    startButton.hidden = false;
    statusElement.textContent = 'Playback needs permission';
    playbackNotice = 'Your browser blocked autoplay. Select “Start playback” to watch.';
    renderMessages();
  }
}

async function applyState(state) {
  lastState = state;
  connectionError = null;
  if (state.status !== 'playing' || !state.item) {
    filenameElement.textContent = 'No item is currently playing';
    startButton.hidden = true;
    removeMetadataHandler();
    loadGeneration += 1;
    currentItemId = null;
    pendingPlay = false;
    playbackNotice = null;
    video.pause();
    showPlaybackError(state.error || 'The channel stopped.');
    statusElement.textContent = 'Channel stopped';
    return;
  }

  const changed = currentItemId !== state.item.id;
  filenameElement.textContent = state.item.filename;
  if (!changed) renderMessages();

  if (changed) {
    removeMetadataHandler();
    currentItemId = state.item.id;
    loadGeneration += 1;
    const generation = loadGeneration;
    const itemId = currentItemId;
    pendingPlay = true;
    playbackError = null;
    playbackNotice = 'Loading channel…';
    startButton.hidden = true;
    renderMessages();
    metadataHandler = async () => {
      if (!isCurrentLoad(itemId, generation)) return;
      removeMetadataHandler();
      if (!lastState || lastState.item?.id !== itemId) return;
      try {
        video.currentTime = targetPosition(lastState);
      } catch (error) {
        showPlaybackError(`Could not seek to the live channel position: ${error.message}`);
        return;
      }
      playbackNotice = null;
      await startVideo(itemId, generation);
    };
    video.addEventListener('loadedmetadata', metadataHandler);
    video.src = `/media/${encodeURIComponent(state.item.id)}`;
    video.load();
    return;
  }

  statusElement.textContent = playbackError
    ? 'Playback issue'
    : pendingPlay && !startButton.hidden
      ? 'Playback needs permission'
      : 'On air';
  if (!playbackError && !video.error && video.readyState >= HTMLMediaElement.HAVE_METADATA && !video.seeking) {
    const target = targetPosition(state);
    const drift = target - video.currentTime;
    if (Math.abs(drift) > driftToleranceSeconds) {
      try {
        video.currentTime = target;
        if (video.paused && !pendingPlay) await startVideo(currentItemId, loadGeneration);
      } catch (error) {
        showPlaybackError(`Could not resynchronize playback: ${error.message}`);
      }
    }
  }
}

async function pollState() {
  if (pollInProgress) return pollInProgress;
  pollInProgress = (async () => {
    try {
      let state;
      try {
        const response = await fetch('/api/state', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Channel status request failed (${response.status}).`);
        state = await response.json();
      } catch (error) {
        connectionError = `Cannot reach the local channel: ${error.message}`;
        renderMessages();
        statusElement.textContent = playbackError ? 'Playback issue' : 'Reconnecting…';
        return;
      }

      try {
        await applyState(state);
      } catch (error) {
        showPlaybackError(`Could not apply channel state: ${error.message}`);
      }
    } finally {
      pollInProgress = null;
    }
  })();
  return pollInProgress;
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
  playbackNotice = 'Buffering…';
  renderMessages();
});

video.addEventListener('playing', () => {
  if (!pendingPlay) {
    playbackNotice = null;
    playbackError = null;
    renderMessages();
    statusElement.textContent = connectionError ? 'Reconnecting…' : 'On air';
  }
});

video.addEventListener('ended', () => {
  pollState();
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
  if (lastState?.item && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    try {
      video.currentTime = targetPosition(lastState);
    } catch (error) {
      showPlaybackError(`Could not seek to the live channel position: ${error.message}`);
      return;
    }
  }
  await startVideo(currentItemId, loadGeneration);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pollState();
});

pollState();
window.setInterval(pollState, statePollMs);
