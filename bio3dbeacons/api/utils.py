from bio3dbeacons.hashpath import get_hash_subdir


def get_model_asset_url(assets_path: str, entry_id: str, model_format: str = "cif") -> str:
    """Returns model URL for an entry

    Args:
        assets_path (str): PATH to an asset folder
        entry_id (str): Unique ID for the model.
        model_format (str, optional): Model format. Defaults to "cif".

    Returns:
        [str]: Model URL
    """
    model_format = model_format.lower()
    hash_subdir = get_hash_subdir(entry_id)
    return f"{assets_path}/{hash_subdir}/{model_format}/{entry_id}.{model_format}"
