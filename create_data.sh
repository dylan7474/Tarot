#!/usr/bin/env bash
set -euo pipefail

OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
OLLAMA_MODEL_WAS_SET=0
if [[ -n "${OLLAMA_MODEL+x}" ]]; then
  OLLAMA_MODEL_WAS_SET=1
fi
OLLAMA_MODEL="${OLLAMA_MODEL:-}"
OUTPUT_FILE="${OUTPUT_FILE:-data/assets/tarot-images.json}"
SOURCE_FILE="${SOURCE_FILE:-}"
REQUEST_DELAY_SECONDS="${REQUEST_DELAY_SECONDS:-0}"
LIST_CARDS_ONLY=0
LIST_MODELS_ONLY=0

usage() {
  cat <<USAGE
Create an Ollama-enriched tarot card database for Cosmic Tarot.

Environment variables:
  OLLAMA_URL              Ollama base URL. Default: http://localhost:11434
  OLLAMA_MODEL            Local model name. If unset in an interactive terminal, choose from installed models.
  OUTPUT_FILE             Compatible JSON database to write. Default: data/assets/tarot-images.json
  SOURCE_FILE             Optional existing tarot-images.json to preserve images/metadata.
  REQUEST_DELAY_SECONDS   Optional pause between cards. Default: 0

Options:
  -h, --help             Show this help text.
  --list-cards           Print the canonical 78-card sequence and exit.
  --list-models          Print installed Ollama models from OLLAMA_URL and exit.

Example:
  ./create_data.sh
  OLLAMA_MODEL=mistral ./create_data.sh
  OLLAMA_URL=http://ollama.lan:11434 OLLAMA_MODEL=llama3.1 OUTPUT_FILE=data/generated/tarot-images.json ./create_data.sh
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

for arg in "$@"; do
  case "$arg" in
    --list-cards) LIST_CARDS_ONLY=1 ;;
    --list-models) LIST_MODELS_ONLY=1 ;;
    -h|--help) ;;
    *) echo "Unknown option: $arg" >&2; usage; exit 1 ;;
  esac
done

command -v python3 >/dev/null 2>&1 || { echo "Python 3 is required to run this generator." >&2; exit 1; }

export OLLAMA_URL OLLAMA_MODEL OLLAMA_MODEL_WAS_SET OUTPUT_FILE SOURCE_FILE REQUEST_DELAY_SECONDS LIST_CARDS_ONLY LIST_MODELS_ONLY

python3 <<'PYTHON'
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ollama_url = os.environ.get('OLLAMA_URL', 'http://localhost:11434').rstrip('/')
model = os.environ.get('OLLAMA_MODEL', '').strip()
model_was_set = os.environ.get('OLLAMA_MODEL_WAS_SET') == '1'
output_file = Path(os.environ.get('OUTPUT_FILE', 'data/assets/tarot-images.json'))
source_file = os.environ.get('SOURCE_FILE', '')
delay_seconds = max(0.0, float(os.environ.get('REQUEST_DELAY_SECONDS', '0') or 0))
list_cards_only = os.environ.get('LIST_CARDS_ONLY') == '1'
list_models_only = os.environ.get('LIST_MODELS_ONLY') == '1'

