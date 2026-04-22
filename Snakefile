# type: ignore

from pathlib import Path
from bio3dbeacons.hashpath import get_hash_subdir

DATA_ROOT = "data"
STAGING_DIR = f"{DATA_ROOT}/staging"

CLI = "3dbeacons-cli"

def hash_dir(model):
    """Return the hash-based root for a model, e.g. data/e_c/5_9"""
    return f"{DATA_ROOT}/{get_hash_subdir(model)}"

def gather_model_ids():
    """Discover model ids from PDB files in the staging directory."""
    staging = Path(STAGING_DIR)
    print(f"Searching for models in {staging} ...")
    model_ids = [f.stem for f in staging.iterdir() if f.suffix == ".pdb"]
    json_ids = [f.stem for f in staging.iterdir() if f.suffix == ".json"]
    indexed_ids = [f.stem for f in staging.iterdir() if f.suffix == ".indexed"]
    model_ids_set = set(model_ids)
    json_ids_set = set(json_ids)
    indexed_ids_set = set(indexed_ids)
    if len(indexed_ids) == 0:
        valid_model_ids = json_ids_set.intersection(model_ids_set)
    else:
        valid_model_ids = indexed_ids_set
    print(f"Model id {valid_model_ids} ...")

    print(f"  ... found {len(valid_model_ids)} model ids")
    return valid_model_ids


model_ids = gather_model_ids()

rule all:
    input:
        [f"{STAGING_DIR}/{m}.cleaned" for m in model_ids]

rule loadindex:
    """Load the index JSON document into MongoDB."""
    input:
        f"{STAGING_DIR}/{{model}}.indexed"
    output:
        marker=f"{STAGING_DIR}/{{model}}.loaded",
    params:
        index_path=lambda wc: f"{hash_dir(wc.model)}/index/{wc.model}.index.json",
    shell:
        f"{CLI} load-index -i {{params.index_path}} && "
        "touch {output.marker}"

rule cleanup:
    """Remove all staging files for a model after successful DB load."""
    input:
        f"{STAGING_DIR}/{{model}}.loaded",
    output:
        marker=f"{STAGING_DIR}/{{model}}.cleaned",
    params:
        staging_dir=STAGING_DIR,
    shell:
        "rm -f {params.staging_dir}/{wildcards.model}.indexed "
        "      {params.staging_dir}/{wildcards.model}.loaded && "
        "touch {output.marker}"

onsuccess:
    import glob
    for f in glob.glob(f"{STAGING_DIR}/*.cleaned"):
        os.remove(f)
