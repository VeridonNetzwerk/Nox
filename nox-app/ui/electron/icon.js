const { nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");

// Resolve icon paths: in production from resourcesPath, in dev from assets
function getIconPath(filename) {
  // Production: bundled via extraResources
  if (process.resourcesPath) {
    const prodPath = path.join(process.resourcesPath, "branding", filename);
    if (fs.existsSync(prodPath)) return prodPath;
  }
  // Dev: from project assets
  const devPath = path.join(__dirname, "..", "..", "assets", "branding", filename);
  if (fs.existsSync(devPath)) return devPath;
  // Dev fallback: from ui/src/assets
  const srcPath = path.join(__dirname, "..", "src", "assets", filename);
  if (fs.existsSync(srcPath)) return srcPath;
  return null;
}

// Cache the base icon so we don't re-read the file every time
let baseIconCache = null;

function getBaseIcon() {
  if (baseIconCache !== null) return baseIconCache;
  const iconPath = getIconPath("icon_non_glow_1024x1024.png");
  if (iconPath) {
    try {
      baseIconCache = nativeImage.createFromPath(iconPath);
      if (baseIconCache.isEmpty()) {
        baseIconCache = false;
      }
    } catch {
      baseIconCache = false;
    }
  } else {
    baseIconCache = false;
  }
  return baseIconCache;
}

/**
 * Create a tray icon from the Nox mascot PNG.
 * Active = full color resized to 16x16 or 32x32.
 * Paused = desaturated (grayscale) version of the same icon.
 *
 * @param {boolean} paused - Whether context capture is paused
 * @returns {Electron.NativeImage}
 */
function createTrayIcon(paused = false) {
  const base = getBaseIcon();
  if (!base) {
    // Fallback: simple programmatic icon
    return createFallbackIcon(paused);
  }

  // Resize to 16x16 for tray (Windows standard)
  const size = 16;
  let icon = base.resize({ width: size, height: size });

  if (paused) {
    // Desaturate: convert to grayscale by manipulating the bitmap
    const bitmap = icon.toBitmap();
    const buf = Buffer.from(bitmap);
    for (let i = 0; i < buf.length; i += 4) {
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];
      // Luminance formula
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      // Dim it further for paused state
      const dimmed = Math.round(gray * 0.5);
      buf[i] = dimmed;
      buf[i + 1] = dimmed;
      buf[i + 2] = dimmed;
      // Alpha unchanged
    }
    icon = nativeImage.createFromBitmap(buf, { width: size, height: size });
  }

  return icon;
}

/**
 * Fallback programmatic icon (used if PNG not found).
 * Purple circle when active, gray when paused.
 */
function createFallbackIcon(paused = false) {
  const size = 16;
  const bitmap = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const radius = size / 2 - 0.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

      if (dist <= radius) {
        if (paused) {
          bitmap[idx] = 65;
          bitmap[idx + 1] = 65;
          bitmap[idx + 2] = 65;
          bitmap[idx + 3] = 255;
        } else {
          bitmap[idx] = 99;
          bitmap[idx + 1] = 102;
          bitmap[idx + 2] = 241;
          bitmap[idx + 3] = 255;
        }
      } else {
        bitmap[idx + 3] = 0;
      }
    }
  }

  return nativeImage.createFromBitmap(bitmap, { width: size, height: size });
}

module.exports = { createTrayIcon };
