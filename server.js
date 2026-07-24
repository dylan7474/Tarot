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


function sentenceFromList(items, fallback) {
  const values = Array.isArray(items)
    ? items.map(item => String(item).trim()).filter(Boolean)
    : [];
  if (!values.length) return fallback;
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;
}

const MAJOR_MEANING_THEMES = {
  "The Fool": ["a fresh threshold, brave curiosity, and the freedom to begin without knowing every step", "recklessness, scattered trust, or leaping before the spirit has checked the ground"],
  "The Magician": ["focused will, skillful manifestation, and turning available tools into visible change", "manipulation, unfocused power, or potential that is being delayed by doubt"],
  "The High Priestess": ["inner knowing, sacred mystery, and the quiet wisdom beneath the surface", "withheld truth, ignored intuition, or confusion created by silence and secrecy"],
  "The Empress": ["nurture, creativity, abundance, and the body wisdom that helps life flourish", "creative blocks, overgiving, or neglecting the care that sustains growth"],
  "The Emperor": ["structure, protection, leadership, and the steady authority that creates safety", "control, rigidity, or authority that has hardened into pressure"],
  "The Hierophant": ["tradition, shared values, mentorship, and learning through trusted spiritual containers", "dogma, conformity, or inherited rules that no longer serve the soul"],
  "The Lovers": ["choice, union, devotion, and values that align the heart with action", "misalignment, temptation, or choices made from fear rather than truth"],
  "The Chariot": ["direction, discipline, momentum, and the courage to steer opposing forces", "force without focus, stalled progress, or willpower pulling against itself"],
  "Strength": ["compassionate courage, patience, and the gentle mastery of instinct", "self-doubt, reactive pride, or trying to dominate what needs kindness"],
  "The Hermit": ["solitude, reflection, and the lantern of wisdom found within", "isolation, withdrawal, or refusing the guidance that quiet has revealed"],
  "Wheel of Fortune": ["cycles, turning points, fate, and the changing rhythm of opportunity", "resistance to change, unlucky timing, or repeating a lesson without integration"],
  "Justice": ["truth, accountability, balance, and choices weighed with clear integrity", "avoidance of consequences, unfairness, or distorted judgment"],
  "The Hanged Man": ["surrender, new perspective, and wisdom gained by pausing the struggle", "stagnation, martyrdom, or delay that avoids necessary release"],
  "Death": ["release, transformation, and the sacred ending that makes renewal possible", "clinging to what is over, fear of transition, or delayed rebirth"],
  "Temperance": ["integration, moderation, healing, and the alchemy of blended opposites", "excess, impatience, or imbalance that disrupts the healing process"],
  "The Devil": ["bondage revealed, desire made conscious, and the power to name attachments", "compulsion, shame, or patterns that keep energy chained"],
  "The Tower": ["sudden truth, liberation, and the collapse of structures built on illusion", "fear of upheaval, denial, or resisting a necessary breakthrough"],
  "The Star": ["hope, renewal, spiritual guidance, and the tender return of faith", "discouragement, depletion, or losing sight of the light ahead"],
  "The Moon": ["dreams, uncertainty, intuition, and the symbolic language of the unconscious", "illusion, anxiety, or wandering too long in shadows without grounding"],
  "The Sun": ["joy, vitality, clarity, and the life-giving warmth of honest expression", "temporary gloom, overexposure, or joy dimmed by self-consciousness"],
  "Judgement": ["awakening, reckoning, and the call to rise into a truer life", "self-judgment, avoidance of the call, or fear of being fully seen"],
  "The World": ["completion, integration, belonging, and the wholeness earned through the journey", "unfinished closure, limited vision, or difficulty receiving accomplishment"]
};

const SUIT_MEANING_THEMES = {
  Wands: "creative fire, desire, courage, and inspired action",
  Cups: "emotion, intuition, relationships, and the waters of the heart",
  Swords: "thought, truth, conflict, and the clarifying power of the mind",
  Pentacles: "body, resources, work, and the practical magic of the material world"
};

