const { app, net, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const REPO_OWNER = "VeridonNetzwerk";
const REPO_NAME = "Nox";
const RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

const APP_VERSION = app.getVersion();

let cachedUpdateInfo = null;
let lastCheckTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function log(msg) {
  console.log(`[UpdateChecker] ${msg}`);
}

function compareVersions(v1, v2) {
  const parts1 = v1.replace(/^v/, "").split(".").map(Number);
  const parts2 = v2.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const a = parts1[i] || 0;
    const b = parts2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

function checkForUpdates() {
  return new Promise((resolve) => {
    const now = Date.now();
    if (cachedUpdateInfo && now - lastCheckTime < CACHE_TTL) {
      log("Returning cached update info");
      resolve(cachedUpdateInfo);
      return;
    }

    log(`Checking for updates... (current: v${APP_VERSION})`);
    const request = net.request({
      method: "GET",
      url: RELEASES_API,
      redirect: "follow",
    });
    request.setHeader("User-Agent", "Nox-Desktop-App");
    request.setHeader("Accept", "application/vnd.github+json");

    let body = "";
    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        log(`GitHub API returned status ${response.statusCode}`);
        resolve({ error: `GitHub API error: ${response.statusCode}` });
        return;
      }
      response.on("data", (chunk) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        try {
          const release = JSON.parse(body);
          const tagName = release.tag_name || "";
          const latestVersion = tagName.replace(/^v/, "");
          const hasUpdate = compareVersions(latestVersion, APP_VERSION) > 0;

          // Find the NSIS installer asset
          const assets = release.assets || [];
          const installerAsset = assets.find(
            (a) => a.name.endsWith(".exe") && a.name.toLowerCase().includes("setup")
          ) || assets.find((a) => a.name.endsWith(".exe"));

          const info = {
            hasUpdate,
            currentVersion: APP_VERSION,
            latestVersion,
            releaseUrl: release.html_url || "",
            releaseNotes: release.body || "",
            releaseName: release.name || "",
            publishedAt: release.published_at || "",
            installer: installerAsset
              ? {
                  name: installerAsset.name,
                  size: installerAsset.size,
                  downloadUrl: installerAsset.browser_download_url,
                }
              : null,
          };

          cachedUpdateInfo = info;
          lastCheckTime = now;

          if (hasUpdate) {
            log(`Update available: v${latestVersion} (current: v${APP_VERSION})`);
          } else {
            log(`No update available. Latest: v${latestVersion}, current: v${APP_VERSION}`);
          }

          resolve(info);
        } catch (err) {
          log(`Failed to parse release info: ${err.message}`);
          resolve({ error: `Parse error: ${err.message}` });
        }
      });
    });

    request.on("error", (err) => {
      log(`Update check failed: ${err.message}`);
      resolve({ error: err.message });
    });

    request.end();
  });
}

function downloadAndInstallInstaller(downloadUrl, onProgress) {
  return new Promise((resolve, reject) => {
    if (!downloadUrl) {
      reject(new Error("No download URL provided"));
      return;
    }

    const tmpDir = path.join(app.getPath("temp"), "nox-update");
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
    } catch (e) {
      // might already exist
    }

    const fileName = downloadUrl.split("/").pop() || "Nox-Setup.exe";
    const destPath = path.join(tmpDir, fileName);

    log(`Downloading installer: ${downloadUrl} -> ${destPath}`);

    const request = net.request({
      method: "GET",
      url: downloadUrl,
      redirect: "follow",
    });
    request.setHeader("User-Agent", "Nox-Desktop-App");

    let receivedBytes = 0;
    let totalBytes = 0;
    let fileStream = fs.createWriteStream(destPath);

    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }

      const contentLength = response.headers["content-length"];
      totalBytes = contentLength ? parseInt(contentLength) : 0;

      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        fileStream.write(chunk);
        if (onProgress && totalBytes > 0) {
          onProgress({
            received: receivedBytes,
            total: totalBytes,
            percent: Math.round((receivedBytes / totalBytes) * 100),
          });
        }
      });

      response.on("end", () => {
        fileStream.end(() => {
          log(`Download complete: ${destPath} (${receivedBytes} bytes)`);
          resolve(destPath);
        });
      });
    });

    request.on("error", (err) => {
      try {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      } catch (e) {
        // ignore
      }
      reject(new Error(`Download error: ${err.message}`));
    });

    request.end();
  });
}

function runInstaller(installerPath) {
  if (!fs.existsSync(installerPath)) {
    log(`Installer not found: ${installerPath}`);
    return false;
  }

  log(`Launching installer: ${installerPath}`);
  // NSIS installer with /S runs silently, but we want the user to see it
  // Just spawn it and quit Nox
  const child = spawn(installerPath, [], {
    detached: true,
    stdio: "ignore",
    cwd: path.dirname(installerPath),
  });
  child.unref();

  // Quit Nox so the installer can replace files
  setTimeout(() => {
    app.quit();
  }, 1000);

  return true;
}

module.exports = {
  checkForUpdates,
  downloadAndInstallInstaller,
  runInstaller,
  APP_VERSION,
};
