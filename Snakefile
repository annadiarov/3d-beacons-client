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
    print(f"  ... found {len(model_ids)} model ids")
    return model_ids


model_ids = gather_model_ids()

rule all:
    input:
        [f"{STAGING_DIR}/{m}.cleaned" for m in model_ids]

rule stage:
    """Copy PDB and metadata JSON from staging into a hash-based subdirectory."""
    input:
        pdb=f"{STAGING_DIR}/{{model}}.pdb",
        metadata=f"{STAGING_DIR}/{{model}}.json",
    output:
        marker=f"{STAGING_DIR}/{{model}}.staged",
    params:
        pdb_dir=lambda wc: f"{hash_dir(wc.model)}/pdb",
        metadata_dir=lambda wc: f"{hash_dir(wc.model)}/metadata",
    shell:
        "mkdir -p {params.pdb_dir} && "
        "mkdir -p {params.metadata_dir} && "
        "cp {input.pdb} {params.pdb_dir}/ && "
        "cp {input.metadata} {params.metadata_dir}/ && "
        "touch {output.marker}"

rule pdb2cif:
    """Convert a staged PDB file to mmCIF in its hash-based directory."""
    input:
        f"{STAGING_DIR}/{{model}}.staged",
    output:
        marker=f"{STAGING_DIR}/{{model}}.converted",
    params:
        pdb_path=lambda wc: f"{hash_dir(wc.model)}/pdb/{wc.model}.pdb",
        cif_dir=lambda wc: f"{hash_dir(wc.model)}/cif",
        cif_path=lambda wc: f"{hash_dir(wc.model)}/cif/{wc.model}.cif",
    shell:
        "mkdir -p {params.cif_dir} && "
        f"{CLI} convert-pdb2cif -i {{params.pdb_path}} -o {{params.cif_path}} && "
        "touch {output.marker}"

rule cif2index:
    """Create an index JSON document from CIF + metadata in the hash-based directory."""
    input:
        f"{STAGING_DIR}/{{model}}.converted",
    output:
        marker=f"{STAGING_DIR}/{{model}}.indexed",
    params:
        cif_path=lambda wc: f"{hash_dir(wc.model)}/cif/{wc.model}.cif",
        metadata_path=lambda wc: f"{hash_dir(wc.model)}/metadata/{wc.model}.json",
        index_dir=lambda wc: f"{hash_dir(wc.model)}/index",
        index_path=lambda wc: f"{hash_dir(wc.model)}/index/{wc.model}.index.json",
    shell:
        "mkdir -p {params.index_dir} && "
        f"{CLI} convert-cif2index -ic {{params.cif_path}} -im {{params.metadata_path}} -o {{params.index_path}} && "
        "touch {output.marker}"

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
        "rm -f {params.staging_dir}/{wildcards.model}.pdb "
        "      {params.staging_dir}/{wildcards.model}.json "
        "      {params.staging_dir}/{wildcards.model}.staged "
        "      {params.staging_dir}/{wildcards.model}.converted "
        "      {params.staging_dir}/{wildcards.model}.indexed "
        "      {params.staging_dir}/{wildcards.model}.loaded && "
        "touch {output.marker}"

onsuccess:
    import glob
    for f in glob.glob(f"{STAGING_DIR}/*.cleaned"):
        os.remove(f)
