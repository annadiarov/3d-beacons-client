import logging
from pathlib import Path
from typing import List
from bio3dbeacons.cli.modelmanager._modelrepository import ModelRepository
from bio3dbeacons.hashpath import get_hash_subdir

__all__ = ["delete_by_ids"]

LOG = logging.getLogger(__name__)

TARGET_SUBDIRS = ("cif", "index", "metadata", "pdb")
TARGET_EXTS = {
    "cif": ".cif",
    "index": ".index.json",
    "metadata": ".json",
    "pdb": ".pdb",
}

def delete_data_files_by_id(model_id: str):
    base = Path('data/' + get_hash_subdir(model_id))
    if not base.is_dir():
        LOG.warning("dir not found: %s", base)

    for sub in TARGET_SUBDIRS:
        subdir = base / sub
        if not subdir.is_dir():
            continue
        target = subdir / f"{model_id}{TARGET_EXTS[sub]}"
        try:
            if target.exists():
                target.unlink()
                LOG.info("Deleted %s", target)
            else:
                LOG.debug("Not found: %s", target)
        except Exception as e:
            LOG.warning("Failed to delete %s: %s", target, e)

def delete_by_ids(mongo_db_url: str, models_to_delete: List[str]):
    """ Delete a model from the repository by ids and removes the related files from assets """
    LOG.info(f"Trying to delete {len(models_to_delete)} models from repository")
    model_manager = ModelRepository(mongo_db_url)
    result = model_manager.delete_by_ids(models_to_delete)
    LOG.info(f"Deleted {result} models from repository")

    LOG.info(f"Trying to delete {len(models_to_delete)} models from data folder")
    deleted_files_count = 0
    for model_to_delete in models_to_delete:
        delete_data_files_by_id(model_to_delete)
        deleted_files_count += 1
    LOG.info(f"Deleted {deleted_files_count} models from data folder")


