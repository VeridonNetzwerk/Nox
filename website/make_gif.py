"""Capture Nox avatar animation frames via Edge headless and build a transparent GIF."""
import subprocess
import os
import shutil
import time
import functools
import http.server
import threading
import hashlib
import numpy as np
from PIL import Image

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
WEBSITE_DIR = os.path.dirname(os.path.abspath(__file__))
HTML_FILE = "nox-avatar-frames.html"
FRAMES_DIR = os.path.join(WEBSITE_DIR, "_gif_frames")
OUTPUT_GIF = os.path.join(WEBSITE_DIR, "..", "docs", "img", "nox-avatar.gif")

NUM_FRAMES = 60
TOTAL_MS = 104000
WINDOW_WIDTH = 400
WINDOW_HEIGHT = 460

# Chroma key color (pure green — doesn't appear in violet/blue/cyan avatar)
CHROMA_R, CHROMA_G, CHROMA_B = 0, 255, 0
CHROMA_THRESHOLD = 120  # higher threshold to catch anti-aliased green edges
CHROMA_FEATHER = 40  # pixels within this range get partial transparency

def start_server():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=WEBSITE_DIR)
    httpd = http.server.HTTPServer(("127.0.0.1", 8877), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd

def kill_edge():
    try:
        subprocess.run("taskkill /F /IM msedge.exe /T", capture_output=True, timeout=5)
    except Exception:
        pass
    time.sleep(0.3)

def capture_frame(ms, idx):
    out_path = os.path.join(FRAMES_DIR, f"frame_{idx:03d}.png")
    cmd = [
        EDGE,
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        f"--window-size={WINDOW_WIDTH},{WINDOW_HEIGHT}",
        "--virtual-time-budget=2000",
        f"--screenshot={out_path}",
        f"http://127.0.0.1:8877/{HTML_FILE}?t={ms}",
    ]
    try:
        subprocess.run(cmd, capture_output=True, timeout=45)
    except subprocess.TimeoutExpired:
        pass
    return out_path

def remove_green_background(img_rgba):
    """Replace pure green chroma key pixels with transparency, with edge feathering."""
    arr = np.array(img_rgba).astype(np.float32)  # H x W x 4
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    # Distance from pure green
    dist = np.sqrt((r - CHROMA_R)**2 + (g - CHROMA_G)**2 + (b - CHROMA_B)**2)
    # Full transparency within threshold
    alpha = arr[:,:,3].copy()
    alpha[dist < CHROMA_THRESHOLD] = 0
    # Feather edge: partial transparency in the feather zone
    feather_mask = (dist >= CHROMA_THRESHOLD) & (dist < CHROMA_THRESHOLD + CHROMA_FEATHER)
    alpha[feather_mask] = (255 * (dist[feather_mask] - CHROMA_THRESHOLD) / CHROMA_FEATHER).astype(np.float32)
    arr[:,:,3] = alpha
    return Image.fromarray(arr.astype(np.uint8), "RGBA")

def main():
    os.makedirs(FRAMES_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(OUTPUT_GIF), exist_ok=True)

    for f in os.listdir(FRAMES_DIR):
        os.remove(os.path.join(FRAMES_DIR, f))

    print(f"Starting local server for {WEBSITE_DIR}...")
    httpd = start_server()
    time.sleep(0.5)

    print(f"Capturing {NUM_FRAMES} frames...")
    frames = []
    for i in range(NUM_FRAMES):
        ms = int((i / NUM_FRAMES) * TOTAL_MS)
        print(f"  Frame {i+1}/{NUM_FRAMES} at {ms}ms...", end=" ", flush=True)
        path = capture_frame(ms, i)
        if os.path.exists(path):
            img = Image.open(path).convert("RGBA")
            img = remove_green_background(img)
            frames.append(img)
            print(f"OK ({img.size})")
        else:
            print("MISSING!")

    httpd.shutdown()

    if not frames:
        print("ERROR: No frames captured!")
        return

    # Check if frames are actually different
    hashes = set()
    for f in frames:
        h = hashlib.md5(f.tobytes()).hexdigest()
        hashes.add(h)
    print(f"Unique frames: {len(hashes)}/{len(frames)}")
    if len(hashes) == 1:
        print("WARNING: All frames identical — animation may not be rendering!")

    print(f"Building GIF with {len(frames)} frames...")
    target_w = 200
    target_h = int(target_w * (frames[0].height / frames[0].width))
    resized = [f.resize((target_w, target_h), Image.LANCZOS) for f in frames]

    # Build transparent GIF with Floyd-Steinberg dithering for smooth gradients
    p_frames = []
    for frame in resized:
        rgba = np.array(frame)
        alpha = rgba[:,:,3]

        # Convert to RGB and apply Floyd-Steinberg dithering for smooth gradients
        rgb_frame = Image.fromarray(rgba[:,:,:3], "RGB")
        p_frame = rgb_frame.quantize(colors=254, method=Image.FASTOCTREE, dither=Image.FLOYDSTEINBERG)

        palette = p_frame.getpalette()
        p_array = np.array(p_frame)
        p_array = p_array + 1  # shift to 1-254
        p_array[alpha < 128] = 0  # transparent pixels = index 0

        new_p = Image.fromarray(p_array, "P")

        new_palette = [0, 0, 0]  # index 0 = transparent
        new_palette.extend(palette[:254 * 3])
        while len(new_palette) < 256 * 3:
            new_palette.extend([0, 0, 0])
        new_p.putpalette(new_palette)

        p_frames.append(new_p)

    # Duration: 104s cycle / 60 frames ≈ 1733ms per frame for natural speed
    frame_duration = int(TOTAL_MS / NUM_FRAMES)

    p_frames[0].save(
        OUTPUT_GIF,
        save_all=True,
        append_images=p_frames[1:],
        duration=frame_duration,
        loop=0,
        disposal=2,
        transparency=0,
        optimize=False,
    )

    shutil.rmtree(FRAMES_DIR, ignore_errors=True)

    gif_size = os.path.getsize(OUTPUT_GIF)
    print(f"Done! GIF saved to {OUTPUT_GIF} ({gif_size // 1024} KB)")

if __name__ == "__main__":
    main()
