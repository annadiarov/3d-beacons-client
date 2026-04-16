import bio3dbeacons.cli.pdbmanager.pdbmanager as pdbmanager
from unittest.mock import patch, MagicMock

@patch("bio3dbeacons.cli.pdbmanager.pdbmanager.PdbRepository")
def test_manager_calls_repo(mock_repo_cls):
    mock_repo = MagicMock()
    mock_repo.delete_by_ids.return_value = 2
    mock_repo_cls.return_value = mock_repo

    mongo_url = "mongodb://fake"
    pdb_ids = ["id1", "id2"]

    ret = pdbmanager.delete_by_ids(mongo_url, pdb_ids)

    mock_repo_cls.assert_called_once_with(mongo_url)
    mock_repo.delete_by_ids.assert_called_once_with(pdb_ids)

    assert ret is None
