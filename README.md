# Cosmic Tarot

Cosmic Tarot is a single-page, browser-based tarot reading application. It combines a mystical Tailwind CSS interface, animated card draws, a deck encyclopedia, optional sound effects, and AI-assisted interpretation through either Gemini or a local Ollama server.

## Features

- **Spread Reading mode** for one-card daily insight or three-card past/present/future readings.
- **Deck Explorer mode** for browsing and searching tarot card meanings by arcana or suit.
- **Card details modal** with keywords plus light and shadow interpretations.
- **Optional AI readings** that synthesize your question and drawn cards using Gemini or Ollama.
- **No build step required**: the app runs directly from `index.html` and loads UI/audio libraries from public CDNs.

## Getting Started

### Run locally

1. Clone this repository.
2. Open `index.html` in a modern browser.

You can also serve the folder with any static file server if you prefer local HTTP URLs:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

### Run with server-side persistence

To make settings and the physical deck order perpetual across browsers and sessions, run the included Node.js server instead of a generic static server:

```bash
node server.js
```

Then visit `http://localhost:8000`. The app stores shared settings, AI provider configuration, Ollama model choices, and the current physical deck order in `data/server-state.json`. The server also mirrors the tarot card metadata and card artwork from GitHub into `data/assets/` on startup or the first `/assets/` request when the cache is missing, normalizes any provided upright or reversed descriptions without inventing missing meanings, then serves them locally from `/assets/tarot-images.json` and `/assets/cards/<image>.jpg` so browsers do not repeatedly contact GitHub for card assets. Set `PORT` to choose a different port, `TAROT_DATA_DIR` to store state and cached assets somewhere outside the repository, or `TAROT_ASSET_CACHE_DIR` to store only the mirrored tarot assets elsewhere:

```bash
PORT=3018 TAROT_DATA_DIR=/var/lib/cosmic-tarot node server.js
TAROT_ASSET_CACHE_DIR=/var/cache/cosmic-tarot-assets node server.js
```

To refresh the mirrored card metadata and images on demand, run:

```bash
node server.js --refresh-assets
```

If the page is opened directly from disk or served without `server.js`, Cosmic Tarot automatically falls back to browser-local storage.

### Deploy with Docker

Use the included deployment script to build a minimal Node.js image and run Cosmic Tarot in Docker with server-side persistence enabled. The script defaults to port `3018`, or you can pass a different port as the first argument.

```bash
./deploy.sh
./deploy.sh 8080
```

Then visit `http://localhost:3018` unless you selected a custom port. Docker deployments keep server-side settings, deck order, and mirrored tarot assets in the `cosmic-tarot-data` Docker volume.

### Optional AI setup

Open **AI Setup** in the app header to configure one of the supported providers:

- **Gemini**: paste and save a Gemini API key.
- **Ollama**: enter your local Ollama address, fetch available models, select one, and save.

Without AI configuration, the app still supports card drawing, card flipping, built-in interpretations, and deck exploration.

## Basic Controls

- **Spread Reading / Deck Explorer**: switch between reading mode and card encyclopedia mode.
- **Question field**: enter the question or theme for a reading.
- **Single Card / Three Cards**: choose the spread layout.
- **Shuffle & Draw Sphere**: deal cards into the selected spread.
- **Card slots**: click each card to flip and reveal it.
- **Reset & New Reading**: clear the current spread and start again.
- **Seek AI Interpretation**: request an AI-generated synthesis after cards are revealed.
- **Search and suit filters**: narrow the deck explorer by card name, keyword, arcana, or suit.
- **AI Setup**: configure Gemini or Ollama provider settings.

## Roadmap

- Add saved reading history and export/share options.
- Add more spread layouts, such as Celtic Cross and relationship spreads.
- Improve accessibility for keyboard navigation and screen readers.
- Add automated tests and a lightweight development workflow for future changes.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
