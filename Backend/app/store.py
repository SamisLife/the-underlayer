"""In-memory storage.

The app keeps three things during a session: device summaries, full scan history, and
remediation actions. These live in process memory — there is no external database, so the
app runs with zero setup. Data lives until the process restarts; re-scan to repopulate.

Routes call these high-level methods rather than touching the data structures directly. All
access happens on the single event loop (sync routes / background tasks reach it via
app.bridge), so no locking is needed.
"""

import copy
import uuid
from typing import Dict, List, Optional


class MemoryStore:
    name = "in-memory"

    def __init__(self) -> None:
        self._devices: Dict[str, dict] = {}   # keyed by deviceId
        self._scans: List[dict] = []
        self._actions: List[dict] = []

    async def clear_devices(self) -> int:
        count = len(self._devices)
        self._devices.clear()
        return count

    async def save_scan(self, raw_doc: dict) -> str:
        scan_id = uuid.uuid4().hex
        self._scans.append({**copy.deepcopy(raw_doc), "_id": scan_id})
        return scan_id

    async def upsert_device(self, device_id: str, fields: dict) -> None:
        existing = self._devices.get(device_id, {})
        self._devices[device_id] = {**existing, **copy.deepcopy(fields)}

    async def list_devices(self) -> List[dict]:
        return [copy.deepcopy(d) for d in self._devices.values()]

    async def list_ar_summaries(self) -> List[dict]:
        return [copy.deepcopy(d["arSummary"]) for d in self._devices.values() if "arSummary" in d]

    async def get_device(self, hostname: str) -> Optional[dict]:
        for d in self._devices.values():
            if d.get("hostname") == hostname:
                return copy.deepcopy(d)
        return None

    async def update_device(self, hostname: str, fields: dict) -> None:
        for device_id, d in self._devices.items():
            if d.get("hostname") == hostname:
                self._devices[device_id] = {**d, **copy.deepcopy(fields)}
                return

    async def save_action(self, doc: dict) -> str:
        action_id = uuid.uuid4().hex
        self._actions.append({**copy.deepcopy(doc), "_id": action_id})
        return action_id


store = MemoryStore()
