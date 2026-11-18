import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export class StartupError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'StartupError';
  }
}

export function getConfigPath(env = process.env) {
  if (env.WACZAK_TV_CONFIG) {
    return path.resolve(env.WACZAK_TV_CONFIG);
  }

  return path.join(applicationRoot, 'config.json');
}

export async function loadConfig(configPath = getConfigPath()) {
  let raw;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new StartupError(
        `Configuration file not found: ${configPath}\nCreate it as JSON with a "mediaFolder" path. See config.example.json.`,
        { cause: error },
      );
    }
    throw new StartupError(`Cannot read configuration file ${configPath}: ${error.message}`, {
      cause: error,
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new StartupError(
      `Configuration file is not valid JSON: ${configPath}. Correct its syntax and try again.`,
      { cause: error },
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StartupError(
      `Configuration file ${configPath} must contain a "mediaFolder" string or a non-empty "mediaFolders" array.`,
    );
  }

  const isLegacyConfig = parsed.mediaFolders === undefined;
  if (isLegacyConfig && (typeof parsed.mediaFolder !== 'string' || parsed.mediaFolder.trim() === '')) {
    throw new StartupError(
      `Configuration file ${configPath} must contain a non-empty string property named "mediaFolder" or a non-empty "mediaFolders" array.`,
    );
  }

  if (!isLegacyConfig && parsed.mediaFolder !== undefined) {
    throw new StartupError(
      `Configuration file ${configPath} cannot contain both "mediaFolder" and "mediaFolders".`,
    );
  }

  const entries = isLegacyConfig
    ? [{ mediaFolder: parsed.mediaFolder, urlPath: '' }]
    : parsed.mediaFolders;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new StartupError(
      `Configuration file ${configPath} must contain a non-empty "mediaFolders" array.`,
    );
  }

  const usedPaths = new Set();
  const mediaFolders = [];
  for (const [index, entry] of entries.entries()) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof entry.mediaFolder !== 'string' ||
      entry.mediaFolder.trim() === ''
    ) {
      throw new StartupError(
        `Configuration file ${configPath} mediaFolders[${index}] must contain a non-empty string property named "mediaFolder".`,
      );
    }

    if (
      typeof entry.urlPath !== 'string' ||
      (isLegacyConfig
        ? entry.urlPath !== ''
        : !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(entry.urlPath))
    ) {
      throw new StartupError(
        `Configuration file ${configPath} mediaFolders[${index}] must contain a "urlPath" made of letters, numbers, hyphens, or underscores.`,
      );
    }

    const normalizedPath = entry.urlPath.toLowerCase();
    if (usedPaths.has(normalizedPath)) {
      throw new StartupError(
        `Configuration file ${configPath} contains a duplicate urlPath: ${entry.urlPath}.`,
      );
    }
    usedPaths.add(normalizedPath);

    const mediaFolder = path.resolve(path.dirname(configPath), entry.mediaFolder.trim());
    let canonicalFolder;
    try {
      canonicalFolder = await fs.realpath(mediaFolder);
      const folderStat = await fs.stat(canonicalFolder);
      if (!folderStat.isDirectory()) {
        throw new Error('the configured path is not a directory');
      }
      await fs.readdir(canonicalFolder);
    } catch (error) {
      throw new StartupError(
        `Configured media folder cannot be used: ${mediaFolder} (${error.message}). Check that it exists and that you have read permission.`,
        { cause: error },
      );
    }

    mediaFolders.push({ mediaFolder: canonicalFolder, urlPath: entry.urlPath });
  }

  return {
    configPath,
    mediaFolders,
    ...(isLegacyConfig ? { mediaFolder: mediaFolders[0].mediaFolder } : {}),
    dataFolder: path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'waczak-tv',
    ),
  };
}
