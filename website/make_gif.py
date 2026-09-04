"""Capture Nox avatar animation frames via Edge CDP and build a transparent GIF.

Uses the exact same CSS/SVG as the Nox app. Captures at 60fps via Chrome DevTools
Protocol for speed. True transparency via --default-background-color=00000000.
"""
import subprocess
import os
import shutil
import time
import json
import base64
import io
import functools
import http.server
import threading
import hashlib
import numpy as np
import requests
import websocket
from PIL import Image

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
WEBSITE_DIR = os.path.dirname(os.path.abspath(__file__))
HTML_FILE = "nox-avatar-frames.html"
OUTPUT_GIF = os.path.join(WEBSITE_DIR, "..", "docs", "img", "nox-avatar.gif")

FPS = 10
CYCLE_MS = 26000  # matches wobble duration for seamless loop
NUM_FRAMES = int(FPS * CYCLE_MS / 1000)  # 260
FRAME_MS = int(1000 / FPS)  # 100ms

WINDOW_WIDTH = 800
WINDOW_HEIGHT = 800
CDP_PORT = 9222

OUTPUT_SIZE = 200
# Keep faint glow pixels (app's glow has very low alpha). Premultiplied against
# black so they match how the app renders over its dark background.
ALPHA_KEEP_THRESHOLD = 12

