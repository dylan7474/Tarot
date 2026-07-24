#!/usr/bin/env python3
import json
import sys
from pathlib import Path

def validate_tarot_json(file_path_str):
    file_path = Path(file_path_str)
    
    if not file_path.exists():
        print(f"❌ Error: File not found at {file_path}")
        return False

    print(f"🔍 Starting validation for: {file_path}...\n")
    
    try:
        with file_path.open('r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"❌ Error: Invalid JSON syntax! Details: {e}")
        return False

    errors = []
    warnings = []
    
    # 1. Top-Level Structure Checks
    required_top_keys = ["description", "cards"]
    for key in required_top_keys:
        if key not in data:
            errors.append(f"Missing required top-level key: '{key}'")

    if "cards" not in data or not isinstance(data["cards"], list):
        print("❌ Critical Error: 'cards' key is missing or is not an array. Aborting deep check.")
        return False

    cards = data["cards"]
    
    # 2. Deck Completeness Check (22 Majors + 56 Minors = 78 Canonical Cards)
    if len(cards) != 78:
        warnings.append(f"Deck count mismatch. Found {len(cards)} cards instead of the canonical 78.")

    # Tracking uniqueness
    seen_shorts = set()
    seen_names = set()

    # Allowed Enum Values
    allowed_suits = {"major", "wands", "cups", "swords", "pentacles"}
    allowed_types = {"major", "minor"}

    # 3. Individual Card Field Validation
    for index, card in enumerate(cards):
        card_label = card.get('name', f"Card at index {index}")
        
        # Check tracking keys
        name_short = card.get('name_short')
        if name_short:
            if name_short in seen_shorts:
                errors.append(f"[{card_label}] Duplicate name_short found: '{name_short}'")
            seen_shorts.add(name_short)
            
        name = card.get('name')
        if name:
            if name in seen_names:
                errors.append(f"Duplicate card name found: '{name}'")
            seen_names.add(name)

        # Structure & Type Requirements
        string_fields = ["name", "name_short", "value", "suit", "type", "img"]
        for field in string_fields:
            val = card.get(field)
            if not val or not isinstance(val, str):
                errors.append(f"[{card_label}] Field '{field}' must be a non-empty string.")

        # Validating Enums
        if card.get('suit') and card['suit'] not in allowed_suits:
            errors.append(f"[{card_label}] Invalid suit: '{card['suit']}'. Expected one of {allowed_suits}")
        if card.get('type') and card['type'] not in allowed_types:
            errors.append(f"[{card_label}] Invalid type: '{card['type']}'. Expected one of {allowed_types}")

        # Numerical integrity
        if 'value_int' not in card or not isinstance(card['value_int'], int):
            errors.append(f"[{card_label}] 'value_int' must be an integer.")

        # Keywords validation
        keywords = card.get('keywords')
        if not isinstance(keywords, list) or len(keywords) == 0:
            errors.append(f"[{card_label}] 'keywords' must be a non-empty list.")
        elif not all(isinstance(k, str) for k in keywords):
            errors.append(f"[{card_label}] All items in 'keywords' must be strings.")

        # Meanings validation (crucial for consumer apps)
        meanings = card.get('meanings')
        if not isinstance(meanings, dict):
            errors.append(f"[{card_label}] 'meanings' must be an object.")
        else:
            for side in ['light', 'shadow']:
                side_list = meanings.get(side)
                if not isinstance(side_list, list):
                    errors.append(f"[{card_label}] 'meanings.{side}' must be an array.")
                elif len(side_list) != 2:
                    errors.append(f"[{card_label}] 'meanings.{side}' must contain exactly 2 sentences (Found {len(side_list)}).")
                elif not all(isinstance(s, str) and s.strip() for s in side_list):
                    errors.append(f"[{card_label}] Items in 'meanings.{side}' must be non-empty strings.")

        # 4. AI-Generation Metachecks (Ollama Warnings Audit)
        ollama_meta = card.get('ollamaGenerated', {})
        if isinstance(ollama_meta, dict) and 'warning' in ollama_meta:
            warnings.append(f"[{card_label}] AI Generation Warning: {ollama_meta['warning']}")

    # --- Summary Reporting ---
    print("--- Validation Report ---")
    
    if warnings:
        print(f"⚠️  Warnings ({len(warnings)}):")
        for w in warnings:
            print(f"  - {w}")
        print()

    if errors:
        print(f"❌ Errors Found ({len(errors)}):")
        for e in errors:
            print(f"  - {e}")
        print("\nResult: 🛑 FAILED. Data is not production-ready.")
        return False
    else:
        print("Result: ✅ PASSED. Data structure is error-free and clean for your data source application.")
        return True

if __name__ == "__main__":
    # You can supply your path here or pass it via CLI
    target_file = "data/assets/tarot-images.json"
    if len(sys.argv) > 1:
        target_file = sys.argv[1]
        
    success = validate_tarot_json(target_file)
    sys.exit(0 if success else 1)