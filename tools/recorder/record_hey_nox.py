"""Hey Nox Wake-Word Aufnahme-Skript (Deutsch)

Nutzung:
    python record_hey_nox.py --name "Nutzer1"
    python record_hey_nox.py --name "User1" --lang en

Phase 1: Positive Clips — "Hey Nox" sagen (mit verschiedenen Modi)
Phase 2: Negative Clips — andere Saetze sagen (damit das Model lernt
         was NICHT "Hey Nox" ist)
"""

import argparse
import os
import sys
import wave
import random
from pathlib import Path

REQUIRED_PACKAGES = ["numpy", "sounddevice"]

try:
    import numpy as np
    import sounddevice as sd
except ImportError:
    print("Abhaengigkeiten fehlen — versuche automatische Installation...")
    import subprocess
    for pkg in REQUIRED_PACKAGES:
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "--quiet"])
        except subprocess.CalledProcessError:
            print(f"  Konnte '{pkg}' nicht installieren.")
            print(f"  Bitte manuell: pip install {pkg}")
            sys.exit(1)
    print("  Installation abgeschlossen.\n")
    # Retry imports
    try:
        import numpy as np
        import sounddevice as sd
    except ImportError:
        print("Trotz Installation konnten die Pakete nicht importiert werden.")
        print("Bitte pruefe deine Python-Umgebung.")
        sys.exit(1)

SAMPLE_RATE = 16000
DURATION = 2.5
CHANNELS = 1

# ── Aufnahme-Modi ────────────────────────────────────────────────────────────
# (Modus-ID, Anweisung, min_Peak, max_Peak, Kategorie)

ALL_MODES = [
    # ── base: immer machbar ──
    ("normal",       "Normal sprechen", 0.03, 0.8, "base"),
    ("close",        "NAH ans Mikro (ca. 5-10cm)", 0.05, 0.9, "base"),
    ("far",          "etwas WEITER weg (ca. 50-80cm)", 0.01, 0.5, "base"),
    ("whisper",      "FLUESTERN, nah ans Mikro", 0.005, 0.25, "base"),
    ("whisper_far",  "FLUESTERN, normaler Abstand", 0.003, 0.15, "base"),
    ("quiet",        "LEISE sprechen (Bibliothek)", 0.02, 0.4, "base"),
    ("fast",         "SEHR SCHNELL sagen", 0.03, 0.8, "base"),
    ("slow",         "SEHR LANGSAM, jedes Wort betont", 0.03, 0.8, "base"),
    ("casual",       "BEILAEUFIG sagen", 0.02, 0.6, "base"),
    ("question",     'Als FRAGE sagen', 0.03, 0.7, "base"),
    ("angry",        "GENERVT sagen", 0.05, 0.9, "base"),
    ("happy",        "FROEHLICH sagen", 0.03, 0.8, "base"),
    ("bored",        "GELANGWEILT sagen", 0.02, 0.5, "base"),
    ("morning",      "SCHLAEFRIG sagen (gerade aufgewacht)", 0.02, 0.6, "base"),
    ("tired",        "MUeDE/ERSCHOEPFT sagen", 0.02, 0.5, "base"),
    ("turn_left",    "KOPF 45° NACH LINKS drehen", 0.01, 0.5, "base"),
    ("turn_right",   "KOPF 45° NACH RECHTS drehen", 0.01, 0.5, "base"),
    ("turn_away",    "KOPF GANZ ABWENDEN (180°)", 0.005, 0.4, "base"),
    ("look_down",    "auf den BODEN schauen", 0.01, 0.5, "base"),
    ("lean_back",    "ZURUECKLEHNEN im Stuhl", 0.01, 0.5, "base"),
    ("stand_up",     "STEHEN (aufstehen!)", 0.01, 0.6, "base"),
    ("moving",       "KOPF BEWEGEN (nicken/schuetteln)", 0.01, 0.6, "base"),
    ("cough_then",   "RAEUSPERN, dann sagen", 0.01, 0.8, "base"),
    ("breath_then",  "TIEF EINATMEN, dann sagen", 0.02, 0.8, "base"),
    ("laugh_then",   "LACHEN, dann sagen", 0.02, 0.8, "base"),
    ("yawn_then",    "GAEHNEN, dann sagen", 0.01, 0.7, "base"),
    ("drink_then",   "TRINKEN, dann sagen", 0.02, 0.7, "base"),
    ("nose_closed",  "NASE ZUHALTEN (kranke Stimme)", 0.02, 0.7, "base"),
    ("smile",        "LAECHELN dabei (veraendert Stimme)", 0.03, 0.8, "base"),
    ("eating",       "KAUEN (Keks im Mund), dann sagen", 0.01, 0.6, "base"),

    # ── loud ──
    ("loud",         "LAUT sprechen", 0.1, 0.95, "loud"),
    ("shout",        "SCHREIEN (Achtung Nachbarn!)", 0.2, 1.0, "loud"),
    ("very_loud",    "SEHR LAUT rufen", 0.15, 1.0, "loud"),

    # ── rooms ──
    ("bathroom",     "im BAD (Hall/Echo)", 0.02, 0.8, "rooms"),
    ("other_room",   "ANDERER RAUM (Tuer offen)", 0.01, 0.5, "rooms"),
    ("hallway",      "FLUR/TREPPENHAUS (echoig)", 0.01, 0.6, "rooms"),
    ("kitchen",      "KUECHE (Geraete-Summen)", 0.02, 0.7, "rooms"),
    ("far_room",     "LAUT aus ANDEREM RAUM rufen", 0.05, 0.9, "rooms"),

    # ── bg ──
    ("bg_music",     "MUSIK LEISE anmachen", 0.02, 0.7, "bg"),
    ("bg_music_loud","MUSIK LAUTER anmachen", 0.02, 0.7, "bg"),
    ("bg_tv",        "TV/YouTube LEISE im Hintergrund", 0.02, 0.7, "bg"),
    ("bg_fan",       "LUEFTER/Klimaanlage AN", 0.02, 0.7, "bg"),
    ("bg_keyboard",  "auf TASTATUR tippen dabei", 0.02, 0.7, "bg"),
    ("bg_window",    "FENSTER AUF (Strasse/Vogel/Wind)", 0.02, 0.7, "bg"),

    # ── props ──
    ("fan_close",    "LUEFTER NAH ans Mikro halten", 0.02, 0.7, "props"),
    ("phone_in_hand","HANDY in der Hand halten (wie beim Telefonieren – Mikrofon in der Naehe)", 0.02, 0.7, "props"),
]