def start_server():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=WEBSITE_DIR)
    httpd = http.server.HTTPServer(("127.0.0.1", 8877), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd

def start_edge_cdp():
    proc = subprocess.Popen(
        [
            EDGE,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            "--default-background-color=00000000",
            f"--window-size={WINDOW_WIDTH},{WINDOW_HEIGHT}",
            f"--remote-debugging-port={CDP_PORT}",
            "--remote-allow-origins=*",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(3)
    return proc

def get_ws_url():
    # Create a new tab via HTTP API
    resp = requests.put(f"http://127.0.0.1:{CDP_PORT}/json/new?about:blank")
    target = resp.json()
    return target["webSocketDebuggerUrl"]

def cdp_send(ws, method, params=None, msg_id=1):
    msg = {"id": msg_id, "method": method}
    if params:
        msg["params"] = params
    ws.send(json.dumps(msg))
    while True:
        resp = json.loads(ws.recv())
        if resp.get("id") == msg_id:
            return resp

def capture_via_cdp(ws, ms):
    """Seek animation to time T and capture screenshot."""
    js = f"""
    (function() {{
        var t = {ms};
        document.querySelectorAll('.nox-avatar, .nox-blob-path, .nox-droplet-a, .nox-droplet-b').forEach(function(el) {{
            el.getAnimations().forEach(function(anim) {{
                anim.currentTime = t;
                anim.pause();
            }});
        }});
    }})();
    """
    cdp_send(ws, "Runtime.evaluate", {"expression": js, "awaitPromise": True}, msg_id=1)
    # Capture screenshot with transparency
    result = cdp_send(ws, "Page.captureScreenshot", {
        "format": "png",
        "captureBeyondViewport": False,
        "fromSurface": True,
        "omitBackground": True,
    }, msg_id=2)
    data_b64 = result["result"]["data"]
    img_data = base64.b64decode(data_b64)
    return Image.open(io.BytesIO(img_data)).convert("RGBA")

def main():
    os.makedirs(os.path.dirname(OUTPUT_GIF), exist_ok=True)

    print("Starting local HTTP server...")
    httpd = start_server()
    time.sleep(0.5)

    print("Starting Edge with CDP...")
    edge_proc = start_edge_cdp()

    try:
        ws_url = get_ws_url()
        print(f"CDP WebSocket: {ws_url}")
        ws = websocket.create_connection(ws_url)

        # Navigate to the page
        cdp_send(ws, "Page.enable", {}, msg_id=1)
        cdp_send(ws, "Emulation.enable", {}, msg_id=2)
        cdp_send(ws, "Emulation.setDeviceMetricsOverride", {
            "width": WINDOW_WIDTH,
            "height": WINDOW_HEIGHT,
            "deviceScaleFactor": 1,
            "mobile": False,
        }, msg_id=3)
        cdp_send(ws, "Page.navigate", {
            "url": f"http://127.0.0.1:8877/{HTML_FILE}?t=0"
        }, msg_id=4)
        time.sleep(1)
        # Set transparent background override
        cdp_send(ws, "Emulation.setDefaultBackgroundColorOverride", {
            "color": {"r": 0, "g": 0, "b": 0, "a": 0}
        }, msg_id=5)

        print(f"Capturing {NUM_FRAMES} frames at {FPS}fps over {CYCLE_MS/1000}s cycle...")
        frames = []
        for i in range(NUM_FRAMES):
            ms = int((i / NUM_FRAMES) * CYCLE_MS)
            if i % 60 == 0:
                print(f"  Frame {i+1}/{NUM_FRAMES} ({ms}ms)...", flush=True)
            img = capture_via_cdp(ws, ms)
            frames.append(img)

        ws.close()
    finally:
        edge_proc.kill()
        httpd.shutdown()

    if not frames:
        print("ERROR: No frames captured!")
        return

    # Check transparency
    sample = np.array(frames[0])
    has_alpha = (sample[:,:,3] < 255).any()
    print(f"Alpha channel present: {has_alpha}")

    # Check unique frames
    hashes = set()
    for f in frames:
        h = hashlib.md5(f.tobytes()).hexdigest()
        hashes.add(h)
    print(f"Unique frames: {len(hashes)}/{len(frames)}")

    print(f"Building GIF with {len(frames)} frames...")
    target_h = int(OUTPUT_SIZE * (frames[0].height / frames[0].width))
    resized = [f.resize((OUTPUT_SIZE, target_h), Image.LANCZOS) for f in frames]

    # Premultiply alpha against black. The app renders on a dark background, so
    # semi-transparent pixels (anti-aliased edges + the soft glow halo) appear
    # darkened there. Premultiplying reproduces that exact look, since GIF only
    # supports binary transparency and cannot store partial alpha.
    print("  Premultiplying alpha...")
    premultiplied = []
    for frame in resized:
        rgba = np.array(frame).astype(np.float32)
        alpha = rgba[:, :, 3:4] / 255.0
        rgb = (rgba[:, :, :3] * alpha).astype(np.uint8)
        premultiplied.append((rgb, np.array(frame)[:, :, 3]))

    # Build a global palette from all frames for consistent smooth gradients
    print("  Building global palette...")
    samples = []
    for rgb, alpha in premultiplied:
        samples.append(rgb[alpha >= ALPHA_KEEP_THRESHOLD])
    combined = np.concatenate(samples, axis=0)
    combined_img = Image.fromarray(combined.reshape(-1, 1, 3), "RGB")
    global_p = combined_img.quantize(colors=255, method=Image.MEDIANCUT)
    global_palette = global_p.getpalette()

    # Palette with index 0 reserved for transparency
    gif_palette = [0, 0, 0] + list(global_palette[: 255 * 3])
    while len(gif_palette) < 256 * 3:
        gif_palette.extend([0, 0, 0])

    print("  Quantizing frames with global palette...")
    p_frames = []
    for rgb, alpha in premultiplied:
        rgb_frame = Image.fromarray(rgb, "RGB")
        p_frame = rgb_frame.quantize(palette=global_p, dither=Image.FLOYDSTEINBERG)

        p_array = np.array(p_frame).astype(np.uint16) + 1  # shift to 1..255
        p_array[alpha < ALPHA_KEEP_THRESHOLD] = 0  # transparent
        new_p = Image.fromarray(p_array.astype(np.uint8), "P")
        new_p.putpalette(gif_palette)
        p_frames.append(new_p)

    p_frames[0].save(
        OUTPUT_GIF,
        save_all=True,
        append_images=p_frames[1:],
        duration=FRAME_MS,
        loop=0,
        disposal=2,
        transparency=0,
        optimize=True,
    )

    gif_size = os.path.getsize(OUTPUT_GIF)
    print(f"Done! GIF saved to {OUTPUT_GIF} ({gif_size // 1024} KB)")

if __name__ == "__main__":
    main()
