import logging
import sys
from pathlib import Path

from prettyconf import config

import pymongo

try:
    import mongomock  # type: ignore
except ImportError:  # pragma: no cover - optional dev dependency
    mongomock = None
import pytest

import gemmi

sys.path.append(Path(__file__).parent.parent.as_posix())

from bio3dbeacons.cli.mongoload.mongoload import MongoLoad  # noqa

MONGO_USERNAME = config("MONGO_USERNAME", default=None)
MONGO_PASSWORD = config("MONGO_PASSWORD", default=None)
MONGO_DB_HOST = config("MONGO_DB_HOST", default="localhost:27017")


def _mongo_urls():
    """Yield Mongo URLs to try, preferring configured host then local fallbacks."""

    hosts = [MONGO_DB_HOST]
    for candidate in ("localhost:27017", "127.0.0.1:27017"):
        if candidate not in hosts:
            hosts.append(candidate)

    auth = ""
    if MONGO_USERNAME and MONGO_PASSWORD:
        auth = f"{MONGO_USERNAME}:{MONGO_PASSWORD}@"

    seen = set()
    for host in hosts:
        if host in seen:
            continue
        seen.add(host)
        yield f"mongodb://{auth}{host}"


LOG = logging.getLogger(__name__)


@pytest.fixture(scope="session")
def data_dir():
    return Path(__file__).parent / "data"


@pytest.fixture(scope="session")
def res_dir():
    return Path(__file__).parent.parent.parent / "resources"


@pytest.fixture(scope="session")
def cif_file(data_dir) -> str:
    f = data_dir / "cif" / "P38398_1jm7.1.A_1_103.cif"
    return f.as_posix()


@pytest.fixture(scope="session")
def pdb_file(data_dir) -> str:
    f = data_dir / "pdb" / "P38398_1jm7.1.A_1_103.pdb"
    return f.as_posix()


@pytest.fixture(scope="session")
def metadata_file(data_dir) -> str:
    f = data_dir / "metadata" / "P38398_1jm7.1.A_1_103.json"
    return f.as_posix()


@pytest.fixture(scope="function")
def cif_doc(cif_file) -> gemmi.cif.Document:
    return gemmi.cif.read_file(cif_file)


@pytest.fixture(scope="session")
def mongo_db():
    """Return a Mongo database handle.

    Tries the configured URL with a short timeout; if unreachable and mongomock
    is installed, falls back to mongomock so tests are hermetic.
    """

    last_exc = None

    for url in _mongo_urls():
        try:
            client = pymongo.MongoClient(
                url,
                serverSelectionTimeoutMS=1000,
                connectTimeoutMS=1000,
            )
            client.admin.command("ping")
            LOG.info("Connected to Mongo at %s", url)
            yield client.models
            return
        except Exception as exc:  # pragma: no cover - fallback only
            last_exc = exc
            LOG.warning("Mongo not reachable at %s (%s)", url, exc)

    if mongomock is None:
        pytest.skip(f"Mongo not reachable ({last_exc}) and mongomock not installed")

    LOG.warning("Mongo not reachable; using mongomock fallback")
    client = mongomock.MongoClient()
    yield client.models


@pytest.fixture(scope="function")
def mongo_collection(mongo_db):
    collection = mongo_db.modelCollection
    collection.delete_many({})
    yield collection
    collection.delete_many({})


@pytest.fixture(scope="function")
def mongo_load(mongo_collection) -> MongoLoad:
    ml = MongoLoad()
    ml.collection = mongo_collection

    return ml
