import logging
from typing import List
from bio3dbeacons.cli.pdbmanager._pdbrepository import PdbRepository
__all__ = ["delete_by_ids"]

LOG = logging.getLogger(__name__)

def delete_by_ids(mongo_db_url: str, pdbs_to_delete: List[str]):
    LOG.info(f"Trying to delete {len(pdbs_to_delete)} pdbs from repository")
    pdb_manager = PdbRepository(mongo_db_url)
    result = pdb_manager.delete_by_ids(pdbs_to_delete)
    LOG.info(f"Deleted {result} pdbs from repository")
