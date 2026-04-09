from bio3dbeacons.api import utils
from bio3dbeacons.hashpath import get_hash_subdir


class TestUtils:
    def test_get_model_asset_url_default(self):
        subdir = get_hash_subdir("someEntryId")
        result = utils.get_model_asset_url("someEntryId")
        assert result == f"static/{subdir}/cif/someEntryId.cif"

    def test_get_model_asset_url_pdb(self):
        subdir = get_hash_subdir("someEntryId")
        result = utils.get_model_asset_url("someEntryId", "pdb")
        assert result == f"static/{subdir}/pdb/someEntryId.pdb"
