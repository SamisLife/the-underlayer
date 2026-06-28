"""MongoDB connection. A single Motor client shared across the app."""

from motor.motor_asyncio import AsyncIOMotorClient

from .config import MONGO_DB, MONGO_URI

mongo_client = AsyncIOMotorClient(MONGO_URI)
db = mongo_client[MONGO_DB]