# ── Positive Phrasen ─────────────────────────────────────────────────────────

PHRASES_POS_DE = [
    "Hey Nox",
    "Hey, Nox",
    "Hallo Nox",
    "Hey Nox!",
]

PHRASES_POS_EN = [
    "Hey Nox",
    "Hi Nox",
    "Hello Nox",
    "Hey, Nox",
]

# ── Negative Phrasen ─────────────────────────────────────────────────────────
# Saetze die aehnlich klingen oder im Alltag vorkommen, aber NICHT
# "Hey Nox" sind. Das Model lernt dadurch False Positives zu vermeiden.

NEGATIVE_PHRASES_DE = [
    # ── Aehnlich klingende Woerter (Hard Negatives) ──
    "Hey Nexus",
    "Hey Box",
    "Hey Bots",
    "Hey Mox",
    "Hey Fox",
    "Hey Loxx",
    "Hey Knox",
    "Hey Notch",
    "Hallo Nexus",
    "Hallo Box",
    "Hallo Mox",
    "Hallo Fox",
    "Hallo Notch",
    "Hi Nexus",
    "Hi Box",
    "Hi Mox",
    "Hi Notch",
    "Hey Nux",
    "Hey Nocks",
    "Hey Noks",

    # ── Aehnliche Befehle / Smart-Home ──
    "Hey Siri",
    "Hey Google",
    "Hey Alexa",
    "OK Google",
    "Alexa",
    "Siri",
    "Computer",
    "Hey Cortana",
    "Hey Facebook",
    "OK Computer",

    # ── Alltagssaetze mit "Hey" oder "Hallo" ──
    "Hey, wie geht's?",
    "Hallo, jemand da?",
    "Hey, mach mal die Musik an",
    "Hey, was machst du?",
    "Hallo zusammen",
    "Hey, kannst du mir helfen?",
    "Hallo, ich bin's",
    "Hey, komm mal her",
    "Hallo, wie spaet ist es?",
    "Hey, hast du gesehen?",

    # ── Alltagssaetze ohne Bezug ──
    "Was gibt's neues?",
    "Ich habe Hunger",
    "Mach das Licht an",
    "Wie wird das Wetter?",
    "Stell den Timer auf 5 Minuten",
    "Spiel meine Lieblingsplaylist",
    "Wie spaet ist es?",
    "Ruf meine Mutter an",
    "Schick eine Nachricht an Thomas",
    "Oeffne die Beta-Tuer",
    "Fahr mich nach Hause",
    "Bestell eine Pizza",
    "Wie ist der Verkehr?",
    "Erzaehl mir einen Witz",
    "Was steht heute an?",

    # ── Normale Gespraechsfetzen ──
    "Ja, genau",
    "Nein, das stimmt nicht",
    "Ich weiss nicht",
    "Vielleicht spaeter",
    "Das ist interessant",
    "Kannst du das wiederholen?",
    "Moment mal",
    "Lass mich kurz ueberlegen",
    "Das ist eine gute Idee",
    "Ich stimme dir zu",

    # ── Zahlen / Buchstabieren ──
    "Eins zwei drei vier",
    "A B C D E F",
    "Siebenundvierzig",
    "Dreihundertzwanzig",
    "Neunundneunzig",

    # ── Zufaelliges ──
    "Blumenkohl",
    "Schokoladenkuchen",
    "Programmiersprache",
    "Wasserpflanze",
    "Kaffeetasse",
    "Fahrradkette",
    "Schneeballschlacht",
    "Bibliothekar",
    "Quarzuhr",
    "Zahnarzttermin",
]

