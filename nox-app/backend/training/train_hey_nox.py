"""Train a custom multi-language 'Hey Nox' wake word model using openWakeWord.

Generates synthetic 'Hey Nox' clips using Edge TTS in all 27 supported languages,
with male and female voices per language for accent diversity. Then augments,
extracts melspectrogram features, trains a DNN, and exports to ONNX.

Usage:
    cd nox-app/backend
    python train_hey_nox.py [--clips-per-lang 200] [--neg-clips 3000] [--steps 10000]

Requirements:
    pip install edge-tts openwakeword torch scipy soundfile numpy
"""

import argparse
import asyncio
import io
import os
import random
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np


# ---------------------------------------------------------------------------
# Edge TTS voices for all 27 supported languages: (voice_id, gender)
# ---------------------------------------------------------------------------

LANGUAGES = {
    "de_DE": [("de-DE-KatjaNeural", "female"), ("de-DE-ConradNeural", "male"), ("de-DE-FlorianMultilingualNeural", "male"), ("de-DE-SeraphinaMultilingualNeural", "female")],
    "en_US": [("en-US-AriaNeural", "female"), ("en-US-GuyNeural", "male"), ("en-US-JennyNeural", "female"), ("en-US-BrianNeural", "male"), ("en-US-EmmaNeural", "female")],
    "en_GB": [("en-GB-SoniaNeural", "female"), ("en-GB-RyanNeural", "male"), ("en-GB-LibbyNeural", "female"), ("en-GB-ThomasNeural", "male")],
    "fr_FR": [("fr-FR-DeniseNeural", "female"), ("fr-FR-HenriNeural", "male")],
    "es_ES": [("es-ES-ElviraNeural", "female"), ("es-ES-AlvaroNeural", "male")],
    "es_MX": [("es-MX-DaliaNeural", "female"), ("es-MX-JorgeNeural", "male")],
    "it_IT": [("it-IT-ElsaNeural", "female"), ("it-IT-DiegoNeural", "male")],
    "ja_JP": [("ja-JP-NanamiNeural", "female"), ("ja-JP-KeitaNeural", "male")],
    "zh_CN": [("zh-CN-XiaoxiaoNeural", "female"), ("zh-CN-YunxiNeural", "male")],
    "nl_NL": [("nl-NL-ColetteNeural", "female"), ("nl-NL-FennaNeural", "female"), ("nl-NL-MaartenNeural", "male")],
    "pl_PL": [("pl-PL-MarekNeural", "male")],
    "pt_BR": [("pt-BR-FranciscaNeural", "female"), ("pt-BR-AntonioNeural", "male")],
    "pt_PT": [("pt-PT-RaquelNeural", "female"), ("pt-PT-DuarteNeural", "male")],
    "ru_RU": [("ru-RU-SvetlanaNeural", "female"), ("ru-RU-DmitryNeural", "male")],
    "tr_TR": [("tr-TR-EmelNeural", "female"), ("tr-TR-AhmetNeural", "male")],
    "sv_SE": [("sv-SE-SofieNeural", "female"), ("sv-SE-MattiasNeural", "male")],
    "da_DK": [("da-DK-ChristelNeural", "female"), ("da-DK-JeppeNeural", "male")],
    "cs_CZ": [("cs-CZ-VlastaNeural", "female"), ("cs-CZ-AntoninNeural", "male")],
    "fi_FI": [("fi-FI-NooraNeural", "female"), ("fi-FI-HarriNeural", "male")],
    "uk_UA": [("uk-UA-PolinaNeural", "female"), ("uk-UA-OstapNeural", "male")],
    "vi_VN": [("vi-VN-HoaiMyNeural", "female"), ("vi-VN-NamMinhNeural", "male")],
    "ar_JO": [("ar-JO-TaimNeural", "male")],
    "hu_HU": [("hu-HU-NoemiNeural", "female"), ("hu-HU-TamasNeural", "male")],
    "ro_RO": [("ro-RO-AlinaNeural", "female"), ("ro-RO-EmilNeural", "male")],
    "sk_SK": [("sk-SK-ViktoriaNeural", "female"), ("sk-SK-LukasNeural", "male")],
    "el_GR": [("el-GR-AthinaNeural", "female"), ("el-GR-NestorasNeural", "male")],
    "hi": [("hi-IN-SwaraNeural", "female"), ("hi-IN-MadhurNeural", "male")],
}


