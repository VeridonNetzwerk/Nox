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

NUM_FRAMES = 36
TOTAL_MS = 13000
WINDOW_WIDTH = 400
WINDOW_HEIGHT = 460

# Chroma key color (pure green — doesn't appear in violet/blue/cyan avatar)
CHROMA_R, CHROMA_G, CHROMA_B = 0, 255, 0
CHROMA_THRESHOLD = 30  # pixels within this distance of chroma key become transparent

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
    """Replace pure green chroma key pixels with transparency."""
    arr = np.array(img_rgba)  # H x W x 4
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    # Distance from pure green
    dist = np.sqrt((r.astype(int) - CHROMA_R)**2 + (g.astype(int) - CHROMA_G)**2 + (b.astype(int) - CHROMA_B)**2)
    mask = dist < CHROMA_THRESHOLD
    arr[mask, 3] = 0  # set alpha to 0 (transparent)
    return Image.fromarray(arr, "RGBA")

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

    # Build transparent GIF using P mode with transparency
    # Convert each RGBA frame to P (palette) mode, preserving transparency
    p_frames = []
    for frame in resized:
        p_frame = frame.quantize(colors=255, method=Image.FASTOCTREE)
        p_frames.append(p_frame)

    p_frames[0].save(
        OUTPUT_GIF,
        save_all=True,
        append_images=p_frames[1:],
        duration=80,
        loop=0,
        disposal=2,
        transparency=0,
        optimize=True,
    )

    shutil.rmtree(FRAMES_DIR, ignore_errors=True)

    gif_size = os.path.getsize(OUTPUT_GIF)
    print(f"Done! GIF saved to {OUTPUT_GIF} ({gif_size // 1024} KB)")

if __name__ == "__main__":
    main()