NEGATIVE_PHRASES_EN = [
    # ── Hard Negatives ──
    "Hey Nexus",
    "Hey Box",
    "Hey Bots",
    "Hey Mox",
    "Hey Fox",
    "Hey Knox",
    "Hey Notch",
    "Hello Nexus",
    "Hello Box",
    "Hi Nexus",
    "Hi Box",
    "Hi Notch",
    "Hey Nux",
    "Hey Nocks",

    # ── Other wake words ──
    "Hey Siri",
    "Hey Google",
    "Hey Alexa",
    "OK Google",
    "Alexa",
    "Siri",
    "Computer",
    "Hey Cortana",
    "OK Computer",

    # ── Everyday phrases ──
    "Hey, how are you?",
    "Hello, anyone there?",
    "Hey, turn on the music",
    "Hey, what are you doing?",
    "Hello everyone",
    "Hey, can you help me?",
    "Hello, it's me",
    "Hey, come here",
    "Hello, what time is it?",
    "Hey, did you see that?",

    # ── Random everyday ──
    "What's new?",
    "I'm hungry",
    "Turn on the lights",
    "What's the weather?",
    "Set a timer for 5 minutes",
    "Play my favorite playlist",
    "What time is it?",
    "Call my mom",
    "Send a message to Thomas",
    "Open the front door",
    "Drive me home",
    "Order a pizza",
    "How's the traffic?",
    "Tell me a joke",
    "What's on my schedule?",

    # ── Conversation ──
    "Yeah, exactly",
    "No, that's not right",
    "I don't know",
    "Maybe later",
    "That's interesting",
    "Can you repeat that?",
    "Hold on a second",
    "Let me think",
    "That's a good idea",
    "I agree with you",

    # ── Numbers / Spelling ──
    "One two three four",
    "A B C D E F",
    "Forty-seven",
    "Three hundred twenty",
    "Ninety-nine",

    # ── Random words ──
    "Cauliflower",
    "Chocolate cake",
    "Programming language",
    "Coffee cup",
    "Bicycle chain",
    "Snowball fight",
    "Librarian",
    "Quartz watch",
    "Dentist appointment",
    "Water plant",
]


def ask_yes_no(question: str) -> bool:
    while True:
        ans = input(f"  {question} (j/n): ").strip().lower()
        if ans in ("j", "ja", "y", "yes", ""):
            return True
        if ans in ("n", "nein", "no"):
            return False
        print("  Bitte 'j' oder 'n' eingeben.")