# ---------------------------------------------------------------------------
# Wake phrases per language — "Hey Nox" (universal) + language-specific greeting
# ---------------------------------------------------------------------------

WAKE_PHRASES = {
    "de_DE": ["Hey Nox", "Hallo Nox", "Hey, Nox", "Hey Nox!"],
    "en_US": ["Hey Nox", "Hi Nox", "Hello Nox", "Hey, Nox"],
    "en_GB": ["Hey Nox", "Hi Nox", "Hello Nox", "Hey, Nox"],
    "fr_FR": ["Hey Nox", "Salut Nox", "Bonjour Nox", "Hey, Nox"],
    "es_ES": ["Hey Nox", "Hola Nox", "Oye Nox", "Hey, Nox"],
    "es_MX": ["Hey Nox", "Hola Nox", "Oye Nox", "Hey, Nox"],
    "it_IT": ["Hey Nox", "Ciao Nox", "Hey, Nox"],
    "ja_JP": ["Hey Nox", "\u30d8\u30a4 \u30ce\u30c3\u30af\u30b9", "Hey, Nox"],
    "zh_CN": ["Hey Nox", "\u4f60\u597d Nox", "Hey, Nox"],
    "nl_NL": ["Hey Nox", "Hallo Nox", "Hoi Nox", "Hey, Nox"],
    "pl_PL": ["Hey Nox", "Cze\u015b\u0107 Nox", "Hej Nox", "Hey, Nox"],
    "pt_BR": ["Hey Nox", "Ol\u00e1 Nox", "Oi Nox", "Hey, Nox"],
    "pt_PT": ["Hey Nox", "Ol\u00e1 Nox", "Hey, Nox"],
    "ru_RU": ["Hey Nox", "\u041f\u0440\u0438\u0432\u0435\u0442 Nox", "\u0425\u0435\u0439 Nox", "Hey, Nox"],
    "tr_TR": ["Hey Nox", "Selam Nox", "Merhaba Nox", "Hey, Nox"],
    "sv_SE": ["Hey Nox", "Hej Nox", "Hall\u00e5 Nox", "Hey, Nox"],
    "da_DK": ["Hey Nox", "Hej Nox", "Hall\u00f8j Nox", "Hey, Nox"],
    "cs_CZ": ["Hey Nox", "Ahoj Nox", "Hej Nox", "Hey, Nox"],
    "fi_FI": ["Hey Nox", "Hei Nox", "Moi Nox", "Hey, Nox"],
    "uk_UA": ["Hey Nox", "\u041f\u0440\u0438\u0432\u0456\u0442 Nox", "\u0413\u0435\u0439 Nox", "Hey, Nox"],
    "vi_VN": ["Hey Nox", "Xin ch\u00e0o Nox", "Ch\u00e0o Nox", "Hey, Nox"],
    "ar_JO": ["Hey Nox", "\u0645\u0631\u062d\u0628\u0627 Nox", "Hey, Nox"],
    "hu_HU": ["Hey Nox", "Szia Nox", "Hell\u00f3 Nox", "Hey, Nox"],
    "ro_RO": ["Hey Nox", "Salut Nox", "Bun\u0103 Nox", "Hey, Nox"],
    "sk_SK": ["Hey Nox", "Ahoj Nox", "Hej Nox", "Hey, Nox"],
    "el_GR": ["Hey Nox", "\u0393\u03b5\u03b9\u03b1 Nox", "\u0395, Nox", "Hey, Nox"],
    "hi": ["Hey Nox", "\u0928\u092e\u0938\u094d\u0924\u0947 Nox", "\u0939\u0947 Nox", "Hey, Nox"],
}

