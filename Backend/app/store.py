"""Storage backend abstraction.

The app persists three things: device summaries (`devices`), full scan history
(`device_scans`), and remediation actions (`actions`). With MONGO_URI set these live in
MongoDB; without it, an in-memory store is used so the app runs with zero external
dependencies (data lives until restart).

Routes call these high-level methods rather than touching the database driver directly.
All access happens on the single event loop (sync routes / background tasks reach it via
app.bridge), so the in-memory store needs no locking.
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

    async def ping(self) -> bool:
        return True

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


class MongoStore:
    name = "mongodb"

    def __init__(self, uri: str, db_name: str) -> None:
        from motor.motor_asyncio import AsyncIOMotorClient
        self._client = AsyncIOMotorClient(uri)
        self._db = self._client[db_name]

    async def ping(self) -> bool:
        await self._db.command("ping")
        return True

    async def clear_devices(self) -> int:
        result = await self._db.devices.delete_many({})
        return result.deleted_count

    async def save_scan(self, raw_doc: dict) -> str:
        result = await self._db.device_scans.insert_one(raw_doc)
        return str(result.inserted_id)

    async def upsert_device(self, device_id: str, fields: dict) -> None:
        await self._db.devices.update_one({"deviceId": device_id}, {"$set": fields}, upsert=True)

    async def list_devices(self) -> List[dict]:
        return [d async for d in self._db.devices.find({}, {"_id": 0})]

    async def list_ar_summaries(self) -> List[dict]:
        summaries = []
        async for d in self._db.devices.find({}, {"_id": 0, "arSummary": 1}):
            if "arSummary" in d:
                summaries.append(d["arSummary"])
        return summaries

    async def get_device(self, hostname: str) -> Optional[dict]:
        return await self._db.devices.find_one({"hostname": hostname}, {"_id": 0})

    async def update_device(self, hostname: str, fields: dict) -> None:
        await self._db.devices.update_one({"hostname": hostname}, {"$set": fields})

    async def save_action(self, doc: dict) -> str:
        result = await self._db.actions.insert_one(doc)
        return str(result.inserted_id)


def _make_store():
    from .config import MONGO_DB, MONGO_URI
    if MONGO_URI:
        return MongoStore(MONGO_URI, MONGO_DB)
    return MemoryStore()


store = _make_store()