def environment_questionnaire() -> dict:
    print()
    print("=" * 60)
    print("  UMGEBUNGS-FRAGEBOGEN")
    print("  Bevor es losgeht, ein paar Fragen zu deiner Situation.")
    print("=" * 60)
    print()

    env = {}

    env["can_be_loud"] = ask_yes_no(
        "Darfst du gerade laut sein / schreien?\n"
        "  (Nachts, duennwandige Wohnung, Mitbewohner schlafen, etc.)"
    )

    env["can_change_room"] = ask_yes_no(
        "Kannst du den Raum wechseln?\n"
        "  (Bad, Kueche, Flur — und das Mikro ist tragbar\n"
        "   oder du hast z.B. ein Laptop mit eingebautem Mikro)"
    )

    if env["can_change_room"]:
        env["has_bathroom"] = ask_yes_no("Hast du ein BAD in der Naehe (mit Hall/Echo)?")
        env["has_hallway"] = ask_yes_no("Hast du einen FLUR oder TREPPENHAUS in der Naehe?")
        env["has_kitchen"] = ask_yes_no("Hast du eine KUECHE in der Naehe (Kuehlschrank-Geraeusche)?")
        env["has_other_room"] = ask_yes_no("Hast du einen ANDEREN RAUM, von dem aus du zum PC rufen koenntest?")
    else:
        env["has_bathroom"] = False
        env["has_hallway"] = False
        env["has_kitchen"] = False
        env["has_other_room"] = False

    print()
    print("  Hintergrundgeraeusche:")
    env["has_music"] = ask_yes_no("Kannst du MUSIK anmachen (Spotify, YouTube, etc.)?")
    env["has_tv"] = ask_yes_no("Kannst du TV / einen Film / YouTube-Video im Hintergrund anmachen?")
    env["has_fan"] = ask_yes_no(
        "Hast du einen LUEFTER / Ventilator / Klimaanlage,\n"
        "  der im Mikrofon hoerbar ist? (Nicht nur leise Summen)"
    )
    if not env["has_fan"]:
        env["has_fan_portable"] = ask_yes_no(
            "Hast du einen TRAGBAREN Ventilator, den du ans Mikro halten koenntest?"
        )
    else:
        env["has_fan_portable"] = True

    env["can_open_window"] = ask_yes_no("Kannst du ein FENSTER oeffnen (Strassengeraeusche, Vogel, Wind)?")

    print()
    print("  Zusaetzliches:")
    env["has_phone"] = ask_yes_no("Hast du ein HANDY in der Naehe, das du beim Sprechen halten koenntest?")

    return env


def select_modes(env: dict) -> list:
    selected = []
    for mode in ALL_MODES:
        mode_id, instruction, min_p, max_p, category = mode

        if category == "base":
            selected.append(mode)
        elif category == "loud":
            if env["can_be_loud"]:
                selected.append(mode)
        elif category == "rooms":
            if mode_id == "bathroom" and env["has_bathroom"]:
                selected.append(mode)
            elif mode_id == "hallway" and env["has_hallway"]:
                selected.append(mode)
            elif mode_id == "kitchen" and env["has_kitchen"]:
                selected.append(mode)
            elif mode_id == "other_room" and env["has_other_room"]:
                selected.append(mode)
            elif mode_id == "far_room" and env["has_other_room"] and env["can_be_loud"]:
                selected.append(mode)
        elif category == "bg":
            if mode_id == "bg_music" and env["has_music"]:
                selected.append(mode)
            elif mode_id == "bg_music_loud" and env["has_music"] and env["can_be_loud"]:
                selected.append(mode)
            elif mode_id == "bg_tv" and env["has_tv"]:
                selected.append(mode)
            elif mode_id == "bg_fan" and env["has_fan"]:
                selected.append(mode)
            elif mode_id == "bg_keyboard":
                selected.append(mode)
            elif mode_id == "bg_window" and env["can_open_window"]:
                selected.append(mode)
        elif category == "props":
            if mode_id == "fan_close" and env["has_fan_portable"]:
                selected.append(mode)
            elif mode_id == "phone_in_hand" and env["has_phone"]:
                selected.append(mode)

    return selected


def record_clip(duration: float, sr: int) -> np.ndarray:
    n_samples = int(duration * sr)
    print(f"  Aufnahme... ({duration:.1f}s)", end="", flush=True)
    audio = sd.rec(n_samples, samplerate=sr, channels=CHANNELS, dtype="float32")
    sd.wait()
    print(" OK")
    return audio.flatten()


def save_wav(path: Path, audio: np.ndarray, sr: int) -> None:
    audio_int16 = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(CHANNELS)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(audio_int16.tobytes())