SUITS = ['wands', 'cups', 'swords', 'pentacles']
RANKS = [
    ('ace', 'Ace'), ('02', 'Two'), ('03', 'Three'), ('04', 'Four'), ('05', 'Five'), ('06', 'Six'), ('07', 'Seven'),
    ('08', 'Eight'), ('09', 'Nine'), ('10', 'Ten'), ('page', 'Page'), ('knight', 'Knight'), ('queen', 'Queen'), ('king', 'King'),
]
MAJOR_ARCANA = [
    ('m00', 'The Fool'), ('m01', 'The Magician'), ('m02', 'The High Priestess'), ('m03', 'The Empress'),
    ('m04', 'The Emperor'), ('m05', 'The Hierophant'), ('m06', 'The Lovers'), ('m07', 'The Chariot'),
    ('m08', 'Strength'), ('m09', 'The Hermit'), ('m10', 'Wheel of Fortune'), ('m11', 'Justice'),
    ('m12', 'The Hanged Man'), ('m13', 'Death'), ('m14', 'Temperance'), ('m15', 'The Devil'),
    ('m16', 'The Tower'), ('m17', 'The Star'), ('m18', 'The Moon'), ('m19', 'The Sun'),
    ('m20', 'Judgement'), ('m21', 'The World'),
]
DEFAULT_KEYWORDS = {
    'The Fool': ['beginnings', 'trust', 'adventure', 'innocence'],
    'The Magician': ['will', 'skill', 'manifestation', 'focus'],
    'The High Priestess': ['intuition', 'mystery', 'inner knowing', 'dreams'],
    'The Empress': ['nurturing', 'abundance', 'creativity', 'embodiment'],
    'The Emperor': ['structure', 'authority', 'stability', 'leadership'],
    'The Hierophant': ['tradition', 'teaching', 'ritual', 'belief'],
    'The Lovers': ['choice', 'union', 'values', 'harmony'],
    'The Chariot': ['direction', 'discipline', 'victory', 'momentum'],
    'Strength': ['courage', 'patience', 'compassion', 'inner power'],
    'The Hermit': ['solitude', 'wisdom', 'reflection', 'guidance'],
    'Wheel of Fortune': ['cycles', 'change', 'luck', 'timing'],
    'Justice': ['truth', 'balance', 'accountability', 'fairness'],
    'The Hanged Man': ['surrender', 'perspective', 'pause', 'release'],
    'Death': ['ending', 'transition', 'renewal', 'transformation'],
    'Temperance': ['integration', 'moderation', 'healing', 'alchemy'],
    'The Devil': ['attachment', 'shadow', 'desire', 'restriction'],
    'The Tower': ['upheaval', 'revelation', 'liberation', 'truth'],
    'The Star': ['hope', 'renewal', 'inspiration', 'faith'],
    'The Moon': ['uncertainty', 'dreams', 'illusion', 'instinct'],
    'The Sun': ['joy', 'clarity', 'vitality', 'success'],
    'Judgement': ['awakening', 'calling', 'reckoning', 'rebirth'],
    'The World': ['completion', 'integration', 'achievement', 'wholeness'],
}
SUIT_THEMES = {
    'wands': ['fire', 'creativity', 'ambition', 'spirit'],
    'cups': ['water', 'emotion', 'relationships', 'intuition'],
    'swords': ['air', 'thought', 'truth', 'conflict'],
    'pentacles': ['earth', 'resources', 'body', 'work'],
}
RANK_THEMES = {
    'Ace': ['seed', 'potential'], 'Two': ['choice', 'balance'], 'Three': ['growth', 'collaboration'], 'Four': ['foundation', 'stability'],
    'Five': ['challenge', 'disruption'], 'Six': ['harmony', 'exchange'], 'Seven': ['assessment', 'perseverance'], 'Eight': ['movement', 'mastery'],
    'Nine': ['culmination', 'resilience'], 'Ten': ['completion', 'burden'], 'Page': ['study', 'message'], 'Knight': ['pursuit', 'action'],
    'Queen': ['maturity', 'care'], 'King': ['mastery', 'leadership'],
}



def fetch_ollama_models():
    request = urllib.request.Request(f'{ollama_url}/api/tags', method='GET')
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Ollama model list returned {error.code} {error.reason}') from error
    except urllib.error.URLError as error:
        raise RuntimeError(f'Could not connect to Ollama at {ollama_url}: {error.reason}') from error

    models = payload.get('models', [])
    names = []
    for item in models:
        name = item.get('name') if isinstance(item, dict) else None
        if isinstance(name, str) and name.strip():
            names.append(name.strip())
    return sorted(names, key=str.lower)


def print_numbered_models(models):
    if not models:
        print(f'No installed Ollama models were reported by {ollama_url}.')
        return
    print(f'Installed Ollama models at {ollama_url}:')
    for index, model_name in enumerate(models, start=1):
        print(f'{index:02d}. {model_name}')


def select_ollama_model():
    global model
    if model:
        return

    models = fetch_ollama_models()
    if not models:
        raise RuntimeError(f'No Ollama models are installed at {ollama_url}. Run `ollama pull llama3.1` or set OLLAMA_MODEL to a remote model name.')

    if not sys.stdin.isatty():
        model = models[0]
        print(f'OLLAMA_MODEL was not set and input is non-interactive; using installed model: {model}')
        return

    print_numbered_models(models)
    while True:
        choice = input(f'Select a model [1-{len(models)}]: ').strip()
        if choice.isdigit():
            index = int(choice)
            if 1 <= index <= len(models):
                model = models[index - 1]
                print(f'Using Ollama model: {model}')
                return
        print('Please enter one of the numbered model choices.')


def verify_selected_model():
    if not model_was_set or list_models_only:
        return
    models = fetch_ollama_models()
    model_aliases = {name.split(':', 1)[0] for name in models}
    if model not in models and model not in model_aliases:
        available = ', '.join(models) if models else 'none'
        raise RuntimeError(f'Ollama model `{model}` is not installed at {ollama_url}. Installed models: {available}')


def minor_keywords(rank_name, suit_name):
    return (RANK_THEMES[rank_name] + SUIT_THEMES[suit_name])[:4]


def title_suit(suit_name):
    return suit_name[0].upper() + suit_name[1:]


