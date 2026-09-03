"""User profile – structured storage for user data (location, name, timezone, etc.).

Stores data in config.yaml under the `user_profile` key as a nested dict.
Tools can read this directly without LLM involvement.

Auto-detection on first run:
- Timezone from system
- Location from IP geolocation (free, no API key)
- Language from system locale

If a field is missing, tools can request it via the `profile_request` WebSocket event.
"""

import logging
from typing import Any, Optional

logger = logging.getLogger("nox.profile")


class UserProfile:
    """Manages structured user profile data in config.yaml."""

    DEFAULT_PROFILE = {
        "location": "",       # e.g. "München, Deutschland"
        "latitude": None,     # float or None
        "longitude": None,    # float or None
        "timezone": "",       # e.g. "Europe/Berlin"
        "name": "",           # User's name
        "language": "",       # e.g. "de"
        "units": "metric",    # "metric" or "imperial"
    }

    def __init__(self, settings_manager=None):
        self._settings = settings_manager
        self._ensure_profile()

    def _ensure_profile(self) -> None:
        """Ensure user_profile section exists in config, merge missing keys."""
        if not self._settings:
            return
        config = self._settings.config
        existing = config.get("user_profile", {})
        changed = False

        if "user_profile" not in config:
            config["user_profile"] = dict(self.DEFAULT_PROFILE)
            changed = True
        else:
            for key, default_val in self.DEFAULT_PROFILE.items():
                if key not in existing:
                    existing[key] = default_val
                    changed = True

        if changed:
            self._settings.save({"user_profile": config["user_profile"]})
            logger.info("user_profile section initialized in config")

    def get(self, key: str, default: Any = None) -> Any:
        """Get a profile field. Returns default if not set."""
        if not self._settings:
            return default
        profile = self._settings.config.get("user_profile", {})
        return profile.get(key, default)

    def set(self, key: str, value: Any) -> None:
        """Set a profile field and persist to config."""
        if not self._settings:
            return
        config = self._settings.config
        if "user_profile" not in config:
            config["user_profile"] = dict(self.DEFAULT_PROFILE)
        config["user_profile"][key] = value
        self._settings.save({"user_profile": config["user_profile"]})
        logger.info("Profile updated: %s = %s", key, value)

    def get_all(self) -> dict[str, Any]:
        """Return the full profile dict."""
        if not self._settings:
            return dict(self.DEFAULT_PROFILE)
        return self._settings.config.get("user_profile", dict(self.DEFAULT_PROFILE))

    def update(self, updates: dict[str, Any]) -> dict[str, Any]:
        """Update multiple profile fields at once."""
        if not self._settings:
            return dict(self.DEFAULT_PROFILE)
        config = self._settings.config
        if "user_profile" not in config:
            config["user_profile"] = dict(self.DEFAULT_PROFILE)
        config["user_profile"].update(updates)
        self._settings.save({"user_profile": config["user_profile"]})
        logger.info("Profile updated: %s", list(updates.keys()))
        return config["user_profile"]

    def has_location(self) -> bool:
        """Check if location is set."""
        loc = self.get("location", "")
        return bool(loc and loc.strip())

    def get_location(self) -> Optional[str]:
        """Get stored location string, or None."""
        loc = self.get("location", "")
        return loc.strip() if loc and loc.strip() else None

    def get_coords(self) -> Optional[tuple[float, float]]:
        """Get (lat, lon) if available."""
        lat = self.get("latitude")
        lon = self.get("longitude")
        if lat is not None and lon is not None:
            try:
                return (float(lat), float(lon))
            except (ValueError, TypeError):
                pass
        return None

    def auto_detect(self) -> dict[str, Any]:
        """Auto-detect timezone and location from system + IP geolocation.

        Returns dict of detected fields. Does not overwrite existing non-empty values.
        """
        detected: dict[str, Any] = {}

        # 1. Timezone from system
        try:
            import datetime
            tz_name = str(datetime.datetime.now().astimezone().tzinfo)
            if tz_name and tz_name != "" and not self.get("timezone"):
                detected["timezone"] = tz_name
        except Exception:
            pass

        # 2. Language from system locale
        try:
            import locale
            lang = locale.getdefaultlocale()[0] or ""
            if lang and not self.get("language"):
                detected["language"] = lang.split("_")[0].lower()
        except Exception:
            pass

        # 3. Location from IP geolocation (free, no API key)
        if not self.has_location():
            try:
                import requests
                # ipapi.co free tier — 1000 requests/day, no key needed
                resp = requests.get("https://ipapi.co/json/", timeout=5)
                if resp.status_code == 200:
                    data = resp.json()
                    city = data.get("city", "")
                    country = data.get("country_name", "")
                    lat = data.get("latitude")
                    lon = data.get("longitude")

                    if city:
                        loc_str = f"{city}" + (f", {country}" if country else "")
                        detected["location"] = loc_str
                        if lat and lon:
                            detected["latitude"] = float(lat)
                            detected["longitude"] = float(lon)
                        logger.info("Auto-detected location: %s", loc_str)
            except Exception as exc:
                logger.debug("IP geolocation failed: %s", exc)

        if detected:
            self.update(detected)
            logger.info("Auto-detected profile data: %s", list(detected.keys()))

        return detected

    def get_missing_fields(self) -> list[str]:
        """Return list of profile fields that are empty/unset."""
        profile = self.get_all()
        missing = []
        for key, default in self.DEFAULT_PROFILE.items():
            val = profile.get(key, default)
            if val is None or val == "" or val == default:
                if key in ("location", "name"):  # only flag important ones
                    missing.append(key)
        return missing
