"""Capture Nox avatar animation frames via Edge headless and build a GIF."""
import subprocess
import os
import shutil
import time
import functools
import http.server
import threading
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

def start_server():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=WEBSITE_DIR)
    httpd = http.server.HTTPServer(("127.0.0.1", 8877), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd

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
        f"--virtual-time-budget={max(ms, 200)}",
        f"--screenshot={out_path}",
        f"http://127.0.0.1:8877/{HTML_FILE}",
    ]
    try:
        subprocess.run(cmd, capture_output=True, timeout=60)
    except subprocess.TimeoutExpired:
        pass
    return out_path

def main():
    os.makedirs(FRAMES_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(OUTPUT_GIF), exist_ok=True)

    # Clean old frames
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
            # Crop to content area (remove browser chrome)
            # Edge headless screenshot is exact window size
            frames.append(img)
            print("OK")
        else:
            print("MISSING!")

    httpd.shutdown()

    if not frames:
        print("ERROR: No frames captured!")
        return

    print(f"Building GIF with {len(frames)} frames...")
    # Resize frames for smaller GIF
    target_w = 200
    target_h = int(target_w * (frames[0].height / frames[0].width))
    resized = [f.resize((target_w, target_h), Image.LANCZOS) for f in frames]

    # Save as GIF
    resized[0].save(
        OUTPUT_GIF,
        save_all=True,
        append_images=resized[1:],
        duration=80,  # ms per frame
        loop=0,  # infinite loop
        disposal=2,
        optimize=True,
    )

    # Cleanup
    shutil.rmtree(FRAMES_DIR, ignore_errors=True)

    gif_size = os.path.getsize(OUTPUT_GIF)
    print(f"Done! GIF saved to {OUTPUT_GIF} ({gif_size // 1024} KB)")

if __name__ == "__main__":
    main()