def build_mode_sequence(modes: list, total: int) -> list:
    sequence = []
    while len(sequence) < total:
        batch = modes.copy()
        random.shuffle(batch)
        sequence.extend(batch)
    return sequence[:total]


def build_phrase_sequence(phrases: list, total: int) -> list:
    sequence = []
    while len(sequence) < total:
        batch = phrases.copy()
        random.shuffle(batch)
        sequence.extend(batch)
    return sequence[:total]


def run_recording_phase(
    phase_name: str,
    phrases: list,
    modes: list,
    total: int,
    out_dir: Path,
    name_slug: str,
    start_idx: int,
    duration: float,
    is_positive: bool,
) -> tuple:
    """Fuehre eine Aufnahme-Phase durch. Return (end_idx, mode_counts)."""

    mode_sequence = build_mode_sequence(modes, total)
    phrase_sequence = build_phrase_sequence(phrases, total)

    # Subfolder: pos / neg
    sub_dir = out_dir / ("pos" if is_positive else "neg")
    sub_dir.mkdir(parents=True, exist_ok=True)

    prefix = "pos" if is_positive else "neg"

    print()
    print("=" * 60)
    print(f"  PHASE: {phase_name}")
    print(f"  {'POSITIVE Clips (Hey Nox sagen)' if is_positive else 'NEGATIVE Clips (andere Saetze)'}")
    print(f"  Ziel: {total} Clips")
    print(f"  Ordner: {sub_dir.resolve()}")
    print("=" * 60)

    mode_counts = {}
    idx = start_idx

    while idx < start_idx + total:
        mode_id, instruction, min_peak, max_peak, category = mode_sequence[(idx - start_idx) % len(mode_sequence)]
        phrase = phrase_sequence[(idx - start_idx) % len(phrase_sequence)]
        remaining = (start_idx + total) - idx

        print()
        print(f"  Clip {idx - start_idx + 1}/{total} (uebrig: {remaining})")
        print(f"  Sag:       \"{phrase}\"")
        print(f"  Anweisung: {instruction}")

        try:
            user_input = input("  > Enter=aufnehmen, q=beenden, r=neu, s=skip: ").strip().lower()
        except EOFError:
            break

        if user_input == "q":
            print(f"\n  Phase beendet. {idx - start_idx} Clips in dieser Phase.")
            break

        if user_input == "s":
            print("  Uebersprungen.")
            idx += 1
            continue

        if user_input == "r" and idx > start_idx:
            idx -= 1
            last_file = sub_dir / f"{prefix}_{name_slug}_{idx:04d}.wav"
            if last_file.exists():
                last_file.unlink()
            print("  Letzten Clip geloescht, neu aufnehmen:")
            continue

        # Record
        audio = record_clip(duration, SAMPLE_RATE)
        peak = np.max(np.abs(audio))

        if peak < 0.003:
            print(f"  ! Fast Stille (Peak={peak:.3f}) — Clip uebersprungen.")
            print("    Mikrofon an? Stecker geprueft?")
            continue

        # Mode-specific warnings
        if mode_id.startswith("whisper") and peak > 0.35:
            print(f"  ! Das war laut fuer Fluestern (Peak={peak:.3f}). Bitte wirklich FLUESTERN.")
        elif mode_id in ("shout", "very_loud") and peak < 0.15:
            print(f"  ! Das war leise fuer Schreien (Peak={peak:.3f}). Bitte LAUTER!")
        elif mode_id == "loud" and peak < 0.08:
            print(f"  ! Das war normal, nicht laut (Peak={peak:.3f}). Bitte LAUTER!")
        elif mode_id == "far_room" and peak < 0.05:
            print(f"  ! Das war leise fuer Ruefruf (Peak={peak:.3f}). Bitte LAUTER rufen!")
        elif mode_id.startswith("normal") and peak < 0.02:
            print(f"  ! Sehr leise (Peak={peak:.3f}). Naecher ans Mikro oder lauter.")

        # Save
        clip_path = sub_dir / f"{prefix}_{name_slug}_{idx:04d}.wav"
        save_wav(clip_path, audio, SAMPLE_RATE)
        print(f"  OK Gespeichert: {clip_path.name} (Peak={peak:.3f}, Modus={mode_id})")

        mode_counts[mode_id] = mode_counts.get(mode_id, 0) + 1
        idx += 1

    return idx, mode_counts


