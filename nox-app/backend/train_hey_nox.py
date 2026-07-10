"""Train a custom 'Hey Nox' wake word model using openWakeWord.

This script:
1. Generates synthetic 'Hey Nox' clips using Piper TTS
2. Augments the clips for more variety
3. Extracts openWakeWord features
4. Trains a small DNN model
5. Exports to ONNX
"""

import os
import sys
import wave
import io
import random
import tempfile
import numpy as np
from pathlib import Path

# Add backend app to path
sys.path.insert(0, str(Path(__file__).parent / "app"))

def generate_piper_clips(output_dir, num_clips=500):
    """Generate synthetic 'Hey Nox' clips using Piper TTS."""
    from piper import PiperVoice
    
    # Try multiple locations for the Piper model
    candidates = [
        Path(__file__).parent / "models" / "piper-models" / "de_DE-thorsten-medium.onnx",
        Path(__file__).parent / "dist-backend" / "app" / "models" / "piper-models" / "de_DE-thorsten-medium.onnx",
        Path(r"z:\Projekte\Coding\Nox\nox-app\dist\win-unpacked\resources\backend\models\piper-models\de_DE-thorsten-medium.onnx"),
    ]
    env_models = os.environ.get("NOX_MODELS_DIR")
    if env_models:
        candidates.insert(0, Path(env_models) / "piper-models" / "de_DE-thorsten-medium.onnx")
        candidates.insert(1, Path(env_models) / "de_DE-thorsten-medium.onnx")
    
    piper_model = None
    for c in candidates:
        if c.exists() and c.with_suffix(".onnx.json").exists():
            piper_model = c
            break
    if piper_model is None:
        # Use the first that exists even without json
        for c in candidates:
            if c.exists():
                piper_model = c
                break
    if piper_model is None:
        raise FileNotFoundError(f"Piper model not found in any of: {candidates}")
    
    print(f"Loading Piper model: {piper_model}")
    voice = PiperVoice.load(str(piper_model))
    
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    phrases = ["Hey Nox", "hey nox", "Hey Nox!", "Hey, Nox"]
    
    for i in range(num_clips):
        phrase = random.choice(phrases)
        length_scale = random.uniform(0.7, 1.3)
        noise_scale = random.uniform(0.0, 0.8)
        noise_w = random.uniform(0.0, 0.6)
        
        buf = io.BytesIO()
        with wave.open(buf, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(22050)
            voice.synthesize(phrase, w, length_scale=length_scale, 
                           noise_scale=noise_scale, noise_w=noise_w)
        
        buf.seek(0)
        with wave.open(buf, 'rb') as r:
            frames = r.readframes(r.getnframes())
            audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32767.0
        
        # Resample from 22050 to 16000
        from scipy.signal import resample_poly
        audio = resample_poly(audio, 16000, 22050)
        
        # Save as 16-bit PCM wav at 16kHz
        clip_path = output_dir / f"clip_{i:04d}.wav"
        with wave.open(str(clip_path), 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes((audio * 32767).astype(np.int16).tobytes())
    
    print(f"Generated {num_clips} clips in {output_dir}")


def generate_negative_clips(output_dir, num_clips=1000, duration_sec=2.0):
    """Generate negative clips (noise, random sounds) for training."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    sr = 16000
    for i in range(num_clips):
        # Generate various types of negative audio
        clip_type = random.choice(['noise', 'tone', 'silence_with_noise', 'random_speech_like'])
        n_samples = int(duration_sec * sr)
        
        if clip_type == 'noise':
            audio = np.random.randn(n_samples).astype(np.float32) * 0.1
        elif clip_type == 'tone':
            freq = random.uniform(100, 2000)
            t = np.arange(n_samples) / sr
            audio = (np.sin(2 * np.pi * freq * t) * 0.2).astype(np.float32)
        elif clip_type == 'silence_with_noise':
            audio = np.zeros(n_samples, dtype=np.float32)
            # Add some random noise bursts
            for _ in range(random.randint(1, 3)):
                start = random.randint(0, n_samples - sr // 2)
                length = random.randint(sr // 10, sr // 2)
                audio[start:start+length] = np.random.randn(length).astype(np.float32) * 0.05
        else:
            # Random speech-like pattern
            audio = np.random.randn(n_samples).astype(np.float32) * 0.05
            # Add some amplitude modulation
            t = np.arange(n_samples) / sr
            am = np.sin(2 * np.pi * random.uniform(2, 8) * t)
            audio *= (0.5 + 0.5 * am)
        
        clip_path = output_dir / f"neg_{i:04d}.wav"
        with wave.open(str(clip_path), 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes((audio * 32767).astype(np.int16).tobytes())
    
    print(f"Generated {num_clips} negative clips in {output_dir}")


def train_model():
    """Main training function."""
    from openwakeword.train import Model, AudioFeatures
    from openwakeword.data import augment_clips
    import torch
    
    work_dir = Path(tempfile.mkdtemp(prefix="hey_nox_train_"))
    print(f"Working directory: {work_dir}")
    
    # Step 1: Generate clips
    pos_dir = work_dir / "positive"
    neg_dir = work_dir / "negative"
    
    generate_piper_clips(pos_dir, num_clips=500)
    generate_negative_clips(neg_dir, num_clips=2000)
    
    # Step 2: Augment positive clips
    aug_dir = work_dir / "augmented"
    aug_dir.mkdir(parents=True, exist_ok=True)
    
    pos_clips = [str(p) for p in pos_dir.glob("*.wav")]
    neg_clips_for_aug = [str(p) for p in neg_dir.glob("*.wav")][:200]  # Use some as background
    
    print("Augmenting clips...")
    augmented = augment_clips(
        clip_paths=pos_clips,
        total_length=16000 * 2,  # 2 second clips
        sr=16000,
        augmentation_probabilities={
            'SevenBandParametricEQ': 0.3,
            'TanhDistortion': 0.2,
            'PitchShift': 0.3,
            'BandStopFilter': 0.2,
            'AddColoredNoise': 0.3,
            'AddBackgroundNoise': 0.0,
            'Gain': 1.0,
            'RIR': 0.0,
        },
        background_clip_paths=[],
        RIR_paths=[],
    )
    
    # Save augmented clips
    augmented_list = list(augmented)
    print(f"Augmented clips: {len(augmented_list)}")
    for i, clip in enumerate(augmented_list):
        clip_path = aug_dir / f"aug_{i:04d}.wav"
        clip_np = clip.numpy() if hasattr(clip, 'numpy') else np.array(clip)
        with wave.open(str(clip_path), 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes((clip_np.astype(np.float32) * 32767).astype(np.int16).tobytes())
    
    # Step 3: Extract features
    print("Extracting features...")
    af = AudioFeatures()
    
    all_pos_clips = pos_clips + [str(p) for p in aug_dir.glob("*.wav")]
    random.shuffle(all_pos_clips)
    
    # Load clips as numpy array with consistent length (2 seconds = 32000 samples at 16kHz)
    target_length = 16000 * 2
    
    def load_clips_as_array(clip_paths, target_len):
        clips = []
        for cp in clip_paths:
            with wave.open(cp, 'rb') as w:
                frames = w.readframes(w.getnframes())
                audio = np.frombuffer(frames, dtype=np.int16)
            # Pad or truncate to target length
            if len(audio) < target_len:
                audio = np.pad(audio, (0, target_len - len(audio)))
            else:
                audio = audio[:target_len]
            clips.append(audio)
        return np.array(clips, dtype=np.int16)
    
    # Split into train/val
    split = int(len(all_pos_clips) * 0.8)
    train_clips_arr = load_clips_as_array(all_pos_clips[:split], target_length)
    val_clips_arr = load_clips_as_array(all_pos_clips[split:], target_length)
    
    X_train = af.embed_clips(train_clips_arr, batch_size=32, ncpu=1)
    X_val = af.embed_clips(val_clips_arr, batch_size=32, ncpu=1)
    
    print(f"X_train shape: {X_train.shape}")
    print(f"X_val shape: {X_val.shape}")
    
    # Step 4: Prepare negative data for false positive validation
    all_neg_clips = [str(p) for p in neg_dir.glob("*.wav")]
    neg_clips_arr = load_clips_as_array(all_neg_clips[:500], target_length)
    fp_val_data = af.embed_clips(neg_clips_arr, batch_size=32, ncpu=1)
    print(f"FP val data shape: {fp_val_data.shape}")
    
    # Step 5: Train model
    print("Starting training...")
    import torch
    from torch.utils.data import DataLoader, TensorDataset
    
    model = Model(n_classes=1, input_shape=(16, 96), model_type="dnn", layer_dim=32)
    
    # Create DataLoaders with proper tensors
    # Positive samples (label=1) + negative samples (label=0) for training
    # Mix positive training data with some negative data
    n_neg_train = min(200, len(neg_clips_arr))
    train_neg = neg_clips_arr[:n_neg_train]
    
    # Create labels: 1 for positive, 0 for negative
    train_labels = np.concatenate([
        np.ones(len(X_train)),
        np.zeros(n_neg_train)
    ])
    train_features = np.concatenate([X_train, fp_val_data[:n_neg_train]])
    
    val_labels = np.concatenate([
        np.ones(len(X_val)),
        np.zeros(min(100, len(fp_val_data)))
    ])
    val_features = np.concatenate([X_val, fp_val_data[:100]])
    
    train_dataset = TensorDataset(
        torch.from_numpy(train_features).float(),
        torch.from_numpy(train_labels).float()
    )
    val_dataset = TensorDataset(
        torch.from_numpy(val_features).float(),
        torch.from_numpy(val_labels).float()
    )
    
    train_loader = DataLoader(train_dataset, batch_size=32, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=len(val_labels))
    
    # Use train_model directly with fewer steps
    model.train_model(
        X=train_loader,
        max_steps=5000,
        warmup_steps=1000,
        hold_steps=2000,
        X_val=val_loader,
        false_positive_val_data=torch.from_numpy(fp_val_data).float(),
        negative_weight_schedule=np.linspace(1, 500, 5000).tolist(),
        val_steps=np.linspace(4000, 5000, 10).astype(np.int64).tolist(),
        lr=0.0001,
        val_set_hrs=11.3,
    )
    
    # Step 6: Export to ONNX
    output_candidates = [
        Path(r"z:\Projekte\Coding\Nox\nox-app\dist\win-unpacked\resources\backend\models\hey_nox.onnx"),
        Path(__file__).parent / "models" / "hey_nox.onnx",
    ]
    env_models = os.environ.get("NOX_MODELS_DIR")
    if env_models:
        output_candidates.insert(0, Path(env_models) / "hey_nox.onnx")
    
    output_path = output_candidates[0]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    model.export_to_onnx(str(output_path), class_mapping="hey_nox")
    print(f"Model exported to: {output_path}")
    
    return output_path


if __name__ == "__main__":
    train_model()