def _resample_to_16k(audio: np.ndarray, sr_in: int) -> np.ndarray:
    """Resample audio to 16kHz using scipy."""
    if sr_in == 16000:
        return audio
    from scipy.signal import resample_poly
    return resample_poly(audio, 16000, sr_in)


def _save_wav(path: Path, audio: np.ndarray, sr: int = 16000) -> None:
    """Save float32 audio [-1, 1] as 16-bit PCM WAV."""
    audio_int16 = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(audio_int16.tobytes())


async def _edge_tts_synthesize(voice_id: str, text: str) -> tuple[np.ndarray, int] | None:
    """Synthesize text with Edge TTS, return (audio_float32, sample_rate)."""
    import edge_tts

    communicate = edge_tts.Communicate(text, voice_id)
    mp3_buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            mp3_buf.write(chunk["data"])

    mp3_data = mp3_buf.getvalue()
    if not mp3_data:
        return None

    import soundfile as sf
    mp3_buf.seek(0)
    try:
        audio, sr = sf.read(mp3_buf, dtype="float32")
    except Exception:
        import librosa
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp.write(mp3_data)
            tmp_path = tmp.name
        try:
            audio, sr = librosa.load(tmp_path, sr=None)
        finally:
            os.unlink(tmp_path)

    if len(audio.shape) > 1:
        audio = audio[:, 0]
    return audio, sr