const RANK_MEANING_THEMES = {
  Ace: ["a seed of new potential beginning to glow", "a gift of potential that is blocked, delayed, or doubted"],
  Two: ["choice, partnership, and the first dance between opposing needs", "indecision, imbalance, or a partnership out of rhythm"],
  Three: ["growth, collaboration, and energy taking visible form", "scattered effort, weak support, or growth that needs realignment"],
  Four: ["stability, pause, and the container that lets energy settle", "stagnation, restlessness, or a structure that has become too small"],
  Five: ["challenge, disruption, and the friction that reveals what must change", "avoidance of conflict, lingering tension, or lessons repeated through struggle"],
  Six: ["movement toward harmony, repair, and the grace of perspective", "difficulty receiving peace, nostalgia, or an uneven exchange"],
  Seven: ["assessment, courage, and the need to choose with discernment", "self-doubt, confusion, or defending a path that needs review"],
  Eight: ["momentum, mastery, and focused movement through a threshold", "delay, overwhelm, or energy moving without conscious direction"],
  Nine: ["ripening, resilience, and the near-completion of a cycle", "exhaustion, guardedness, or fulfillment that feels just out of reach"],
  Ten: ["culmination, responsibility, and the full weight or harvest of the suit", "overload, release resisted, or completion that requires a new boundary"],
  Page: ["curiosity, study, and a messenger bringing the suit in youthful form", "immaturity, distraction, or a lesson not yet embodied"],
  Knight: ["movement, pursuit, and the suit expressed as questing momentum", "haste, inconsistency, or a quest driven by reaction"],
  Queen: ["receptive mastery, inner authority, and the suit held with mature care", "insecurity, emotional depletion, or wisdom withheld from itself"],
  King: ["outward mastery, stewardship, and the suit expressed through responsible leadership", "domination, rigidity, or authority disconnected from wisdom"]
};

function cardMeaningThemes(card) {
  const cardName = card.name || 'This card';
  if (MAJOR_MEANING_THEMES[cardName]) return MAJOR_MEANING_THEMES[cardName];

  const rank = Object.keys(RANK_MEANING_THEMES).find(value => cardName.startsWith(`${value} of `));
  const suit = card.suit || Object.keys(SUIT_MEANING_THEMES).find(value => cardName.endsWith(`of ${value}`));
  const fallbackTheme = sentenceFromList(card.keywords, cardName);
  const suitTheme = SUIT_MEANING_THEMES[suit] || fallbackTheme;
  const rankThemes = RANK_MEANING_THEMES[rank] || [fallbackTheme, `blocked or overextended ${fallbackTheme}`];

  return [
    `${rankThemes[0]} within ${suitTheme}`,
    `${rankThemes[1]} within ${suitTheme}`
  ];
}

function generatedCardMeanings(card) {
  const cardLabel = card.name || 'This card';
  const [lightTheme, shadowTheme] = cardMeaningThemes(card);

  return {
    light: [
      `${cardLabel} reveals ${lightTheme}.`,
      `Upright, it encourages you to work with this energy consciously and let its lesson shape the next step.`
    ],
    shadow: [
      `${cardLabel} reversed reveals ${shadowTheme}.`,
      `In shadow, it asks for honest attention to where this pattern is blocked, exaggerated, or ready to be released.`
    ]
  };
}

function normalizeMeaningList(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function enrichCardMeanings(card) {
  const generated = generatedCardMeanings(card);
  const meanings = card && typeof card.meanings === 'object' && card.meanings ? card.meanings : {};
  const light = normalizeMeaningList(meanings.light);
  const shadow = normalizeMeaningList(meanings.shadow);

  return {
    ...card,
    meanings: {
      ...meanings,
      light: light.length ? light : generated.light,
      shadow: shadow.length ? shadow : generated.shadow,
    },
  };
}

function enrichTarotJson(tarotJson) {
  return {
    ...tarotJson,
    cards: Array.isArray(tarotJson.cards) ? tarotJson.cards.map(enrichCardMeanings) : [],
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
  const tarotJson = enrichTarotJson(rawTarotJson);
  if (JSON.stringify(rawTarotJson.cards || []) !== JSON.stringify(tarotJson.cards)) {
    await fs.writeFile(TAROT_JSON_FILE, `${JSON.stringify(tarotJson, null, 2)}\n`, 'utf8');
  }
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
  const tarotJson = enrichTarotJson(JSON.parse(tarotJsonPayload.toString('utf8')));
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