# ── Aufnahme-Presets ─────────────────────────────────────────────────────────
# (Label, Positive, Negative, geschaetzte Zeit in Minuten)
# Zeit pro Clip: ~2.5s Aufnahme + ~8s Lesen/Vorbereiten/Enter = ~11s
# Gesamt = (pos + neg) * 11s / 60

RECORDING_PRESETS = [
    ("Schnell",     12,   8,   4),    # 20 * 11s  = ~4 min
    ("Klein",       30,  20,   9),    # 50 * 11s  = ~9 min
    ("Mittel",      60,  40,  18),    # 100 * 11s = ~18 min
    ("Gross",      120,  80,  37),    # 200 * 11s = ~37 min
    ("Viel",       180, 120,  55),    # 300 * 11s = ~55 min
    ("Intensiv",   300, 200,  92),    # 500 * 11s = ~92 min
    ("Hardcore",   450, 300, 138),    # 750 * 11s = ~138 min
    ("Profi",      600, 400, 183),    # 1000 * 11s = ~183 min
    ("Extrem",    1200, 800, 367),    # 2000 * 11s = ~367 min
]


def choose_preset() -> tuple:
    """Zeigt ein Menue mit Aufnahme-Mengen und geschätzter Zeit. Gibt (pos, neg) zurueck."""
    print()
    print("=" * 60)
    print("  WIE VIELE AUFNAHMEN MÖCHTEST DU MACHEN?")
    print("  (Positive = 'Hey Nox' sagen, Negative = andere Saetze)")
    print("=" * 60)
    print()
    print(f"  {'#':>3s}  {'Name':<12s}  {'Pos':>5s}  {'Neg':>5s}  {'Gesamt':>7s}  {'Zeit':>10s}")
    print(f"  {'-'*3}  {'-'*12}  {'-'*5}  {'-'*5}  {'-'*7}  {'-'*10}")

    for i, (label, pos, neg, minutes) in enumerate(RECORDING_PRESETS):
        total = pos + neg
        if minutes < 60:
            time_str = f"~{minutes} min"
        else:
            h = minutes // 60
            m = minutes % 60
            time_str = f"~{h}h {m}min"
        print(f"  [{i+1}]  {label:<12s}  {pos:>5d}  {neg:>5d}  {total:>7d}  {time_str:>10s}")

    print()
    print("  Tipp: 'Mittel' (100 Clips) ist ein guter Startpunkt.")
    print("  Mehr Clips = besseres Modell, aber auch mehr Zeit.")
    print()

    while True:
        try:
            choice = input("  Nummer waehlen (1-9): ").strip()
            idx = int(choice) - 1
            if 0 <= idx < len(RECORDING_PRESETS):
                label, pos, neg, minutes = RECORDING_PRESETS[idx]
                if minutes < 60:
                    time_str = f"~{minutes} Minuten"
                else:
                    h = minutes // 60
                    m = minutes % 60
                    time_str = f"~{h} Stunde(n) {m} Minute(n)"
                print(f"\n  Gewaehlt: {label} ({pos + neg} Clips, {time_str})")
                print()
                return pos, neg
            print("  Bitte eine Zahl von 1 bis 9 eingeben.")
        except ValueError:
            print("  Bitte eine gueltige Zahl eingeben.")
        except (EOFError, KeyboardInterrupt):
            print("\n  Abgebrochen.")
            sys.exit(0)


def ask_name() -> str:
    """Fragt interaktiv nach dem Namen des Aufnehmenden."""
    print()
    print("=" * 60)
    print("  WIE HEISST DU?")
    print("  (Dein Name wird fuer die Dateinamen verwendet)")
    print("=" * 60)
    print()
    while True:
        try:
            name = input("  Name: ").strip()
            if name and len(name) >= 2:
                return name
            print("  Bitte einen Namen mit mindestens 2 Zeichen eingeben.")
        except (EOFError, KeyboardInterrupt):
            print("\n  Abgebrochen.")
            sys.exit(0)


def ask_lang() -> str:
    """Fragt interaktiv nach der Sprache."""
    print()
    print("=" * 60)
    print("  WELCHE SPRACHE?")
    print("=" * 60)
    print()
    print("  [1] Deutsch  (Hey Nox, Hallo Nox, ...)")
    print("  [2] English  (Hey Nox, Hi Nox, Hello Nox, ...)")
    print()
    while True:
        try:
            choice = input("  Wahl (1 oder 2): ").strip()
            if choice in ("1", "de", "d", ""):
                return "de"
            elif choice in ("2", "en", "e"):
                return "en"
            print("  Bitte 1 oder 2 eingeben.")
        except (EOFError, KeyboardInterrupt):
            print("\n  Abgebrochen.")
            sys.exit(0)