def generate_multilang_clips(output_dir: Path, clips_per_lang: int = 200) -> int:
    """Generate 'Hey Nox' clips in all 27 languages using Edge TTS.

    Uses male and female voices per language. Each voice generates
    clips with different wake phrases and rate/pitch variations.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    total = 0
    for lang_code, voices in LANGUAGES.items():
        phrases = WAKE_PHRASES.get(lang_code, ["Hey Nox"])
        clips_this_lang = 0
        per_voice = max(1, clips_per_lang // len(voices))

        for voice_id, gender in voices:
            for i in range(per_voice):
                phrase = random.choice(phrases)
                # Edge TTS rate/pitch variation
                rate = random.choice(["-20%", "-10%", "+0%", "+10%", "+20%"])
                pitch = random.choice(["-10Hz", "+0Hz", "+10Hz", "+20Hz"])

                try:
                    import edge_tts
                    communicate = edge_tts.Communicate(phrase, voice_id, rate=rate, pitch=pitch)
                    mp3_buf = io.BytesIO()
                    # Run in event loop
                    loop = asyncio.new_event_loop()
                    try:
                        loop.run_until_complete(
                            _stream_edge_tts(communicate, mp3_buf)
                        )
                    finally:
                        loop.close()

                    mp3_data = mp3_buf.getvalue()
                    if not mp3_data:
                        continue

                    import soundfile as sf
                    mp3_buf.seek(0)
                    try:
                        audio, sr = sf.read(mp3_buf, dtype="float32")
                    except Exception:
                        import librosa
                        import tempfile
                        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                            tmp.write(mp3_data)
                            tmp_path = tmp.name
                        try:
                            audio, sr = librosa.load(tmp_path, sr=None)
                        finally:
                            os.unlink(tmp_path)

                    if len(audio.shape) > 1:
                        audio = audio[:, 0]

                    audio = _resample_to_16k(audio, sr)

                    clip_path = output_dir / f"{lang_code}_{gender}_{total:05d}.wav"
                    _save_wav(clip_path, audio)
                    total += 1
                    clips_this_lang += 1
                except Exception as exc:
                    print(f"  WARN: Edge TTS failed for {voice_id} ({lang_code}): {exc}")
                    continue

        print(f"  {lang_code}: {clips_this_lang} clips")

    print(f"Generated {total} positive clips across {len(LANGUAGES)} languages")
    return total


async def _stream_edge_tts(communicate, buf: io.BytesIO) -> None:
    """Stream Edge TTS audio into buffer."""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])


def generate_negative_clips(output_dir: Path, num_clips: int = 3000, duration_sec: float = 2.0) -> None:
    """Generate diverse negative clips: noise, tones, speech-like patterns, music-like."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    sr = 16000
    for i in range(num_clips):
        clip_type = random.choice([
            "white_noise", "pink_noise", "tone", "multi_tone",
            "silence_bursts", "speech_like", "music_like", "clicks",
            "low_rumble", "high_hiss",
        ])
        n = int(duration_sec * sr)

        if clip_type == "white_noise":
            audio = np.random.randn(n).astype(np.float32) * 0.1
        elif clip_type == "pink_noise":
            # Simple pink noise approximation
            white = np.random.randn(n).astype(np.float32)
            audio = np.cumsum(white)
            audio = audio / (np.max(np.abs(audio)) + 1e-8) * 0.1
        elif clip_type == "tone":
            freq = random.uniform(100, 2000)
            t = np.arange(n) / sr
            audio = (np.sin(2 * np.pi * freq * t) * 0.15).astype(np.float32)
        elif clip_type == "multi_tone":
            t = np.arange(n) / sr
            f1 = random.uniform(200, 800)
            f2 = random.uniform(800, 2000)
            audio = (np.sin(2 * np.pi * f1 * t) * 0.08 + np.sin(2 * np.pi * f2 * t) * 0.06).astype(np.float32)
        elif clip_type == "silence_bursts":
            audio = np.zeros(n, dtype=np.float32)
            for _ in range(random.randint(1, 4)):
                start = random.randint(0, max(0, n - sr // 2))
                length = random.randint(sr // 10, sr // 2)
                end = min(start + length, n)
                audio[start:end] = np.random.randn(end - start).astype(np.float32) * 0.05
        elif clip_type == "speech_like":
            audio = np.random.randn(n).astype(np.float32) * 0.04
            t = np.arange(n) / sr
            am = np.sin(2 * np.pi * random.uniform(2, 8) * t)
            audio *= (0.3 + 0.7 * am)
        elif clip_type == "music_like":
            t = np.arange(n) / sr
            notes = [random.uniform(200, 800) for _ in range(random.randint(2, 5))]
            audio = np.zeros(n, dtype=np.float32)
            seg_len = n // len(notes)
            for j, f in enumerate(notes):
                start = j * seg_len
                end = min(start + seg_len, n)
                audio[start:end] = np.sin(2 * np.pi * f * t[:end - start]) * 0.1
        elif clip_type == "clicks":
            audio = np.zeros(n, dtype=np.float32)
            for _ in range(random.randint(2, 8)):
                pos = random.randint(0, n - 1)
                audio[pos] = random.uniform(0.3, 0.8)
        elif clip_type == "low_rumble":
            t = np.arange(n) / sr
            audio = (np.sin(2 * np.pi * random.uniform(30, 80) * t) * 0.15).astype(np.float32)
        else:  # high_hiss
            audio = np.random.randn(n).astype(np.float32) * 0.03
            # High-pass-ish: subtract moving average
            kernel = 50
            avg = np.convolve(audio, np.ones(kernel) / kernel, mode="same")
            audio = audio - avg

        clip_path = output_dir / f"neg_{i:05d}.wav"
        _save_wav(clip_path, audio)

    print(f"Generated {num_clips} negative clips")


def _load_clips_as_array(clip_paths: list[str], target_len: int) -> np.ndarray:
    """Load WAV files as int16 numpy array, padded/truncated to target_len."""
    clips = []
    for cp in clip_paths:
        with wave.open(cp, "rb") as w:
            frames = w.readframes(w.getnframes())
            audio = np.frombuffer(frames, dtype=np.int16)
        if len(audio) < target_len:
            audio = np.pad(audio, (0, target_len - len(audio)))
        else:
            audio = audio[:target_len]
        clips.append(audio)
    return np.array(clips, dtype=np.int16)


def train_model(
    clips_per_lang: int = 200,
    neg_clips: int = 3000,
    max_steps: int = 10000,
    output_path: Path | None = None,
) -> Path:
    """Main multi-language training function.

    Steps:
    1. Generate 'Hey Nox' clips in all 27 languages via Edge TTS
    2. Generate diverse negative clips
    3. Augment positive clips (pitch shift, EQ, noise, distortion)
    4. Extract openWakeWord melspectrogram features
    5. Train DNN model with false-positive validation
    6. Export to ONNX
    """
    import torchaudio
    import soundfile as sf
    def _sf_load(uri, *args, **kwargs):
        data, sr = sf.read(uri, dtype="float32")
        if len(data.shape) == 1:
            data = data[np.newaxis, :]
        else:
            data = data.T
        return torch.from_numpy(data), sr
    torchaudio.load = _sf_load

    from openwakeword.train import Model, AudioFeatures
    from openwakeword.data import augment_clips
    import torch
    from torch.utils.data import DataLoader, TensorDataset

    work_dir = Path(tempfile.mkdtemp(prefix="hey_nox_train_"))
    print(f"Working directory: {work_dir}")

    # --- Step 1: Generate multi-language positive clips ---
    pos_dir = work_dir / "positive"
    neg_dir = work_dir / "negative"
    print(f"\n[1/6] Generating positive clips in {len(LANGUAGES)} languages ({clips_per_lang}/lang)...")
    generate_multilang_clips(pos_dir, clips_per_lang=clips_per_lang)

    # --- Step 2: Generate negative clips ---
    print(f"\n[2/6] Generating {neg_clips} negative clips...")
    generate_negative_clips(neg_dir, num_clips=neg_clips)

    # --- Step 3: Augment positive clips ---
    pos_clips = [str(p) for p in pos_dir.glob("*.wav")]
    print(f"\n[3/6] Augmenting {len(pos_clips)} positive clips...")
    augmented = augment_clips(
        clip_paths=pos_clips,
        total_length=16000 * 2,
        sr=16000,
        augmentation_probabilities={
            "SevenBandParametricEQ": 0.4,
            "TanhDistortion": 0.2,
            "PitchShift": 0.4,
            "BandStopFilter": 0.3,
            "AddColoredNoise": 0.4,
            "AddBackgroundNoise": 0.0,
            "Gain": 1.0,
            "RIR": 0.0,
        },
        background_clip_paths=[],
        RIR_paths=[],
    )

    aug_dir = work_dir / "augmented"
    aug_dir.mkdir(parents=True, exist_ok=True)
    augmented_list = list(augmented)
    print(f"  Augmented clips: {len(augmented_list)}")
    for i, clip in enumerate(augmented_list):
        clip_path = aug_dir / f"aug_{i:05d}.wav"
        clip_np = clip.numpy() if hasattr(clip, "numpy") else np.array(clip)
        _save_wav(clip_path, clip_np.astype(np.float32))

    # --- Step 4: Extract features ---
    print("\n[4/6] Extracting melspectrogram features...")
    af = AudioFeatures()
    target_length = 16000 * 2

    all_pos_clips = pos_clips + [str(p) for p in aug_dir.glob("*.wav")]
    random.shuffle(all_pos_clips)

    split = int(len(all_pos_clips) * 0.85)
    train_clips_arr = _load_clips_as_array(all_pos_clips[:split], target_length)
    val_clips_arr = _load_clips_as_array(all_pos_clips[split:], target_length)

    X_train = af.embed_clips(train_clips_arr, batch_size=32, ncpu=1)
    X_val = af.embed_clips(val_clips_arr, batch_size=32, ncpu=1)
    print(f"  X_train: {X_train.shape}, X_val: {X_val.shape}")

    # Negative data for false-positive validation
    all_neg_clips = [str(p) for p in neg_dir.glob("*.wav")]
    random.shuffle(all_neg_clips)
    neg_clips_arr = _load_clips_as_array(all_neg_clips[:800], target_length)
    fp_val_data = af.embed_clips(neg_clips_arr, batch_size=32, ncpu=1)
    print(f"  FP validation data: {fp_val_data.shape}")

    # --- Step 5: Train model ---
    print(f"\n[5/6] Training DNN model ({max_steps} steps)...")
    model = Model(n_classes=1, input_shape=(16, 96), model_type="dnn", layer_dim=32)

    n_neg_train = min(400, len(neg_clips_arr))
    train_labels = np.concatenate([
        np.ones(len(X_train)),
        np.zeros(n_neg_train),
    ])
    train_features = np.concatenate([X_train, fp_val_data[:n_neg_train]])

    val_labels = np.concatenate([
        np.ones(len(X_val)),
        np.zeros(min(200, len(fp_val_data))),
    ])
    val_features = np.concatenate([X_val, fp_val_data[:200]])

    train_dataset = TensorDataset(
        torch.from_numpy(train_features).float(),
        torch.from_numpy(train_labels).float(),
    )
    val_dataset = TensorDataset(
        torch.from_numpy(val_features).float(),
        torch.from_numpy(val_labels).float(),
    )

    train_loader = DataLoader(train_dataset, batch_size=32, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=len(val_labels))

    model.train_model(
        X=train_loader,
        max_steps=max_steps,
        warmup_steps=max(500, max_steps // 10),
        hold_steps=max(2000, max_steps // 2),
        X_val=val_loader,
        false_positive_val_data=torch.from_numpy(fp_val_data).float(),
        negative_weight_schedule=np.linspace(1, 500, max_steps).tolist(),
        val_steps=np.linspace(max_steps - max(1000, max_steps // 5), max_steps, 20).astype(np.int64).tolist(),
        lr=0.0001,
        val_set_hrs=11.3,
    )

    # --- Step 6: Export to ONNX ---
    print("\n[6/6] Exporting ONNX model...")
    if output_path is None:
        candidates = [
            Path(__file__).parent / "models" / "hey_nox.onnx",
            Path(r"y:\Projekte\Coding\Nox\nox-app\backend\models\hey_nox.onnx"),
        ]
        env_models = os.environ.get("NOX_MODELS_DIR")
        if env_models:
            candidates.insert(0, Path(env_models) / "hey_nox.onnx")
        output_path = candidates[0]

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    model.export_to_onnx(str(output_path), class_mapping="hey_nox")
    print(f"\n✓ Model exported to: {output_path}")
    print(f"  Total positive clips: {len(all_pos_clips)}")
    print(f"  Total negative clips: {len(all_neg_clips)}")
    print(f"  Languages: {len(LANGUAGES)}")
    print(f"  Training steps: {max_steps}")

    return output_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train multi-language 'Hey Nox' wake word model")
    parser.add_argument("--clips-per-lang", type=int, default=200, help="Positive clips per language (default: 200)")
    parser.add_argument("--neg-clips", type=int, default=3000, help="Number of negative clips (default: 3000)")
    parser.add_argument("--steps", type=int, default=10000, help="Training steps (default: 10000)")
    parser.add_argument("--output", type=str, default=None, help="Output ONNX path (default: models/hey_nox.onnx)")
    args = parser.parse_args()

    out = Path(args.output) if args.output else None
    train_model(
        clips_per_lang=args.clips_per_lang,
        neg_clips=args.neg_clips,
        max_steps=args.steps,
        output_path=out,
    )
