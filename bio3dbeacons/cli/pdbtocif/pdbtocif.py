import logging
import multiprocessing
import os
import subprocess
from concurrent.futures import ProcessPoolExecutor, as_completed

LOG = logging.getLogger(__name__)

GEMMI_BIN = os.environ.get("GEMMI_BIN", "gemmi")
DSSP_BIN = os.environ.get("DSSP_BIN", "mkdssp")
RUN_DSSP = os.environ.get("RUN_DSSP", "1") != "0"

DSSP_MMCIF_DICTIONARY = os.environ.get(
    "DSSP_MMCIF_DICTIONARY",
    "/var/cache/libcifpp/mmcif_pdbx.dic",
)

PROTEIN_RESIDUES = {
    "ALA", "ARG", "ASN", "ASP", "CYS",
    "GLN", "GLU", "GLY", "HIS", "ILE",
    "LEU", "LYS", "MET", "PHE", "PRO",
    "SER", "THR", "TRP", "TYR", "VAL",
}


class Pdb2Cif:
    def __init__(self, pdb_path: str, output_cif_path: str) -> None:
        self.pdb_path = pdb_path
        self.output_cif_path = output_cif_path

    def convert(self) -> int:      
        LOG.info("Converting PDB:%s to CIF:%s", self.pdb_path, self.output_cif_path)

        use_bin = os.environ.get("GEMMI_USE_BIN") == "1"

        if use_bin:
            result = self._convert_with_gemmi_binary()
        else:
            result = self._convert_with_library()
       
        if result != 0:
            return result

        patched_ok = self._patch_minimal_polymer_metadata()

        if RUN_DSSP and patched_ok:
            self._annotate_secondary_structure()
        elif RUN_DSSP and not patched_ok:
            LOG.warning(
                "Skipping DSSP because polymer metadata patch failed: %s",
                self.output_cif_path,
            )
        else:
            LOG.info("Skipping DSSP annotation because RUN_DSSP=0")

        return 0


    def _convert_with_gemmi_binary(self) -> int:
        try:
            cmd_args = [
                GEMMI_BIN,
                "convert",
                "--to",
                "mmcif",
                self.pdb_path,
                self.output_cif_path,
            ]

            subprocess.check_call(cmd_args)
            LOG.info("Converted %s to %s", self.pdb_path, self.output_cif_path)
            return 0

        except FileNotFoundError:
            LOG.warning("gemmi binary not found; falling back to python gemmi")
            return self._convert_with_library()

        except Exception as e:
            LOG.error("Error converting the PDB file: %s (err:%s)", self.pdb_path, e)
            LOG.debug(e)
            return 1

    def _convert_with_library(self) -> int:
        try:
            import gemmi

            structure = gemmi.read_structure(self.pdb_path)
            doc = structure.make_mmcif_document()

            with open(self.output_cif_path, "w", encoding="utf-8") as cif_file:
                cif_file.write(doc.as_string())

            # after writing, verify the output is a valid CIF with at least one block
            try:
                doc = gemmi.cif.read(self.output_cif_path)
                if len(doc) == 0:
                    LOG.error("Converted CIF has no data blocks: %s", self.output_cif_path)
                    return 1 # non-zero → pdb2cif rule fails → Snakemake retries pdb2cif

            except Exception as e:
                LOG.error("Converted CIF is invalid: %s", e)
                return 1

            return 0

        except Exception as e:
            LOG.error("Error converting the PDB file: %s (err:%s)", self.pdb_path, e)
            LOG.debug(e)
            return 1

    def _patch_minimal_polymer_metadata(self) -> bool:
        """
        Patch Gemmi-generated mmCIF so Mol* recognizes the structure as protein
        polymer rather than generic/non-polymer atoms.

        Critical fields for Mol*:
        - _entity.type = polymer
        - _entity_poly.type = polypeptide(L)
        - _entity_poly_seq
        - _struct_asym
        - _atom_site.label_entity_id
        - _atom_site.label_seq_id
        """
        tmp_cif_path = self.output_cif_path + ".patched.cif"

        try:
            import gemmi

            doc = gemmi.cif.read_file(self.output_cif_path)
            block = doc.sole_block()

            group_col = block.find_loop("_atom_site.group_PDB")
            comp_col = block.find_loop("_atom_site.label_comp_id")
            label_asym_col = block.find_loop("_atom_site.label_asym_id")
            auth_asym_col = block.find_loop("_atom_site.auth_asym_id")
            auth_seq_col = block.find_loop("_atom_site.auth_seq_id")
            label_entity_col = block.find_loop("_atom_site.label_entity_id")
            label_seq_col = block.find_loop("_atom_site.label_seq_id")

            required = [
                group_col,
                comp_col,
                label_asym_col,
                auth_asym_col,
                auth_seq_col,
                label_entity_col,
                label_seq_col,
            ]

            if not all(required):
                LOG.warning(
                    "Cannot patch polymer metadata because required atom_site columns are missing: %s",
                    self.output_cif_path,
                )
                return False

            chain_residues = {}
            chain_order = []

            for i in range(len(comp_col)):
                if group_col[i] != "ATOM":
                    continue

                comp_id = comp_col[i]
                if comp_id not in PROTEIN_RESIDUES:
                    continue

                label_asym_id = label_asym_col[i]
                auth_asym_id = auth_asym_col[i]
                auth_seq_id = auth_seq_col[i]

                if label_asym_id in {".", "?"}:
                    label_asym_id = auth_asym_id

                if label_asym_id not in chain_residues:
                    chain_residues[label_asym_id] = []
                    chain_order.append(label_asym_id)

                residue_key = (auth_seq_id, comp_id)

                if residue_key not in chain_residues[label_asym_id]:
                    chain_residues[label_asym_id].append(residue_key)

            if not chain_order:
                LOG.warning(
                    "No protein polymer chains detected while patching: %s",
                    self.output_cif_path,
                )
                return False

            chain_to_entity = {}
            chain_to_seq_map = {}

            entity = {
                "id": [],
                "type": [],
                "src_method": [],
                "pdbx_description": [],
                "formula_weight": [],
                "pdbx_number_of_molecules": [],
            }

            entity_poly = {
                "entity_id": [],
                "type": [],
                "nstd_linkage": [],
                "nstd_monomer": [],
            }

            entity_poly_seq = {
                "entity_id": [],
                "num": [],
                "mon_id": [],
                "hetero": [],
            }

            struct_asym = {
                "id": [],
                "pdbx_blank_PDB_chainid_flag": [],
                "pdbx_modified": [],
                "entity_id": [],
                "details": [],
            }

            for entity_index, chain_id in enumerate(chain_order, start=1):
                entity_id = str(entity_index)
                chain_to_entity[chain_id] = entity_id

                residues = chain_residues[chain_id]
                seq_map = {}

                for seq_index, (auth_seq_id, comp_id) in enumerate(residues, start=1):
                    seq_id = str(seq_index)
                    seq_map[(auth_seq_id, comp_id)] = seq_id

                    entity_poly_seq["entity_id"].append(entity_id)
                    entity_poly_seq["num"].append(seq_id)
                    entity_poly_seq["mon_id"].append(comp_id)
                    entity_poly_seq["hetero"].append("n")

                chain_to_seq_map[chain_id] = seq_map

                entity["id"].append(entity_id)
                entity["type"].append("polymer")
                entity["src_method"].append("man")
                entity["pdbx_description"].append(f"Chain {chain_id}")
                entity["formula_weight"].append("?")
                entity["pdbx_number_of_molecules"].append("1")

                entity_poly["entity_id"].append(entity_id)
                entity_poly["type"].append("polypeptide(L)")
                entity_poly["nstd_linkage"].append("no")
                entity_poly["nstd_monomer"].append("no")

                struct_asym["id"].append(chain_id)
                struct_asym["pdbx_blank_PDB_chainid_flag"].append("N")
                struct_asym["pdbx_modified"].append("N")
                struct_asym["entity_id"].append(entity_id)
                struct_asym["details"].append("?")

            for i in range(len(comp_col)):
                if group_col[i] != "ATOM":
                    continue

                comp_id = comp_col[i]
                if comp_id not in PROTEIN_RESIDUES:
                    continue

                label_asym_id = label_asym_col[i]
                auth_asym_id = auth_asym_col[i]
                auth_seq_id = auth_seq_col[i]

                if label_asym_id in {".", "?"}:
                    label_asym_id = auth_asym_id
                    label_asym_col[i] = label_asym_id

                entity_id = chain_to_entity.get(label_asym_id)
                seq_id = chain_to_seq_map.get(label_asym_id, {}).get((auth_seq_id, comp_id))

                if entity_id:
                    label_entity_col[i] = entity_id

                if seq_id:
                    label_seq_col[i] = seq_id

            # Safer than init_mmcif_loop/add_row: Gemmi replaces and serializes
            # the whole category consistently.
            block.set_mmcif_category("_entity", entity)
            block.set_mmcif_category("_entity_poly", entity_poly)
            block.set_mmcif_category("_entity_poly_seq", entity_poly_seq)
            block.set_mmcif_category("_struct_asym", struct_asym)

            with open(tmp_cif_path, "w", encoding="utf-8") as handle:
                handle.write(doc.as_string())

            # Validate patched CIF before replacing the original.
            gemmi.cif.read_file(tmp_cif_path)

            os.replace(tmp_cif_path, self.output_cif_path)

            LOG.info(
                "Patched polymer metadata and atom_site sequence mapping: %s",
                self.output_cif_path,
            )

            return True

        except Exception as e:
            LOG.warning(
                "Could not patch polymer metadata for %s; keeping Gemmi CIF. Error: %s",
                self.output_cif_path,
                e,
            )
            LOG.debug(e)
            return False

        finally:
            if os.path.exists(tmp_cif_path):
                try:
                    os.remove(tmp_cif_path)
                except OSError:
                    LOG.debug("Could not remove temporary patched CIF file: %s", tmp_cif_path)

    def _annotate_secondary_structure(self) -> int:
        tmp_cif_path = self.output_cif_path + ".dssp.cif"

        try:
            cmd_args = [
                DSSP_BIN,
                "--output-format",
                "mmcif",
                "--write-other",
                "--mmcif-dictionary",
                DSSP_MMCIF_DICTIONARY,
                self.output_cif_path,
                tmp_cif_path,
            ]

            subprocess.check_call(cmd_args)

            if not os.path.isfile(tmp_cif_path) or os.path.getsize(tmp_cif_path) == 0:
                LOG.warning(
                    "DSSP produced no usable output for %s; keeping original CIF",
                    self.output_cif_path,
                )
                return 0

            with open(tmp_cif_path, "r", encoding="utf-8", errors="ignore") as handle:
                dssp_text = handle.read()

            if "_atom_site." not in dssp_text:
                LOG.warning(
                    "DSSP output for %s has no _atom_site category; keeping original CIF",
                    self.output_cif_path,
                )
                return 0

            os.replace(tmp_cif_path, self.output_cif_path)

            LOG.info(
                "Annotated secondary structure with DSSP: %s",
                self.output_cif_path,
            )

            return 0

        except FileNotFoundError:
            LOG.warning(
                "mkdssp not found; CIF will not include DSSP secondary structure: %s",
                self.output_cif_path,
            )
            return 0

        except Exception as e:
            LOG.warning(
                "DSSP annotation failed for %s; keeping original CIF. Error: %s",
                self.output_cif_path,
                e,
            )
            LOG.debug(e)
            return 0

        finally:
            if os.path.exists(tmp_cif_path):
                try:
                    os.remove(tmp_cif_path)
                except OSError:
                    LOG.debug("Could not remove temporary DSSP file: %s", tmp_cif_path)

    @staticmethod
    def _three_to_one(residue_name: str) -> str:
        mapping = {
            "ALA": "A",
            "ARG": "R",
            "ASN": "N",
            "ASP": "D",
            "CYS": "C",
            "GLN": "Q",
            "GLU": "E",
            "GLY": "G",
            "HIS": "H",
            "ILE": "I",
            "LEU": "L",
            "LYS": "K",
            "MET": "M",
            "PHE": "F",
            "PRO": "P",
            "SER": "S",
            "THR": "T",
            "TRP": "W",
            "TYR": "Y",
            "VAL": "V",
        }
        return mapping.get(residue_name, "X")