def main():
    parser = argparse.ArgumentParser(description="Hey Nox Aufnahme-Skript")
    parser.add_argument("--name", type=str, default=None, help="Dein Name (fuer Dateinamen)")
    parser.add_argument("--target", type=int, default=None, help="Positive Clips (ueberschreibt Menue)")
    parser.add_argument("--neg-target", type=int, default=None, help="Negative Clips (ueberschreibt Menue)")
    parser.add_argument("--output", type=str, default=None, help="Output Ordner")
    parser.add_argument("--duration", type=float, default=2.5, help="Aufnahmedauer in Sekunden")
    parser.add_argument("--lang", type=str, default=None, choices=["de", "en"], help="Sprache: de oder en")
    args = parser.parse_args()

    # ── Banner ──
    print()
    print("=" * 60)
    print("  Hey Nox Wake-Word Aufnahme-Skript")
    print("=" * 60)

    # ── Name (interaktiv oder CLI) ──
    name = args.name if args.name else ask_name()

    # ── Sprache (interaktiv oder CLI) ──
    lang = args.lang if args.lang else ask_lang()

    # ── Anzahl waehlen (Menue oder CLI-Argument) ──
    if args.target is not None and args.neg_target is not None:
        total_pos = args.target
        total_neg = args.neg_target
        print(f"  CLI-Modus: {total_pos} Positive, {total_neg} Negative")
    else:
        total_pos, total_neg = choose_preset()

    phrases_pos = PHRASES_POS_DE if lang == "de" else PHRASES_POS_EN
    phrases_neg = NEGATIVE_PHRASES_DE if lang == "de" else NEGATIVE_PHRASES_EN
    lang_label = "Deutsch" if lang == "de" else "English (US)"

    if args.output:
        out_dir = Path(args.output)
    else:
        # Basis-Verzeichnis: dort wo die .exe oder das Skript liegt
        # Bei Nuitka --onefile zeigt sys.executable auf ein Temp-Verzeichnis,
        # daher nutzen wir sys.argv[0] (Pfad der echten .exe).
        if getattr(sys, "frozen", False) or "__compiled__" in dir(sys.modules.get("__main__", object())):
            base_dir = Path(sys.argv[0]).resolve().parent
        else:
            base_dir = Path(__file__).resolve().parent
        out_dir = base_dir / "hey_nox_recordings" / name.lower().replace(" ", "_")
    out_dir.mkdir(parents=True, exist_ok=True)

    pos_dir = out_dir / "pos"
    neg_dir = out_dir / "neg"
    pos_dir.mkdir(parents=True, exist_ok=True)
    neg_dir.mkdir(parents=True, exist_ok=True)

    existing_pos = list(pos_dir.glob("*.wav"))
    existing_neg = list(neg_dir.glob("*.wav"))

    print()
    print("=" * 60)
    print(f"  Hey Nox Aufnahme-Skript ({lang_label})")
    print(f"  Name: {name}")
    print(f"  Phase 1: {total_pos} Positive Clips ('Hey Nox')")
    print(f"  Phase 2: {total_neg} Negative Clips (andere Saetze)")
    print(f"  Ordner: {out_dir.resolve()}")
    if existing_pos:
        print(f"  Bereits vorhanden: {len(existing_pos)} Positive, {len(existing_neg)} Negative")
    print("=" * 60)

    # ── Umgebungsfragebogen ──
    env = environment_questionnaire()

    # ── Modi auswaehlen ──
    selected_modes = select_modes(env)

    print()
    print("=" * 60)
    print(f"  {len(selected_modes)} Aufnahme-Modi ausgewaehlt:")
    for mode in selected_modes:
        mode_id = mode[0]
        cat = mode[4]
        label = {"base": "Basis", "loud": "Laut", "rooms": "Raum", "bg": "BG", "props": "Prop"}[cat]
        print(f"    [{label:5s}] {mode_id}")
    print()

    print("=" * 60)
    print()
    print("  ANLEITUNG:")
    print("  PHASE 1: Du sagst 'Hey Nox' in vielen Varianten")
    print("  PHASE 2: Du sagst andere Saetze (das Skript zeigt an, was)")
    print("  Bei beiden Phasen gelten die gleichen Aufnahme-Modi")
    print()
    print("  Tasten:")
    print("    Enter  = Aufnahme starten")
    print("    q      = Beenden (Phase/gesamt)")
    print("    r      = Letzten Clip neu aufnehmen")
    print("    s      = Clip ueberspringen")
    print()
    print("  WICHTIG:")
    print("  - Mach Pausen, wenn du heiser wirst")
    print("  - Bei Hintergrundgeraeuschen: wirklich anmachen!")
    print("  - Negative Clips sind genauso wichtig wie Positive!")
    print()

    # List input devices
    devices = sd.query_devices()
    print("  Verfuegbare Mikrofone:")
    for i, d in enumerate(devices):
        if d["max_input_channels"] > 0:
            print(f"    [{i}] {d['name']} ({d['max_input_channels']}ch, {d['default_samplerate']}Hz)")
    print()

    default_input = sd.default.device[0]
    if default_input is not None and default_input >= 0:
        dev_name = sd.query_devices(default_input)["name"]
        print(f"  Aktuelles Mikrofon: [{default_input}] {dev_name}")
    else:
        print("  WARNUNG: Kein Standard-Mikrofon gefunden!")
    print()

    # Test recording
    print("  TEST: Druecke Enter fuer eine Testaufnahme (einfach normal reden)...")
    input()
    test_audio = record_clip(2.0, SAMPLE_RATE)
    test_peak = np.max(np.abs(test_audio))
    print(f"  Lautstaerke: Peak={test_peak:.3f}")
    if test_peak < 0.05:
        print("  ! WARNUNG: Sehr leise! Mikrofon pruefen oder naeher rangehen.")
    else:
        print("  Gut! Mikrofon funktioniert.")
    print()

    name_slug = name.lower().replace(" ", "_")
    all_mode_counts = {}

    # ── Phase 1: Positive ──
    end_idx, pos_counts = run_recording_phase(
        phase_name="Positive Clips",
        phrases=phrases_pos,
        modes=selected_modes,
        total=total_pos,
        out_dir=out_dir,
        name_slug=name_slug,
        start_idx=len(existing_pos),
        duration=args.duration,
        is_positive=True,
    )
    all_mode_counts.update(pos_counts)

    # ── Phase 2: Negative ──
    print()
    print("  Wechsel zu Phase 2 (Negative Clips)...")
    print("  Hier sagst du ANDERE Saetze, nicht 'Hey Nox'.")
    print("  Das Skript zeigt dir an, was du sagen sollst.")
    print()

    end_idx_neg, neg_counts = run_recording_phase(
        phase_name="Negative Clips",
        phrases=phrases_neg,
        modes=selected_modes,
        total=total_neg,
        out_dir=out_dir,
        name_slug=name_slug,
        start_idx=len(existing_neg),
        duration=args.duration,
        is_positive=False,
    )
    for k, v in neg_counts.items():
        all_mode_counts[k] = all_mode_counts.get(k, 0) + v

    # ── Zusammenfassung ──
    final_pos = len(list(pos_dir.glob("*.wav")))
    final_neg = len(list(neg_dir.glob("*.wav")))

    print()
    print("=" * 60)
    print(f"  FERTIG!")
    print(f"  Positive Clips: {final_pos}")
    print(f"  Negative Clips: {final_neg}")
    print(f"  Gesamt:         {final_pos + final_neg}")
    print(f"  Ordner: {out_dir.resolve()}")
    print()
    print("  Modi-Verteilung (beide Phasen):")
    for mode_id, count in sorted(all_mode_counts.items(), key=lambda x: -x[1]):
        print(f"    {mode_id:20s} {count}x")
    print()
    print("  Naechste Schritte:")
    print("  1. Ordner als ZIP packen (inkl. pos/ und neg/ Unterordner)")
    print("  2. An florianwdh ueber Discord schicken")
    print("  3. florianwdh trainiert neues Model mit allen Aufnahmen")
    print("=" * 60)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print()
        print("=" * 60)
        print(f"  FEHLER: {e}")
        print("=" * 60)
    finally:
        print()
        print("  Druecke Enter zum Beenden...")
        try:
            input()
        except (EOFError, KeyboardInterrupt):
            pass
