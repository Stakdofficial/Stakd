"""Operator alerts via a Discord / Slack / Telegram-bridge style webhook ({"content": text})."""

from __future__ import annotations

import logging
import time

import requests

log = logging.getLogger(__name__)

REPEAT_AFTER_SECONDS = 3600


class Alerter:
    def __init__(self, webhook_url: str):
        self.webhook_url = webhook_url
        self._last_sent: dict[str, float] = {}

    def send(self, key: str, text: str) -> None:
        """Log and post `text`; the same `key` is posted at most once an hour."""
        log.warning("ALERT %s", text)
        if not self.webhook_url:
            return
        now = time.time()
        if now - self._last_sent.get(key, 0) < REPEAT_AFTER_SECONDS:
            return
        self._last_sent[key] = now
        try:
            requests.post(self.webhook_url, json={"content": f"[levered-keeper] {text}", "text": f"[levered-keeper] {text}"}, timeout=10)
        except requests.RequestException:
            log.exception("alert webhook failed")
