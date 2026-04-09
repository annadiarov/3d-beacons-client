import hashlib
from bio3dbeacons.hashpath import get_hash_subdir


class TestHashpath:
    def test_deterministic(self):
        """Same input always gives the same output."""
        name = "P38398_1jm7.1.A_1_103"
        assert get_hash_subdir(name) == get_hash_subdir(name)

    def test_format(self):
        """Output must follow the ``XY/ZW`` pattern with hex characters."""
        result = get_hash_subdir("some_model_name")
        parts = result.split("/")
        assert len(parts) == 2
        for part in parts:
            assert len(part) == 2 and part.isalnum()

    def test_matches_md5(self):
        """Characters must come from the MD5 hex digest."""
        name = "testfile"
        h = hashlib.md5(name.encode()).hexdigest()
        expected = f"{h[0]}{h[1]}/{h[2]}{h[3]}"
        assert get_hash_subdir(name) == expected

    def test_different_names_differ(self):
        """Different names should (almost certainly) produce different paths."""
        a = get_hash_subdir("model_A")
        b = get_hash_subdir("model_B")
        # A collision is astronomically unlikely for these inputs
        assert a != b
