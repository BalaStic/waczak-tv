import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function compareFilenames(left, right) {
  const leftLower = left.toLowerCase();
  const rightLower = right.toLowerCase();
  if (leftLower < rightLower) return -1;
  if (leftLower > rightLower) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export async function probeMedia(filePath, ffprobePath = process.env.FFPROBE_PATH || 'ffprobe') {
  let result;
  try {
    result = await execFileAsync(
      ffprobePath,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,duration',
        '-of',
        'json',
        filePath,
      ],
      { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true },
    );
  } catch (error) {
    const reason =
      error.code === 'ENOENT'
        ? `ffprobe was not found (${ffprobePath}). Install FFmpeg or set FFPROBE_PATH.`
        : (error.stderr || error.message).trim();
    throw new Error(reason || 'ffprobe could not read the file');
  }

  let metadata;
  try {
    metadata = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`ffprobe returned invalid metadata: ${error.message}`);
  }

  if (!metadata.streams?.some((stream) => stream.codec_type === 'video')) {
    throw new Error('no video stream was found');
  }

  const formatDuration = Number(metadata.format?.duration);
  const videoDurations = metadata.streams
    .filter((stream) => stream.codec_type === 'video')
    .map((stream) => Number(stream.duration))
    .filter((duration) => Number.isFinite(duration) && duration > 0);
  const duration =
    Number.isFinite(formatDuration) && formatDuration > 0
      ? formatDuration
      : videoDurations.length > 0
        ? Math.max(...videoDurations)
        : 0;

  if (duration <= 0) {
    throw new Error('no usable media duration was found');
  }

  return { duration };
}

export async function readSafeMediaFile(item, mediaFolder) {
  let canonicalPath;
  try {
    canonicalPath = await fs.realpath(item.path);
    const root = path.resolve(mediaFolder);
    const parent = path.dirname(canonicalPath);
    const equalPath =
      process.platform === 'win32'
        ? parent.toLowerCase() === root.toLowerCase()
        : parent === root;
    if (!equalPath) {
      throw new Error('media path resolves outside the configured folder');
    }

    const handle = await fs.open(canonicalPath, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) {
      await handle.close();
      throw new Error('media path is not a regular file');
    }
    return { handle, size: stat.size };
  } catch (error) {
    throw new Error(`Media file is unavailable: ${error.message}`, { cause: error });
  }
}

export async function loadMediaSnapshot(mediaFolder, options = {}) {
  const probe = options.probe || probeMedia;
  let entries;
  try {
    entries = await fs.readdir(mediaFolder, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Cannot read media folder ${mediaFolder}: ${error.message}`, { cause: error });
  }

  const candidates = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.mp4')
    .map((entry) => entry.name)
    .sort(compareFilenames);

  if (candidates.length === 0) {
    throw new Error(`No MP4 files were found in ${mediaFolder}. Add MP4 files and restart.`);
  }

  const playable = [];
  for (const [index, filename] of candidates.entries()) {
    const filePath = path.join(mediaFolder, filename);
    try {
      const realPath = await fs.realpath(filePath);
      const parent = path.dirname(realPath);
      const sameFolder =
        process.platform === 'win32'
          ? parent.toLowerCase() === mediaFolder.toLowerCase()
          : parent === mediaFolder;
      if (!sameFolder) {
        throw new Error('file resolves outside the configured media folder');
      }
      const fileStat = await fs.stat(realPath);
      if (!fileStat.isFile()) {
        throw new Error('not a regular file');
      }
      const { duration } = await probe(realPath);
      playable.push({ id: String(index), filename, path: realPath, duration });
    } catch (error) {
      options.onUnavailable?.(filename, error.message);
    }
  }

  if (playable.length === 0) {
    throw new Error(
      `No playable MP4 files were found in ${mediaFolder}. Check the reported media errors and add a supported file.`,
    );
  }

  return playable;
}
