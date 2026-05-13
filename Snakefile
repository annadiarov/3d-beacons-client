# type: ignore

import os
import glob
from pathlib import Path
from bio3dbeacons.hashpath import get_hash_subdir

DATA_ROOT = "data"
STAGING_DIR = f"{DATA_ROOT}/staging"

CLI = "3dbeacons-cli"


def hash_dir(model):
    """Return the hash-based root for a model, e.g. data/e_c/5_9"""
    return f"{DATA_ROOT}/{get_hash_subdir(model)}"


def gather_model_ids():
    """Discover model ids from indexed marker files in the staging directory."""
    staging = Path(STAGING_DIR)
    print(f"Searching for models in {staging} ...")
    indexed_ids = {f.stem for f in staging.iterdir() if f.suffix == ".indexed"}
    print(f"  ... found {len(indexed_ids)} model ids")
    return indexed_ids


model_ids = gather_model_ids()


rule all:
    input:
        f"{STAGING_DIR}/all.cleaned"


rule bulk_load:
    """Load ALL index JSONs into MongoDB in one single CLI call.
    Input: all .indexed marker files (guarantees all JSONs exist in hashed dirs).
    The CLI walks DATA_ROOT and finds all *.index.json files automatically.
    """
    input:
        expand("{staging}/{model}.indexed", staging=STAGING_DIR, model=model_ids)
    output:
        marker=f"{STAGING_DIR}/all.loaded"
    params:
        data_root=DATA_ROOT,
        cli=CLI,
        batch_size=1000,
    shell:
        "{params.cli} load-index -i {params.data_root} -b {params.batch_size} && "
        "touch {output.marker}"


rule cleanup:
    """Remove all staging marker files after successful DB load."""
    input:
        f"{STAGING_DIR}/all.loaded"
    output:
        marker=f"{STAGING_DIR}/all.cleaned"
    params:
        staging_dir=STAGING_DIR,
    shell:
        "rm -f {params.staging_dir}/*.indexed {params.staging_dir}/*.loaded && "
        "touch {output.marker}"


onsuccess:
    for f in glob.glob(f"{STAGING_DIR}/*.cleaned"):
        os.remove(f)
