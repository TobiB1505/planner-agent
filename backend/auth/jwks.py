"""JWKS-Abruf mit Caching für die Supabase-Token-Verifikation.

Warum überhaupt Caching: die Signaturschlüssel ändern sich praktisch nie
(Supabase rotiert selten und kündigt eine Rotation über eine neue "kid" an).
Ein Netzwerkabruf pro Request wäre damit reine Latenz - und ein
Single Point of Failure, sobald Supabase kurz nicht erreichbar ist.

Verhalten:
  - Schlüssel werden `jwks_cache_seconds` lang wiederverwendet.
  - Eine *unbekannte* kid löst einen gezielten Refresh aus (Schlüsselrotation),
    aber höchstens einmal pro `jwks_min_refresh_seconds` - sonst könnte ein
    Angreifer mit erfundenen kid-Werten beliebig viele Abrufe auslösen.
  - Schlägt ein Refresh fehl, werden vorhandene (auch abgelaufene) Schlüssel
    weiterverwendet, statt jede Anmeldung fallen zu lassen: ein kurzer
    Supabase-Ausfall soll nicht die gesamte Anwendung sperren. Nur wenn
    überhaupt keine Schlüssel vorliegen, wird der Fehler zum Auth-Fehler.
  - Niemals wird ein Token ohne gültige Signaturprüfung akzeptiert. Der
    Fallback betrifft ausschliesslich die Frage "wie alt darf der
    Schlüsselsatz sein", nie die Frage "wird überhaupt geprüft".
"""
from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.request
from typing import Dict, Optional

import jwt

from .errors import AuthError

logger = logging.getLogger(__name__)

_HTTP_TIMEOUT_SECONDS = 5


def _fetch_jwks(url: str) -> dict:
    """Lädt das JWKS-Dokument. Eigene Funktion, damit Tests sie ersetzen
    können, ohne echten Netzwerkverkehr zu erzeugen."""
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_SECONDS) as response:
        payload = response.read()
    return json.loads(payload.decode("utf-8"))


class JwksCache:
    """Thread-sicherer Cache für einen JWKS-Endpunkt."""

    def __init__(self, url: str, cache_seconds: int, min_refresh_seconds: int):
        self.url = url
        self.cache_seconds = cache_seconds
        self.min_refresh_seconds = min_refresh_seconds
        self._lock = threading.Lock()
        self._keys: Dict[str, "jwt.PyJWK"] = {}
        self._fetched_at: Optional[float] = None
        self._last_attempt_at: Optional[float] = None

    # -- intern ---------------------------------------------------------
    def _is_fresh(self, now: float) -> bool:
        return self._fetched_at is not None and (now - self._fetched_at) < self.cache_seconds

    def _may_attempt_refresh(self, now: float) -> bool:
        if self._last_attempt_at is None:
            return True
        return (now - self._last_attempt_at) >= self.min_refresh_seconds

    def _refresh(self, now: float) -> None:
        """Holt den Schlüsselsatz neu. Fehler werden protokolliert, aber nur
        dann weitergereicht, wenn noch gar keine Schlüssel vorliegen."""
        self._last_attempt_at = now
        try:
            document = _fetch_jwks(self.url)
            key_set = jwt.PyJWKSet.from_dict(document)
        except (urllib.error.URLError, OSError, ValueError, KeyError, jwt.PyJWKSetError) as exc:
            # Bewusst nur Fehlertyp/-text des Abrufs, keine Token-Daten.
            logger.warning("JWKS-Aktualisierung fehlgeschlagen (%s): %s", type(exc).__name__, exc)
            if not self._keys:
                raise AuthError("auth_not_configured", f"JWKS nicht ladbar: {exc}") from exc
            return

        keys = {key.key_id: key for key in key_set.keys if key.key_id}
        if not keys:
            logger.warning("JWKS-Dokument enthielt keine verwendbaren Schlüssel.")
            if not self._keys:
                raise AuthError("auth_not_configured", "JWKS ohne verwendbare Schlüssel")
            return

        self._keys = keys
        self._fetched_at = now

    # -- öffentlich -----------------------------------------------------
    def get_key(self, kid: str) -> "jwt.PyJWK":
        if not kid:
            raise AuthError("invalid_token", "Token ohne kid, aber asymmetrisch signiert")

        with self._lock:
            now = time.monotonic()
            if not self._keys or not self._is_fresh(now):
                if self._may_attempt_refresh(now) or not self._keys:
                    self._refresh(now)

            key = self._keys.get(kid)
            if key is None and self._may_attempt_refresh(time.monotonic()):
                # Unbekannte kid: könnte eine frische Schlüsselrotation sein.
                self._refresh(time.monotonic())
                key = self._keys.get(kid)

            if key is None:
                raise AuthError("invalid_signature", "Kein JWKS-Schlüssel für die kid des Tokens")
            return key

    def clear(self) -> None:
        with self._lock:
            self._keys = {}
            self._fetched_at = None
            self._last_attempt_at = None


_caches: Dict[str, JwksCache] = {}
_caches_lock = threading.Lock()


def get_cache(url: str, cache_seconds: int, min_refresh_seconds: int) -> JwksCache:
    """Ein Cache pro JWKS-URL, prozessweit wiederverwendet."""
    with _caches_lock:
        cache = _caches.get(url)
        if cache is None:
            cache = JwksCache(url, cache_seconds, min_refresh_seconds)
            _caches[url] = cache
        else:
            cache.cache_seconds = cache_seconds
            cache.min_refresh_seconds = min_refresh_seconds
        return cache


def reset_caches() -> None:
    """Nur für Tests/Neustart-Szenarien - verwirft alle gecachten Schlüssel."""
    with _caches_lock:
        _caches.clear()
