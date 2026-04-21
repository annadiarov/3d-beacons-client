import logging
from typing import List
from bio3dbeacons.cli.modelmanager._modelrepository import ModelRepository
__all__ = ["delete_by_ids"]

LOG = logging.getLogger(__name__)

def delete_by_ids(mongo_db_url: str, models_to_delete: List[str]):
    LOG.info(f"Trying to delete {len(models_to_delete)} models from repository")
    model_manager = ModelRepository(mongo_db_url)
    result = model_manager.delete_by_ids(models_to_delete)
    LOG.info(f"Deleted {result} models from repository")