def build_canonical_deck():
    majors = [
        {
            'name': name,
            'name_short': name_short,
            'value': name.removeprefix('The '),
            'value_int': int(name_short[1:]),
            'suit': 'major',
            'type': 'major',
            'img': f'{name_short}.jpg',
            'keywords': DEFAULT_KEYWORDS.get(name, []),
            'meanings': {'light': [], 'shadow': []},
        }
        for name_short, name in MAJOR_ARCANA
    ]
    minors = []
    for suit_name in SUITS:
        for index, (rank_code, rank_name) in enumerate(RANKS, start=1):
            minors.append({
                'name': f'{rank_name} of {title_suit(suit_name)}',
                'name_short': f'{suit_name[0]}{rank_code}',
                'value': rank_name,
                'value_int': index,
                'suit': suit_name,
                'type': 'minor',
                'img': f'{suit_name[0]}{rank_code}.jpg',
                'keywords': minor_keywords(rank_name, suit_name),
                'meanings': {'light': [], 'shadow': []},
            })
    return majors + minors


def load_source_deck():
    candidates = [source_file, str(output_file), 'data/assets/tarot-images.json', 'tarot-images.json']
    for candidate in [path for path in candidates if path]:
        candidate_path = Path(candidate)
        if candidate_path.exists():
            with candidate_path.open(encoding='utf-8') as file_handle:
                parsed = json.load(file_handle)
            if isinstance(parsed.get('cards'), list) and parsed['cards']:
                return parsed
    return {'description': 'Cosmic Tarot Ollama-generated card database', 'cards': build_canonical_deck()}


def coerce_meaning_list(value):
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()][:3]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def ask_ollama(card):
    keywords = ', '.join(card.get('keywords') or [])
    prompt = (
        f'Write concise tarot encyclopedia meanings for {card["name"]}. '
        'Return ONLY JSON with keys upright and reversed. '
        'Each value must be an array of exactly 2 short, practical sentences. '
        'Avoid markdown, fortune-telling certainty, and references to being an AI. '
        f'Keywords: {keywords}.'
    )
    request_body = json.dumps({
        'model': model,
        'prompt': prompt,
        'stream': False,
        'format': 'json',
        'options': {'temperature': 0.7},
    }).encode('utf-8')
    request = urllib.request.Request(
        f'{ollama_url}/api/generate',
        data=request_body,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            payload = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Ollama returned {error.code} {error.reason}') from error
    parsed = json.loads(str(payload.get('response', '')).strip())
    upright = coerce_meaning_list(parsed.get('upright'))
    reversed_meanings = coerce_meaning_list(parsed.get('reversed') or parsed.get('inverted'))
    if not upright or not reversed_meanings:
        raise ValueError(f'Model response for {card["name"]} did not include upright and reversed arrays.')
    return upright, reversed_meanings


def main():
    if list_cards_only:
        for index, card in enumerate(build_canonical_deck(), start=1):
            print(f'{index:02d}. {card["name"]}')
        return

    if list_models_only:
        print_numbered_models(fetch_ollama_models())
        return

    select_ollama_model()
    verify_selected_model()

    database = load_source_deck()
    cards = database.get('cards') if isinstance(database.get('cards'), list) else build_canonical_deck()
    print(f'Generating meanings for {len(cards)} cards with {model} at {ollama_url}')

    enriched_cards = []
    for index, card in enumerate(cards, start=1):
        print(f'{index:02d}/{len(cards)} {card["name"]} ... ', end='', flush=True)
        upright, reversed_meanings = ask_ollama(card)
        meanings = dict(card.get('meanings') or {})
        meanings['light'] = upright
        meanings['shadow'] = reversed_meanings
        enriched_card = dict(card)
        enriched_card['meanings'] = meanings
        enriched_card['ollamaGenerated'] = {'model': model, 'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
        enriched_cards.append(enriched_card)
        print('done')
        if delay_seconds:
            time.sleep(delay_seconds)

    output = dict(database)
    output['description'] = output.get('description') or 'Cosmic Tarot card database'
    output['generatedBy'] = 'create_data.sh'
    output['generatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    output['ollama'] = {'url': ollama_url, 'model': model}
    output['cards'] = enriched_cards
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with output_file.open('w', encoding='utf-8') as file_handle:
        json.dump(output, file_handle, indent=2)
        file_handle.write('\n')
    print(f'Wrote {len(enriched_cards)} cards to {output_file}')


try:
    main()
except Exception as error:
    print(f'\nGeneration failed: {error}', file=sys.stderr)
    print(f'Confirm Ollama is running and the selected model is available, e.g. `ollama pull llama3.1` or run `./create_data.sh --list-models`.', file=sys.stderr)
    sys.exit(1)
PYTHON
