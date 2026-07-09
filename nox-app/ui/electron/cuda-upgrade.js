/**
 * CUDA upgrade module — checks if an NVIDIA GPU is present and upgrades
 * the embedded Python's torch from CPU-only to CUDA-enabled on first run.
 *
 * This is necessary because the CUDA torch package is ~2.8 GB, too large
 * to bundle inside the NSIS installer (NSIS has a ~4 GB mmap limit).
 * Instead, we ship CPU torch and upgrade in-place after installation.
 */

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Check if an NVIDIA GPU is present via nvidia-smi.
 * Returns the GPU name if found, or null otherwise.
 */
function detectNvidiaGpu() {
  try {
    const result = execSync(
      'nvidia-smi --query-gpu=name --format=csv,noheader',
      { encoding: "utf-8", timeout: 5000, windowsHide: true }
    ).trim();
    if (result) {
      return result.split('\n')[0].trim();
    }
  } catch {
    // nvidia-smi not found or failed
  }
  return null;
}

/**
 * Check if the embedded Python's torch already has CUDA support.
 */
function hasCudaTorch(pythonExe) {
  try {
    const result = execSync(
      `"${pythonExe}" -c "import torch; print(torch.cuda.is_available())"`,
      { encoding: "utf-8", timeout: 10000, windowsHide: true }
    ).trim();
    return result === "True";
  } catch {
    return false;
  }
}

/**
 * Upgrade the embedded Python's torch to CUDA-enabled version.
 * Returns a promise that resolves when the upgrade is complete.
 *
 * @param {string} pythonExe - Path to the embedded python.exe
 * @param {function} onProgress - Optional callback(stdoutLine) for progress updates
 * @returns {Promise<boolean>} - true if upgrade succeeded, false otherwise
 */
function upgradeToCudaTorch(pythonExe, onProgress) {
  return new Promise((resolve) => {
    console.log("CUDA upgrade: upgrading torch to CUDA version...");

    // Uninstall CPU torch first (async to avoid timeout)
    const uninstallArgs = ["-m", "pip", "uninstall", "torch", "torchvision", "-y"];
    const uninstallProc = spawn(pythonExe, uninstallArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    uninstallProc.stdout.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && onProgress) onProgress(trimmed);
      }
    });

    uninstallProc.stderr.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && onProgress) onProgress(trimmed);
      }
    });

    uninstallProc.on("close", (uninstallCode) => {
      console.log("CUDA upgrade: uninstall finished with code", uninstallCode);

      // Install CUDA torch
      const args = [
        "-m", "pip", "install",
        "torch", "torchvision",
        "--index-url", "https://download.pytorch.org/whl/cu128",
        "--no-warn-script-location",
      ];

      const proc = spawn(pythonExe, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      proc.stdout.on("data", (data) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && onProgress) {
            onProgress(trimmed);
          }
        }
      });

      proc.stderr.on("data", (data) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && onProgress) {
            onProgress(trimmed);
          }
        }
      });

      proc.on("close", (code) => {
        if (code === 0) {
          console.log("CUDA upgrade: torch upgraded to CUDA successfully");
          resolve(true);
        } else {
          console.error("CUDA upgrade: pip install failed with code", code);
          // Reinstall CPU torch as fallback
          try {
            execSync(
              `"${pythonExe}" -m pip install "torch>=2.1.0" "torchvision>=0.16.0" --no-warn-script-location`,
              { encoding: "utf-8", timeout: 300000, windowsHide: true }
            );
          } catch {
            // Best effort
          }
          resolve(false);
        }
      });

      proc.on("error", (err) => {
        console.error("CUDA upgrade: spawn error:", err);
        resolve(false);
      });
    });

    uninstallProc.on("error", (err) => {
      console.error("CUDA upgrade: uninstall spawn error:", err);
      // Try to continue with install anyway
      resolve(false);
    });
  });
}

/**
 * Main entry point — called from main.js on app startup.
 * Checks if CUDA upgrade is needed and performs it.
 *
 * @param {string} backendDir - The backend directory (process.resourcesPath/backend)
 * @param {function} onProgress - Optional callback for progress updates
 * @returns {Promise<{needed: boolean, success: boolean, gpuName: string|null}>}
 */
async function checkAndUpgradeCuda(backendDir, onProgress) {
  const pythonExe = path.join(backendDir, "python", "python.exe");
  const flagFile = path.join(backendDir, ".cuda-upgrade-done");

  // Already upgraded?
  if (fs.existsSync(flagFile)) {
    console.log("CUDA upgrade: already done (flag file exists)");
    return { needed: false, success: true, gpuName: null };
  }

  // Check for NVIDIA GPU
  const gpuName = detectNvidiaGpu();
  if (!gpuName) {
    console.log("CUDA upgrade: no NVIDIA GPU detected, skipping");
    // Write flag so we don't check again
    try { fs.writeFileSync(flagFile, "no-nvidia"); } catch {}
    return { needed: false, success: false, gpuName: null };
  }

  console.log(`CUDA upgrade: NVIDIA GPU detected: ${gpuName}`);

  // Already has CUDA torch?
  if (hasCudaTorch(pythonExe)) {
    console.log("CUDA upgrade: torch already has CUDA support");
    try { fs.writeFileSync(flagFile, "already-cuda"); } catch {}
    return { needed: false, success: true, gpuName };
  }

  // Need to upgrade
  console.log("CUDA upgrade: torch is CPU-only, upgrading to CUDA...");
  if (onProgress) onProgress("Upgrading PyTorch to CUDA version (this may take a few minutes)...");

  const success = await upgradeToCudaTorch(pythonExe, onProgress);

  if (success) {
    try { fs.writeFileSync(flagFile, `cuda-upgraded-${new Date().toISOString()}`); } catch {}
  }

  return { needed: true, success, gpuName };
}

module.exports = { checkAndUpgradeCuda, detectNvidiaGpu, hasCudaTorch };
