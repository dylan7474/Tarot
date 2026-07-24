const http = require('node:http');
const https = require('node:https');
const { promises: fs } = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8000);
const ROOT = __dirname;
const DATA_DIR = process.env.TAROT_DATA_DIR || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'server-state.json');
const ASSET_CACHE_DIR = process.env.TAROT_ASSET_CACHE_DIR || path.join(DATA_DIR, 'assets');
const ASSET_CARDS_DIR = path.join(ASSET_CACHE_DIR, 'cards');
const TAROT_JSON_FILE = path.join(ASSET_CACHE_DIR, 'tarot-images.json');
const GITHUB_ASSET_BASE_URL = 'https://raw.githubusercontent.com/metabismuth/tarot-json/master';
const ASSET_REFRESH_REQUESTED = process.argv.includes('--refresh-assets');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
};

const defaultState = {
  geminiApiKey: '',
  aiProvider: 'gemini',
  ollamaAddress: 'http://localhost:11434',
  ollamaModel: '',
  ollamaModelsList: [],
  userSettings: {},
  physicalDeck: null,
  readingSession: null,
  updatedAt: null,
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Request for ${url} failed with status ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}


function normalizeMeaningList(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function normalizeCardMeanings(card) {
  const meanings = card && typeof card.meanings === 'object' && card.meanings ? card.meanings : {};

  return {
    ...card,
    meanings: {
      ...meanings,
      light: normalizeMeaningList(meanings.light),
      shadow: normalizeMeaningList(meanings.shadow),
    },
  };
}

function normalizeTarotJson(tarotJson) {
  return {
    ...tarotJson,
    cards: Array.isArray(tarotJson.cards) ? tarotJson.cards.map(normalizeCardMeanings) : [],
  };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function downloadAsset(relativePath, destinationPath) {
  const safeRelativePath = relativePath.split('/').map(encodeURIComponent).join('/');
  const payload = await fetchUrl(`${GITHUB_ASSET_BASE_URL}/${safeRelativePath}`);
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, payload);
}

function getCardImageNames(tarotJson) {
  return [...new Set((tarotJson.cards || [])
    .map(card => card && card.img)
    .filter(imageName => typeof imageName === 'string' && imageName.trim()))];
}

async function cachedAssetsAreComplete() {
  if (!(await pathExists(TAROT_JSON_FILE))) return false;

  const rawTarotJson = JSON.parse(await fs.readFile(TAROT_JSON_FILE, 'utf8'));
  const tarotJson = normalizeTarotJson(rawTarotJson);
  const imageNames = getCardImageNames(tarotJson);
  if (!imageNames.length) return false;

  const missingImageChecks = await Promise.all(imageNames.map(async imageName => ({
    imageName,
    exists: await pathExists(path.join(ASSET_CARDS_DIR, imageName)),
  })));

  return missingImageChecks.every(check => check.exists);
}

async function refreshTarotAssets() {
  console.log(`Refreshing tarot assets from ${GITHUB_ASSET_BASE_URL}`);
  const tarotJsonPayload = await fetchUrl(`${GITHUB_ASSET_BASE_URL}/tarot-images.json`);
  const tarotJson = normalizeTarotJson(JSON.parse(tarotJsonPayload.toString('utf8')));
  const imageNames = getCardImageNames(tarotJson);

  await fs.mkdir(ASSET_CARDS_DIR, { recursive: true });
  await fs.writeFile(TAROT_JSON_FILE, `${JSON.stringify(tarotJson, null, 2)}\n`, 'utf8');

  for (const imageName of imageNames) {
    await downloadAsset(`cards/${imageName}`, path.join(ASSET_CARDS_DIR, imageName));
  }

  console.log(`Cached ${imageNames.length} tarot card images in ${ASSET_CACHE_DIR}`);
}

let assetCachePromise;
async function ensureTarotAssets() {
  if (!assetCachePromise) {
    assetCachePromise = (async () => {
      if (ASSET_REFRESH_REQUESTED || !(await cachedAssetsAreComplete())) {
        await refreshTarotAssets();
      }
    })().catch(error => {
      assetCachePromise = null;
      throw error;
    });
  }

  return assetCachePromise;
}

async function readState() {
  try {
    const content = await fs.readFile(STATE_FILE, 'utf8');
    return { ...defaultState, ...JSON.parse(content) };
  } catch (error) {
    if (error.code === 'ENOENT') return defaultState;
    throw error;
  }
}

async function writeState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const nextState = { ...defaultState, ...state, updatedAt: new Date().toISOString() };
  await fs.writeFile(STATE_FILE, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
  return nextState;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body is too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

async function serveStatic(request, response, pathname, root = ROOT) {
  const safePath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(root, safePath));
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  if (filePath !== root && !filePath.startsWith(rootWithSeparator)) {
    sendError(response, 403, 'Forbidden');
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const headers = {
      'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    };
    if (root === ASSET_CACHE_DIR) {
      headers['Cache-Control'] = 'public, max-age=604800, immutable';
    }
    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : file);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      sendError(response, 404, 'Not found');
      return;
    }
    console.error(error);
    sendError(response, 500, 'Unable to read requested file');
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (url.pathname === '/api/state') {
      if (request.method === 'GET') {
        sendJson(response, 200, await readState());
        return;
      }

      if (request.method === 'PUT') {
        const body = await readRequestBody(request);
        const state = body ? JSON.parse(body) : {};
        sendJson(response, 200, await writeState(state));
        return;
      }

      sendError(response, 405, 'Method not allowed');
      return;
    }

    if (url.pathname.startsWith('/assets/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendError(response, 405, 'Method not allowed');
        return;
      }

      await ensureTarotAssets();
      await serveStatic(request, response, url.pathname.replace(/^\/assets/, '') || '/', ASSET_CACHE_DIR);
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendError(response, 405, 'Method not allowed');
      return;
    }

    await serveStatic(request, response, url.pathname);
  } catch (error) {
    console.error(error);
    sendError(response, 500, 'Unexpected server error');
  }
});

async function start() {
  if (ASSET_REFRESH_REQUESTED) {
    await refreshTarotAssets();
    console.log('Manual tarot asset refresh completed.');
    return;
  }

  ensureTarotAssets().catch(error => {
    console.error('Tarot asset cache could not be prepared at startup. The server will retry on the next /assets request.', error);
  });

  server.listen(PORT, () => {
    console.log(`Cosmic Tarot server listening at http://localhost:${PORT}`);
    console.log(`Persistent state file: ${STATE_FILE}`);
    console.log(`Tarot asset cache directory: ${ASSET_CACHE_DIR}`);
  });
}

start().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
