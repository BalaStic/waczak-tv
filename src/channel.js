import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { compareFilenames, probeMedia, readSafeMediaFile } from './media.js';

export class Channel {
  constructor(items, options = {}) {
    this.items = [...items];
    this.mediaFolder = options.mediaFolder;
    this.checkpointPath = options.checkpointPath;
    this.probe = options.probe || probeMedia;
    this.log = options.log || console;
    this.index = options.index || 0;
    this.startedAtMs = Date.now() - (options.position || 0) * 1000;
    this.status = 'playing';
    this.error = null;
    this.tickInProgress = null;
    this.checkpointWriteInProgress = null;
  }

  async tick(now = Date.now()) {
    if (this.tickInProgress) {
      await this.tickInProgress;
      return;
    }

    this.tickInProgress = this.update(now);
    try {
      await this.tickInProgress;
    } finally {
      this.tickInProgress = null;
    }
  }

  async update(now) {
    if (this.status !== 'playing') return;

    const current = this.items[this.index];
    let changed = false;
    try {
      const { handle } = await readSafeMediaFile(current, this.mediaFolder);
      await handle.close();
    } catch (error) {
      this.log.error(`Media unavailable: ${current.filename}: ${error.message}`);
      this.items.splice(this.index, 1);
      changed = true;
      if (this.items.length === 0) {
        this.stop(`No playable media remains. ${current.filename} is unavailable.`);
        return;
      }
      const candidates = [
        ...this.items.slice(this.index),
        ...this.items.slice(0, this.index),
      ];
      if (!(await this.#selectNextPlayable(candidates, now, current.filename))) return;
    }

    while (this.status === 'playing') {
      const item = this.items[this.index];
      const boundary = this.startedAtMs + item.duration * 1000;
      if (now < boundary) break;
      await this.advance(boundary);
      changed = true;
    }

    if (changed) await this.writeCheckpoint();
  }

  async advance(boundary) {
    const previousItem = this.items[this.index];
    const candidates = [
      ...this.items.slice(this.index + 1),
      ...this.items.slice(0, this.index + 1),
    ];
    await this.#selectNextPlayable(candidates, boundary, previousItem.filename);
  }

  async #selectNextPlayable(candidates, boundary, previousFilename) {
    for (const candidate of candidates) {
      const candidateIndex = this.items.indexOf(candidate);
      if (candidateIndex < 0) continue;

      try {
        const metadata = await checkItemIsUsable(candidate, this.mediaFolder, this.probe);
        candidate.duration = metadata.duration;
      } catch (error) {
        this.log.error(`Media unavailable: ${candidate.filename}: ${error.message}`);
        this.items.splice(candidateIndex, 1);
        if (this.items.length === 0) {
          this.stop(`No playable media remains. ${candidate.filename} is unavailable.`);
          return false;
        }
        continue;
      }

      this.index = this.items.indexOf(candidate);
      this.startedAtMs = boundary;
      return true;
    }

    this.stop(`No playable media remains after ${previousFilename}.`);
    return false;
  }

  async markUnavailable(id, reason) {
    if (this.tickInProgress) await this.tickInProgress;

    const unavailableIndex = this.items.findIndex((item) => item.id === id);
    if (unavailableIndex < 0) return;
    const [item] = this.items.splice(unavailableIndex, 1);
    this.log.error(`Media unavailable: ${item.filename}: ${reason}`);

    if (this.items.length === 0) {
      this.stop(`No playable media remains. ${item.filename} is unavailable.`);
      return;
    }

    if (unavailableIndex < this.index) {
      this.index -= 1;
      await this.tick();
    } else if (unavailableIndex === this.index) {
      this.index %= this.items.length;
      this.startedAtMs = Date.now();
      const candidates = [
        ...this.items.slice(this.index),
        ...this.items.slice(0, this.index),
      ];
      await this.#selectNextPlayable(candidates, this.startedAtMs, item.filename);
    } else {
      await this.tick();
    }
    await this.writeCheckpoint();
  }

  stop(message) {
    this.status = 'stopped';
    this.error = message;
    this.log.error(`Channel stopped: ${message}`);
  }

  state(now = Date.now()) {
    if (this.status !== 'playing' || this.items.length === 0) {
      return {
        status: 'stopped',
        item: null,
        position: 0,
        serverTimeMs: now,
        error: this.error || 'The channel has stopped.',
      };
    }

    const item = this.items[this.index];
    return {
      status: 'playing',
      item: { id: item.id, filename: item.filename, duration: item.duration },
      position: Math.max(0, (now - this.startedAtMs) / 1000),
      serverTimeMs: now,
      error: null,
    };
  }

  async writeCheckpoint() {
    if (!this.checkpointPath || this.items.length === 0) return;

    const write = (this.checkpointWriteInProgress || Promise.resolve()).then(() =>
      this.#writeCheckpoint(),
    );
    this.checkpointWriteInProgress = write;
    try {
      await write;
    } finally {
      if (this.checkpointWriteInProgress === write) {
        this.checkpointWriteInProgress = null;
      }
    }
  }

  async #writeCheckpoint() {
    if (!this.checkpointPath || this.items.length === 0) return;
    const state = this.state();
    if (!state.item) return;

    const temporaryPath = `${this.checkpointPath}.${process.pid}.${randomUUID()}.tmp`;
    const checkpoint = {
      filename: state.item.filename,
      position: Math.min(state.position, Math.max(state.item.duration - 0.05, 0)),
    };

    try {
      await fs.mkdir(path.dirname(this.checkpointPath), { recursive: true });
      await fs.writeFile(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
      await fs.rename(temporaryPath, this.checkpointPath);
    } catch (error) {
      this.log.error(`Cannot write playback checkpoint ${this.checkpointPath}: ${error.message}`);
      try {
        await fs.unlink(temporaryPath);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          this.log.error(`Cannot remove temporary checkpoint ${temporaryPath}: ${cleanupError.message}`);
        }
      }
    }
  }
}

export async function restorePosition(items, checkpointPath, log = console) {
  let checkpoint;
  try {
    const raw = await fs.readFile(checkpointPath, 'utf8');
    checkpoint = JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return { index: 0, position: 0 };
    log.warn(`Ignoring invalid playback checkpoint ${checkpointPath}: ${error.message}`);
    return { index: 0, position: 0 };
  }

  if (
    checkpoint === null ||
    typeof checkpoint !== 'object' ||
    Array.isArray(checkpoint) ||
    typeof checkpoint.filename !== 'string' ||
    checkpoint.filename.length === 0 ||
    checkpoint.filename !== path.basename(checkpoint.filename) ||
    checkpoint.filename.includes('/') ||
    checkpoint.filename.includes('\\') ||
    !Number.isFinite(checkpoint.position) ||
    checkpoint.position < 0
  ) {
    log.warn(`Ignoring invalid playback checkpoint ${checkpointPath}: expected a filename and non-negative position.`);
    return { index: 0, position: 0 };
  }

  const exactIndex = items.findIndex((item) => item.filename === checkpoint.filename);
  if (exactIndex >= 0 && checkpoint.position < items[exactIndex].duration) {
    return { index: exactIndex, position: checkpoint.position };
  }

  const nextIndex = items.findIndex(
    (item) => compareFilenames(item.filename, checkpoint.filename) > 0,
  );
  return { index: nextIndex >= 0 ? nextIndex : 0, position: 0 };
}

export async function checkItemIsUsable(item, mediaFolder, probe = probeMedia) {
  const { handle } = await readSafeMediaFile(item, mediaFolder);
  await handle.close();
  return probe(item.path);
}
