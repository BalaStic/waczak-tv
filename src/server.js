import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { readSafeMediaFile } from './media.js';

const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

export function parseRange(header, size) {
  if (!header || !header.startsWith('bytes=')) return null;
  if (header.includes(',')) return { invalid: true };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (suffixLength <= 0 || size === 0) return { invalid: true };
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      return { invalid: true };
    }
    end = Math.min(end, size - 1);
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || size === 0) {
    return { invalid: true };
  }
  return { start, end };
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function serveStatic(request, response, pathname, publicFolder) {
  const entry = publicFiles.get(pathname);
  if (!entry || (request.method !== 'GET' && request.method !== 'HEAD')) return false;

  const filePath = path.join(publicFolder, entry[0]);
  let content;
  try {
    content = await fs.readFile(filePath);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`Application asset is unavailable: ${error.message}`);
    return true;
  }

  response.writeHead(200, {
    'Content-Type': entry[1],
    'Content-Length': content.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(request.method === 'HEAD' ? undefined : content);
  return true;
}

async function serveMedia(request, response, channel, mediaFolder, id) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  const item = channel.items.find((candidate) => candidate.id === id);
  if (!item) {
    response.writeHead(404);
    response.end();
    return;
  }

  let file;
  try {
    file = await readSafeMediaFile(item, mediaFolder);
  } catch (error) {
    await channel.markUnavailable?.(item.id, error.message);
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error.message);
    return;
  }

  const range = parseRange(request.headers.range, file.size);
  if (range?.invalid) {
    await file.handle.close();
    response.writeHead(416, {
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${file.size}`,
    });
    response.end();
    return;
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? file.size - 1;
  const headers = {
    'Accept-Ranges': 'bytes',
    'Content-Type': 'video/mp4',
    'Content-Length': range ? end - start + 1 : file.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`;

  response.writeHead(range ? 206 : 200, headers);
  if (request.method === 'HEAD' || file.size === 0) {
    await file.handle.close();
    response.end();
    return;
  }

  try {
    await pipeline(file.handle.createReadStream({ start, end, autoClose: true }), response);
  } catch (error) {
    if (!response.destroyed) {
      response.destroy(error);
    }
  }
}

async function handleRequest(request, response, options) {
  const { routes, multiFolder, publicFolder } = options;
  let pathname;
  try {
    pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }

  const route = routes.find(
    (candidate) =>
      candidate.basePath &&
      (pathname === candidate.basePath || pathname.startsWith(`${candidate.basePath}/`)),
  ) || (!multiFolder ? routes[0] : null);
  const routePath = route?.basePath ? pathname.slice(route.basePath.length) || '/' : pathname;

  if (route && routePath === '/api/state' && request.method === 'GET') {
    await route.channel.tick();
    sendJson(response, 200, route.channel.state());
    return;
  }

  const mediaMatch = route && /^\/media\/([0-9]+)$/.exec(routePath);
  if (mediaMatch) {
    await serveMedia(request, response, route.channel, route.mediaFolder, mediaMatch[1]);
    return;
  }

  if (route && (routePath === '/' || routePath === '') && await serveStatic(request, response, '/', publicFolder)) {
    return;
  }

  if (
    multiFolder &&
    pathname === '/' &&
    (request.method === 'GET' || request.method === 'HEAD')
  ) {
    response.writeHead(200, { 'Content-Length': 0 });
    response.end();
    return;
  }

  if (await serveStatic(request, response, pathname, publicFolder)) return;

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}

export function createHttpServer(options) {
  const routes = options.channels
    ? options.channels.map((entry) => ({
        ...entry,
        basePath: entry.urlPath ? `/${entry.urlPath}` : '',
      }))
    : [
        {
          channel: options.channel,
          mediaFolder: options.mediaFolder,
          basePath: '',
        },
      ];
  const multiFolder = routes.some((route) => route.basePath !== '');
  const serverOptions = { ...options, routes, multiFolder };

  return http.createServer((request, response) => {
    handleRequest(request, response, serverOptions).catch((error) => {
      (options.log || console).error(
        `Request failed (${request.method} ${request.url}): ${error.message}`,
      );
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Request failed. Check the server console for details.');
    });
  });
}
