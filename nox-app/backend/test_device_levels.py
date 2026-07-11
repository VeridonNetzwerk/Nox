"""Fast test: audio levels on all input devices, 1s each, 3s timeout per device."""
import numpy as np
import sounddevice as sd
import threading
import time

DURATION = 1  # 1 second of audio per device
TIMEOUT = 3.0  # max seconds per device before aborting

# Find all input devices
devices = sd.query_devices()
input_devs = []
for i, d in enumerate(devices):
    if d['max_input_channels'] > 0:
        input_devs.append((i, d['name']))

print(f"Found {len(input_devs)} input devices. Testing {DURATION}s each (timeout={TIMEOUT}s)...")
print("Play music / speak now!\n")

for dev, name in input_devs:
    result = {"audio": None, "error": None}
    
    def _record():
        try:
            result["audio"] = sd.rec(int(DURATION * 16000), samplerate=16000,
                                     channels=1, dtype="float32", device=dev)
            sd.wait()
        except Exception as e:
            result["error"] = str(e)
    
    t = threading.Thread(target=_record, daemon=True)
    t.start()
    t.join(timeout=TIMEOUT)
    
    if t.is_alive():
        print(f"  [{dev:3d}] {name[:50]:50s} TIMEOUT (>={TIMEOUT}s)")
    elif result["error"]:
        print(f"  [{dev:3d}] {name[:50]:50s} ERROR: {result['error'][:40]}")
    elif result["audio"] is not None:
        peak = float(np.abs(result["audio"].flatten()).max())
        status = "(GOOD)" if peak > 0.1 else "(LOW)" if peak > 0.01 else "(SILENT)"
        print(f"  [{dev:3d}] {name[:50]:50s} peak={peak:.4f} {status}")
    else:
        print(f"  [{dev:3d}] {name[:50]:50s} NO DATA")

print("\nDone.")