def process(pdb_path: str, output_cif_path: str) -> int:
    pdbtocif = Pdb2Cif(pdb_path=pdb_path, output_cif_path=output_cif_path)
    return pdbtocif.convert()


def run(pdb_path: str, output_cif_path: str) -> int:
    if os.path.isdir(pdb_path):
        if os.path.isfile(output_cif_path):
            LOG.error("%s is a file, must provide a directory", output_cif_path)
            return 1

        os.makedirs(output_cif_path, exist_ok=True)
        LOG.info("Created directory %s", output_cif_path)

        futures = []

        with ProcessPoolExecutor(max_workers=multiprocessing.cpu_count() + 1) as pool:
            for root, _, filenames in os.walk(pdb_path):
                for pdb_file in filter(lambda x: x.endswith(".pdb"), filenames):
                    cif_file = pdb_file.replace(".pdb", ".cif")
                    pdb_file_path = os.path.join(root, pdb_file)
                    output_cif_file_path = os.path.join(output_cif_path, cif_file)

                    futures.append(
                        pool.submit(process, pdb_file_path, output_cif_file_path)
                    )

            exit_code = 0

            for future in as_completed(futures):
                result = future.result()
                if result != 0:
                    exit_code = result

            return exit_code

    if not os.path.isfile(pdb_path):
        LOG.error("PDB file '%s' not found!", pdb_path)
        return 1

    pdbtocif = Pdb2Cif(pdb_path=pdb_path, output_cif_path=output_cif_path)
    return pdbtocif.convert()
