"""Platform utilities — Windows OS detection, paths, and helpers.

Centralizes platform-specific logic so other modules don't need
to repeat path construction. Nox currently targets Windows only.

Usage:
    from platform_utils import IS_WINDOWS, get_app_data_dir, ...
"""

import os
import platform
import re
import subprocess
import sys
from pathlib import Path
from typing import Optional

import logging
logger = logging.getLogger("nox.platform_utils")

# ---------------------------------------------------------------------------
# OS detection
# ---------------------------------------------------------------------------

IS_WINDOWS = sys.platform == "win32" or platform.system() == "Windows"

# ---------------------------------------------------------------------------
# Paths — central directory resolution for all Nox modules
# ---------------------------------------------------------------------------


def get_app_data_dir() -> Path:
    """Return the Nox application data directory.

    Windows: %APPDATA%\\Nox  (e.g. C:\\Users\\<user>\\AppData\\Roaming\\Nox)
    """
    base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    return base / "Nox"


def get_logs_dir() -> Path:
    """Return the Nox logs directory."""
    return get_app_data_dir() / "logs"


def get_data_dir() -> Path:
    """Return the Nox data directory (SQLite DBs, install_id, etc.)."""
    return get_app_data_dir() / "data"


def get_config_path() -> Path:
    """Return the path to config.yaml."""
    return get_app_data_dir() / "config.yaml"


# ---------------------------------------------------------------------------
# GPU detection — multi-vendor (Nvidia, AMD, Intel)
# ---------------------------------------------------------------------------

_gpu_static_cache: Optional[dict] = None


