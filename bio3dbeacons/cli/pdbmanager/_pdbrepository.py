import logging
from typing import Collection, List

from pymongo import MongoClient

LOG = logging.getLogger(__name__)

class PdbRepository:
    model_collection: Collection

    def __init__(self, mongo_db_url: str):
        self.model_collection = MongoClient(mongo_db_url).models.modelCollection

    def delete_by_ids(self, pdb_to_delete: List[str]) -> int:
        res = self.model_collection.delete_many({"_id": {"$in": pdb_to_delete}})
        LOG.info(f"Deleted {res.deleted_count} documents from repository")

        return res.deleted_count
