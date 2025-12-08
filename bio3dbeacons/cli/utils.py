import json
import logging
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict

import requests  # type: ignore[import-untyped]
from requests import RequestException

from bio3dbeacons.config.config import get_config, get_config_keys

LOG = logging.getLogger(__name__)


def get_avg_plddt_from_pdb(pdb_path: str | Path) -> float:
    """Returns the average pLDDT score from PDB file (from temp factor)

    Args:
        pdb_path: Path to PDB file

    """

    # ATOM      1  N   GLU A   1       0.599  -0.769  -0.906  1.00  6.85           N

    plddt_total: float = 0.0
    residue_count = 0
    current_res_seq_num = None
    path_obj = Path(pdb_path)
    with path_obj.open("r") as fh:
        for line in fh:
            if not line.startswith("ATOM"):
                continue
            res_seq_num = int(line[22:26].strip())
            temperature_factor = float(line[60:66].strip())

            if current_res_seq_num != res_seq_num:
                current_res_seq_num = res_seq_num
                plddt_total += temperature_factor
                residue_count += 1

    avg_plddt = plddt_total / residue_count

    LOG.info(f"residues: {residue_count}")
    LOG.info(f"avg_plddt: {avg_plddt}")

    return avg_plddt


def prepare_data_dictionary_from_cif(cif_block: Any) -> Dict:
    """Returns a Python object from a CIF block (read by GEMMI)

    Args:
        cif_block (Any): CIF block for the data

    Returns:
        Dict: Python object which maps the configuration from CIF block.
    """
    data_dict = dict()

    data_dict["entryId"] = cif_block.find_value("_entry.id")
    data_dict["experimentalMethod"] = cif_block.find_value("_exptl.method")

    entity_dict = dict()
    entity_mmcif_cat = cif_block.find_mmcif_category("_entity.")

    if entity_mmcif_cat and "type" in entity_mmcif_cat.tags:
        # Standard case: use _entity + _struct_asym to map chains
        for row in entity_mmcif_cat:
            entity_dict[row["id"]] = {
                "entityType": row["type"],
                "entityDescription": row["pdbx_description"]
                if "pdbx_description" in entity_mmcif_cat.tags
                else "",
                "chainIds": [],
            }

        struct_asym_cat = cif_block.find_mmcif_category("_struct_asym.")
        has_entity_id = "entity_id" in struct_asym_cat.tags
        has_entity_type = "entity_type" in struct_asym_cat.tags

        for row in struct_asym_cat:
            chain_id = row["id"]
            try:
                entity_id = row["entity_id"] if has_entity_id else ""
            except KeyError:
                entity_id = ""

            if entity_id in {"?", ".", None}:
                entity_id = ""

            if entity_id not in entity_dict:
                entity_dict[entity_id] = {
                    "entityType": row["entity_type"] if has_entity_type else "",
                    "entityDescription": "",
                    "chainIds": [],
                }

            entity_dict[entity_id]["chainIds"].append(chain_id)
    else:
        # Fallback for CIFs lacking _entity: infer entities from _atom_site data.
        atom_site_cat = cif_block.find_mmcif_category("_atom_site.")
        if not atom_site_cat:
            data_dict["entities"] = []
            return data_dict

        polymer_chains = set()
        hetatm_present = False

        for idx in range(len(atom_site_cat)):
            row = atom_site_cat[idx]

            try:
                group = row["_atom_site.group_PDB"]
            except KeyError:
                group = row.get("group_PDB", "ATOM") if hasattr(row, "get") else "ATOM"

            try:
                chain = row["_atom_site.auth_asym_id"]
            except KeyError:
                chain = row.get("auth_asym_id", "") if hasattr(row, "get") else ""

            if chain in {"?", ".", None, ""}:
                try:
                    chain = row["_atom_site.label_asym_id"]
                except KeyError:
                    chain = row.get("label_asym_id", "") if hasattr(row, "get") else ""

            if group == "HETATM":
                hetatm_present = True
            elif chain:
                polymer_chains.add(chain)

        if polymer_chains:
            entity_dict["polymer"] = {
                "entityType": "polymer",
                "entityDescription": "",
                "chainIds": [
                    f"{c}poly" if not str(c).endswith("poly") else str(c)
                    for c in sorted(polymer_chains)
                ],
            }

        if hetatm_present:
            entity_dict["non-polymer"] = {
                "entityType": "non-polymer",
                "entityDescription": "",
                "chainIds": [],
            }

    data_dict["entities"] = list(entity_dict.values())

    return data_dict


def prepare_data_dictionary(cif_block: Any, config_section: str) -> Dict:
    """Returns a Python object from a CIF block (read by GEMMI) from a config

    Args:
        cif_block (Any): CIF bloc for the data
        config_section (str): Section in conf.ini where the mapping is provided

    Returns:
        Dict: Python object which maps the configuration from CIF block.
    """

    data_dict: Dict = dict()

    for key in get_config_keys(config_section):
        mapping = get_config(config_section, key)
        data_dict[key] = cif_block.find_value(mapping)

    return data_dict


def get_uniprot_xml(accession: str) -> ET.Element | None:
    """Gets UniProt XML

    Args:
        accession (str): A UniProt accession

    Returns:
        ET.Element: An XML element
    """

    uniprot_xml_url = get_config("cli", "UNIPROT_XML_URL")

    try:
        response = requests.get(f"{uniprot_xml_url}/{accession}.xml", timeout=10)
    except RequestException as e:
        LOG.error("Error fetching UniProt XML for %s", accession)
        LOG.debug(e)
        return None

    if not response.ok:
        LOG.warning(
            "UniProt XML lookup failed for %s (status %s)",
            accession,
            response.status_code,
        )
        return None

    try:
        root = ET.fromstring(response.content)
    except ET.ParseError as e:
        LOG.error("Error parsing UniProt XML for %s", accession)
        LOG.debug(e)
        return None

    if root.tag.lower() == "errorinfo":
        LOG.warning("UniProt returned errorInfo for %s", accession)
        return None

    return root


def prepare_data_dictionary_from_json(json_file: str):
    """Gets a Python object from a JSON file

    Args:
        json_file (str): Path to the JSON file

    Returns:
        [Any]: A Python object
    """
    return json.load(open(json_file, "r"))