def _run_cmd(args: list[str], timeout: int = 5) -> str:
    """Run a command and return stdout, or empty string on failure."""
    try:
        result = subprocess.run(
            args, capture_output=True, text=True, timeout=timeout,
            encoding="utf-8", errors="replace",
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return ""


def detect_gpu() -> dict:
    """Detect GPU vendor, name, and VRAM.

    Returns a dict with keys:
        vendor: "nvidia" | "amd" | "intel" | "unknown"
        name: str (GPU name, e.g. "NVIDIA GeForce RTX 4070")
        vram_mb: int (total VRAM in MB, 0 if unknown)
        vram_free_mb: int (free VRAM in MB, 0 if unknown)
        backend: "cuda" | "rocm" | "vulkan" | "sycl" | "cpu"
            (recommended llama.cpp build backend for this GPU)
        all_gpus: list of dicts with vendor/name for multi-GPU systems

    Static info (vendor, name, total VRAM, backend) is cached after the first
    call. Only free VRAM is queried fresh each time.
    """
    global _gpu_static_cache
    if _gpu_static_cache is None:
        _gpu_static_cache = _detect_gpu_static()
    result = dict(_gpu_static_cache)
    result["vram_free_mb"] = _query_free_vram(result.get("vendor", "unknown"))
    return result


def _detect_gpu_static() -> dict:
    all_gpus = []
    vendor = "unknown"
    name = ""
    vram_mb = 0
    backend = "cpu"

    # Use wmic / PowerShell to list GPUs
    raw = _run_cmd(
        ["powershell", "-NoProfile", "-Command",
         "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | Format-List"]
    )
    if not raw:
        raw = _run_cmd(
            ["wmic", "path", "win32_VideoController", "get", "name,AdapterRAM", "/format:list"]
        )

    # Parse wmic/PowerShell output — look for Name= and AdapterRAM= pairs
    current_name = ""
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("Name") and "=" in line:
            current_name = line.split("=", 1)[1].strip()
        elif line.startswith("AdapterRAM") and "=" in line:
            ram_bytes = 0
            try:
                ram_bytes = int(line.split("=", 1)[1].strip())
            except ValueError:
                pass
            if current_name:
                g = _classify_gpu(current_name)
                g["vram_mb"] = ram_bytes // (1024 * 1024) if ram_bytes > 0 else 0
                all_gpus.append(g)
                current_name = ""

    # If wmic didn't work, try nvidia-smi at least for Nvidia
    if not all_gpus:
        nvidia_name = _run_cmd(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"]
        )
        if nvidia_name:
            g = _classify_gpu(nvidia_name.splitlines()[0].strip())
            all_gpus.append(g)

    # Pick the primary GPU (first dedicated GPU, prefer Nvidia > AMD > Intel)
    priority = {"nvidia": 0, "amd": 1, "intel": 2, "unknown": 3}
    all_gpus.sort(key=lambda g: priority.get(g["vendor"], 3))

    if all_gpus:
        primary = all_gpus[0]
        vendor = primary["vendor"]
        name = primary["name"]
        backend = primary["backend"]

    # --- Get VRAM for the primary GPU ---
    if vendor == "nvidia":
        vram_str = _run_cmd(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"]
        )
        if vram_str:
            try:
                vram_mb = int(vram_str.splitlines()[0].strip())
            except ValueError:
                pass

        # If nvidia-smi gave us a name, use it (more detailed than wmic)
        nvidia_name = _run_cmd(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"]
        )
        if nvidia_name:
            name = nvidia_name.splitlines()[0].strip()

    elif vendor == "amd":
        # wmic AdapterRAM wraps at 4GB (uint32), so it's unreliable for >4GB cards
        # Try PowerShell CIM to get accurate VRAM via dedicated video memory
        if vram_mb == 0:
            vram_raw = _run_cmd([
                "powershell", "-NoProfile", "-Command",
                "Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match 'AMD|Radeon' } | "
                "Select-Object Name, @{N='VRAM';E={$_.AdapterRAM}} | Format-List"
            ])
            # AdapterRAM is still uint32, but try anyway for small cards
            for line in vram_raw.splitlines():
                line = line.strip()
                if line.startswith("VRAM") and "=" in line:
                    try:
                        ram_bytes = int(line.split("=", 1)[1].strip())
                        if ram_bytes > 0:
                            vram_mb = ram_bytes // (1024 * 1024)
                    except ValueError:
                        pass

        # Fall back to whatever wmic/PowerShell provided
        for g in all_gpus:
            if g["vendor"] == "amd" and g.get("vram_mb", 0) > 0:
                vram_mb = g["vram_mb"]
                break

        # Last resort: guess from GPU name if still 0
        if vram_mb == 0 and name:
            vram_mb = _guess_vram_from_name(name)

    elif vendor == "intel":
        # Intel Arc GPUs have dedicated VRAM; iGPUs share system RAM
        if vram_mb == 0:
            for g in all_gpus:
                if g["vendor"] == "intel" and g.get("vram_mb", 0) > 0:
                    vram_mb = g["vram_mb"]
                    break
            # Arc B580 has 12GB, A770 has 16GB — guess from name if wmic fails
            if vram_mb == 0 and name:
                vram_mb = _guess_vram_from_name(name)

    # Count GPUs by vendor for multi-GPU split mode
    gpu_count = len(all_gpus)
    multi_gpu = gpu_count > 1

    return {
        "vendor": vendor,
        "name": name,
        "vram_mb": vram_mb,
        "backend": backend,
        "all_gpus": [{"vendor": g["vendor"], "name": g["name"]} for g in all_gpus],
        "gpu_count": gpu_count,
        "multi_gpu": multi_gpu,
    }


def _query_free_vram(vendor: str) -> int:
    """Query free VRAM in MB for the given vendor. Returns 0 if unavailable.

    Lightweight: only spawns a single nvidia-smi call for Nvidia GPUs.
    For other vendors, free VRAM is not easily queryable — returns 0.
    """
    if vendor == "nvidia":
        free_str = _run_cmd(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            timeout=3,
        )
        if free_str:
            try:
                return int(free_str.splitlines()[0].strip())
            except ValueError:
                pass
    return 0


def _classify_gpu(name: str) -> dict:
    """Classify a GPU name into vendor and recommended llama.cpp backend.

    Returns dict with: vendor, name, backend
    """
    name_lower = name.lower()

    # Nvidia
    if any(k in name_lower for k in ["nvidia", "geforce", "rtx", "gtx", "quadro", "tesla", "nforce"]):
        return {"vendor": "nvidia", "name": name, "backend": "cuda"}

    # AMD
    if any(k in name_lower for k in ["amd", "radeon", "ati ", "firepro", "firegl", "instinct", "vega", "navi", "rx 9", "rx 7", "rx 6", "rx 5"]):
        return {"vendor": "amd", "name": name, "backend": "rocm"}

    # Intel
    if any(k in name_lower for k in ["intel", "arc", "iris", "hd graphics", "uhd graphics", "battlemage", "alchemist", "meteor lake", "arrow lake"]):
        return {"vendor": "intel", "name": name, "backend": "sycl"}

    return {"vendor": "unknown", "name": name, "backend": "cpu"}


def _guess_vram_from_name(name: str) -> int:
    """Guess VRAM in MB from GPU name patterns.

    Used as last resort when OS APIs return 0 (common on Windows for >4GB cards
    due to uint32 AdapterRAM overflow).
    """
    n = name.lower()

    # AMD Radeon RX 9000 series (RDNA4)
    if "rx 9070" in n or "rx 9070 xt" in n:
        return 16384
    if "rx 9060" in n:
        return 8192

    # AMD Radeon RX 7000 series (RDNA3)
    if "rx 7900 xtx" in n:
        return 24576
    if "rx 7900 xt" in n:
        return 20480
    if "rx 7900" in n:
        return 20480
    if "rx 7800 xt" in n:
        return 16384
    if "rx 7700 xt" in n:
        return 12288
    if "rx 7600" in n:
        return 8192

    # AMD Radeon RX 6000 series (RDNA2)
    if "rx 6900" in n or "rx 6950" in n:
        return 16384
    if "rx 6800" in n:
        return 16384
    if "rx 6750" in n:
        return 12288
    if "rx 6700" in n:
        return 10240
    if "rx 6650" in n:
        return 8192
    if "rx 6600" in n:
        return 8192
    if "rx 6500" in n:
        return 4096

    # AMD Radeon RX 5000 series (RDNA1)
    if "rx 5700 xt" in n:
        return 8192
    if "rx 5700" in n:
        return 8192
    if "rx 5600" in n:
        return 6144
    if "rx 5500" in n:
        return 8192

    # AMD Radeon Vega
    if "vega 64" in n or "vega frontier" in n:
        return 8192
    if "vega 56" in n:
        return 8192
    if "radeon vii" in n:
        return 16384

    # AMD Instinct (MI series)
    if "mi300x" in n:
        return 196608
    if "mi250" in n:
        return 65536

    # NVIDIA RTX 50 series
    if "rtx 5090" in n:
        return 32768
    if "rtx 5080" in n:
        return 16384
    if "rtx 5070" in n:
        return 12288
    if "rtx 5060 ti" in n:
        return 16384
    if "rtx 5060" in n:
        return 8192

    # NVIDIA RTX 40 series
    if "rtx 4090" in n:
        return 24576
    if "rtx 4080" in n:
        return 16384
    if "rtx 4070 ti" in n:
        return 16384
    if "rtx 4070" in n:
        return 12288
    if "rtx 4060 ti" in n:
        return 16384
    if "rtx 4060" in n:
        return 8192

    # NVIDIA RTX 30 series
    if "rtx 3090" in n:
        return 24576
    if "rtx 3080" in n:
        return 10240
    if "rtx 3070" in n:
        return 8192
    if "rtx 3060" in n:
        return 12288
    if "rtx 3050" in n:
        return 8192

    # NVIDIA RTX 20 series
    if "rtx 2080 ti" in n:
        return 11264
    if "rtx 2080" in n:
        return 8192
    if "rtx 2070" in n:
        return 8192
    if "rtx 2060" in n:
        return 6144

    # NVIDIA GTX 16 series
    if "gtx 1660" in n:
        return 6144
    if "gtx 1650" in n:
        return 4096

    # NVIDIA GTX 10 series
    if "gtx 1080 ti" in n:
        return 11264
    if "gtx 1080" in n:
        return 8192
    if "gtx 1070" in n:
        return 8192
    if "gtx 1060" in n:
        return 6144
    if "gtx 1050" in n:
        return 4096

    # NVIDIA Quadro
    if "quadro rtx" in n:
        if "8000" in n:
            return 49152
        if "6000" in n:
            return 24576
        if "5000" in n:
            return 16384
        if "4000" in n:
            return 8192
    if "quadro p" in n:
        if "5000" in n or "6000" in n:
            return 24576
        if "4000" in n or "2000" in n:
            return 8192

    # Intel Arc
    if "arc a770" in n:
        return 16384
    if "arc a750" in n:
        return 8192
    if "arc a580" in n:
        return 8192
    if "arc b580" in n:
        return 12288
    if "arc b570" in n:
        return 10240
    if "arc a380" in n:
        return 6144

    return 0


def _guess_amd_gfx_from_name(name: str) -> str:
    """Guess the AMD GPU architecture from the GPU name."""
    n = name.lower()
    # RDNA4 (RX 9000 series)
    if any(k in n for k in ["rx 9070", "rx 9060", "rx 9", "rdna4"]):
        return "gfx1150"
    # RDNA3.5 (Strix Halo, Ryzen AI 300)
    if any(k in n for k in ["strix halo", "ryzen ai 300", "gfx1151"]):
        return "gfx1151"
    # RDNA3 (RX 7000 series)
    if any(k in n for k in ["rx 7900", "rx 7800", "rx 7700", "rx 7600", "rx 7", "rdna3"]):
        return "gfx1100"
    # RDNA2 (RX 6000 series)
    if any(k in n for k in ["rx 6900", "rx 6800", "rx 6700", "rx 6600", "rx 6500", "rx 6", "rdna2"]):
        return "gfx1030"
    # CDNA (MI200 series)
    if any(k in n for k in ["mi250", "mi210", "instinct mi2"]):
        return "gfx90a"
    # CDNA3 (MI300 series)
    if any(k in n for k in ["mi300", "instinct mi3"]):
        return "gfx942"
    # RDNA1 (RX 5000 series)
    if any(k in n for k in ["rx 5700", "rx 5600", "rx 5500", "rx 5", "rdna1"]):
        return "gfx1010"
    # Default: RDNA2 (most common)
    return "gfx1030"


def _detect_cuda_version() -> str:
    """Detect the installed CUDA version and return the wheel tag.

    Returns one of: 'cu118', 'cu121', 'cu122', 'cu123', 'cu124', 'cu125',
    'cu130', 'cu132', or '' if CUDA not detected.
    """
    # nvidia-smi outputs CUDA Version in the header
    raw_full = _run_cmd(["nvidia-smi"], timeout=5)
    if raw_full:
        # Look for 'CUDA Version: XX.X' in nvidia-smi output
        m = re.search(r"CUDA Version:\s*(\d+)\.(\d+)", raw_full)
        if m:
            major, minor = int(m.group(1)), int(m.group(2))
            cuda_ver = f"{major}.{minor}"
            # Map to wheel tag
            wheel_map = {
                "11.8": "cu118",
                "12.1": "cu121",
                "12.2": "cu122",
                "12.3": "cu123",
                "12.4": "cu124",
                "12.5": "cu125",
                "13.0": "cu130",
                "13.2": "cu132",
            }
            if cuda_ver in wheel_map:
                return wheel_map[cuda_ver]
            # For versions not in the map, use the closest lower version
            versions = [(float(k), v) for k, v in wheel_map.items()]
            versions.sort(key=lambda x: x[0])
            cv = float(cuda_ver)
            best = ""
            for v, tag in versions:
                if cv >= v:
                    best = tag
            return best
    # Try nvcc
    raw = _run_cmd(["nvcc", "--version"], timeout=5)
    if raw:
        m = re.search(r"release (\d+)\.(\d+)", raw)
        if m:
            cuda_ver = f"{m.group(1)}.{m.group(2)}"
            wheel_map = {
                "11.8": "cu118",
                "12.1": "cu121",
                "12.2": "cu122",
                "12.3": "cu123",
                "12.4": "cu124",
                "12.5": "cu125",
                "13.0": "cu130",
                "13.2": "cu132",
            }
            return wheel_map.get(cuda_ver, "")
    return ""


def _check_rocm_available() -> bool:
    """Check if ROCm/HIP SDK is installed and usable on Windows."""
    # Check HIP_PATH environment variable
    hip_path = os.environ.get("HIP_PATH", "")
    if hip_path and Path(hip_path).exists():
        return True
    # Check common ROCm installation directories on Windows
    rocm_base = Path(r"C:\Program Files\AMD\ROCm")
    if rocm_base.exists():
        # Any version subdirectory
        for child in rocm_base.iterdir():
            if child.is_dir() and (child / "bin").exists():
                return True
    # Check if hipcc is on PATH
    if is_command_available("hipcc"):
        return True
    return False


def get_llama_cpp_cmake_args(vendor: str) -> dict:
    """Return the CMAKE_ARGS and pip install flags for llama-cpp-python for a given GPU vendor.

    Uses native acceleration backends:
      - Nvidia: CUDA (pre-built wheel if available, source build as fallback)
      - AMD: ROCm / HIP (HIPBLAS) with GPU arch guess + rocWMMA for RDNA3+
            Falls back to Vulkan if ROCm/HIP SDK is not installed
      - Intel: OneAPI / SYCL for A-series, Vulkan for B-series (Battlemage)
            Falls back to Vulkan if OneAPI is not installed
      - Unknown: Vulkan fallback (no vendor SDK needed)

    Returns dict with:
        cmake_args: str (CMAKE_ARGS value)
        extra_env: dict (additional env vars)
        wheel_url: str (optional pre-built wheel URL, empty if building from source)
        pip_extra_args: list (extra pip install args, e.g. --extra-index-url)
        description: str (human-readable description)
    """
    if vendor == "nvidia":
        # Try pre-built wheel first — much faster than source build
        cuda_tag = _detect_cuda_version()
        if cuda_tag:
            return {
                "cmake_args": "",
                "extra_env": {},
                "wheel_url": "",
                "pip_extra_args": [
                    "--extra-index-url",
                    f"https://abetlen.github.io/llama-cpp-python/whl/{cuda_tag}",
                ],
                "description": f"CUDA (Nvidia GPU acceleration, pre-built wheel: {cuda_tag})",
            }
        # Fallback: source build with CUDA
        return {
            "cmake_args": "-DGGML_CUDA=on",
            "extra_env": {},
            "wheel_url": "",
            "pip_extra_args": [],
            "description": "CUDA (Nvidia GPU acceleration, source build)",
        }
    elif vendor == "amd":
        # ROCm / HIP — native AMD acceleration
        # Check if ROCm/HIP is actually installed before trying to use it
        rocm_available = _check_rocm_available()

        if not rocm_available:
            # ROCm/HIP SDK not installed — use Vulkan as fallback
            # Vulkan works on any GPU with drivers, no SDK needed
            logger.info("ROCm/HIP not detected — using Vulkan fallback for AMD GPU")
            return {
                "cmake_args": "-DGGML_VULKAN=on",
                "extra_env": {},
                "wheel_url": "",
                "pip_extra_args": [],
                "description": "Vulkan (AMD GPU fallback — ROCm/HIP SDK not installed)",
            }

        extra_env = {}
        cmake_args = "-DGGML_HIPBLAS=on"

        # AMD HIP SDK must be installed on Windows
        hip_path = os.environ.get("HIP_PATH", "")
        if not hip_path:
            for candidate in [
                r"C:\Program Files\AMD\ROCm\5.7\bin",
                r"C:\Program Files\AMD\ROCm\6.0\bin",
                r"C:\Program Files\AMD\ROCm\6.1\bin",
                r"C:\Program Files\AMD\ROCm\6.2\bin",
                r"C:\Program Files\AMD\ROCm\6.3\bin",
                r"C:\Program Files\AMD\ROCm\6.4\bin",
            ]:
                if Path(candidate).exists():
                    extra_env["HIP_PATH"] = str(Path(candidate).parent)
                    break

        # Detect GPU arch from name
        gpu_info = detect_gpu()
        gfx_arch = _guess_amd_gfx_from_name(gpu_info.get("name", ""))
        if gfx_arch:
            extra_env["AMDGPU_TARGET"] = gfx_arch
        if gfx_arch in ("gfx1100", "gfx1150"):
            cmake_args += " -DGGML_HIP_ROCWMMA_FATTN=ON"

        return {
            "cmake_args": cmake_args,
            "extra_env": extra_env,
            "wheel_url": "",
            "pip_extra_args": [],
            "description": f"ROCm/HIP (AMD GPU acceleration, arch: {extra_env.get('AMDGPU_TARGET', 'auto')})",
        }
    elif vendor == "intel":
        # Intel Arc B-series (Battlemage) — SYCL support is still experimental
        # Use Vulkan as primary backend for B-series, SYCL for A-series
        gpu_info = detect_gpu()
        gpu_name_lower = gpu_info.get("name", "").lower()

        if "arc b" in gpu_name_lower or "battlemage" in gpu_name_lower:
            # Battlemage (B580, B570, etc.) — Vulkan is more reliable
            return {
                "cmake_args": "-DGGML_VULKAN=on",
                "extra_env": {},
                "wheel_url": "",
                "pip_extra_args": [],
                "description": "Vulkan (Intel Arc B-series / Battlemage)",
            }

        # Intel Arc A-series and iGPUs — try SYCL with OneAPI
        extra_env = {}
        oneapi_available = False
        oneapi_root = os.environ.get("ONEAPI_ROOT", "")
        if not oneapi_root:
            for candidate in [
                r"C:\Program Files (x86)\Intel\oneAPI",
                r"C:\Program Files\Intel\oneAPI",
            ]:
                if Path(candidate).exists():
                    extra_env["ONEAPI_ROOT"] = candidate
                    oneapi_available = True
                    break
        else:
            oneapi_available = True

        if oneapi_available:
            return {
                "cmake_args": "-DGGML_SYCL=on",
                "extra_env": extra_env,
                "wheel_url": "",
                "pip_extra_args": [],
                "description": "OneAPI/SYCL (Intel GPU acceleration)",
            }

        # OneAPI not installed — use Vulkan fallback
        return {
            "cmake_args": "-DGGML_VULKAN=on",
            "extra_env": {},
            "wheel_url": "",
            "pip_extra_args": [],
            "description": "Vulkan (Intel GPU fallback — OneAPI not installed)",
        }
    else:
        # Unknown GPU — try Vulkan as fallback
        # Vulkan doesn't need any vendor SDK, works on any GPU with drivers
        return {
            "cmake_args": "-DGGML_VULKAN=on",
            "extra_env": {},
            "wheel_url": "",
            "pip_extra_args": [],
            "description": "Vulkan (GPU fallback)",
        }


# ---------------------------------------------------------------------------
# Binary availability checks
# ---------------------------------------------------------------------------

def is_command_available(command: str) -> bool:
    """Check if a system command is available on PATH."""
    import shutil
    return shutil.which(command) is not None
