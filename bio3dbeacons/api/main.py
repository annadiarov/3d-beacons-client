import os
from typing import Any, List

from fastapi import FastAPI, HTTPException
from fastapi.params import Path, Query
from starlette import status
from starlette.responses import HTMLResponse, JSONResponse

from bio3dbeacons.api import SingletonMongoDB, ASSETS_URL
from bio3dbeacons.api.constants import UNIPROT_QUAL_DESC, UNIPROT_RANGE_DESC
from bio3dbeacons.api.models.uniprot_model import (
    UniprotSummary,
    UniprotEntry,
    SummaryItems,
    Entity,
    Overview,
    AFAverageConfidenceMetrics,
    UniprotAverageMetrics
)
from bio3dbeacons.api.utils import get_model_asset_url

FORMAT_EXTENSION_MAP = {
    "MMCIF": "cif",
    "PDB": "pdb",
    "BCIF": "bcif",
}

app = FastAPI(version="2.0.0")

# @app.exception_handler(StarletteHTTPException)
# async def http_exception_handler(request, exc):
#     return JSONResponse({'message':str(exc.detail)}, status_code=exc.status_code)
#
#
# @app.exception_handler(RequestValidationError)
# async def validation_exception_handler(request, exc: RequestValidationError):
#     message = "Validation errors:"
#     for error in exc.errors():
#         message += f"\nField: {error['loc']}, Error: {error['msg']}"
#     return JSONResponse({'message': message}, status_code=400)

@app.get(
    "/uniprot/summary/{qualifier}.json",
    status_code=status.HTTP_200_OK,
    summary="Get summary details for a UniProt residue range",
    description="Get all models for the UniProt residue range.",
    response_model=UniprotSummary,
    response_model_exclude_unset=True,
)
async def get_uniprot_summary_api(
    qualifier: Any = Path(..., description=UNIPROT_QUAL_DESC),
    res_range: Any = Query(None, alias="range", description=UNIPROT_RANGE_DESC),
):
    f"""Returns summary details details for a UniProt accession

    Args:
        qualifier (Any): {UNIPROT_QUAL_DESC}
        range (Any, optional): {UNIPROT_RANGE_DESC} Defaults to None.

    Raises:
        HTTPException: Raised when there are validation issues with parameters

    Returns:
        Model: A Model object
    """

    range_present = False if not res_range else True
    residue_start = residue_end = None
    qualifier = qualifier.upper()

    if range_present and res_range:
        if "-" not in res_range:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="range parameter should be residue start and residue"
                " end separated by -",
            )
        if res_range is not None:
            [residue_start, residue_end] = res_range.split("-")

            if not (residue_start.isnumeric() and residue_end.isnumeric()):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="residue ranges should be numbers",
                )

    models_db = SingletonMongoDB.get_models_db()
    model_collection = models_db.modelCollection

    results = model_collection.find(
        {
            "$or": [
                {"mappingAccession": {"$eq": qualifier}},
                {"mappingId": {"$eq": qualifier}},
            ],
            "$and": [
                {"mappingAccessionType": {"$eq": "uniprot"}},
            ],
        }
    )

    overview_items: List[Overview] = []
    uniprot_entry = None

    async for row in results:
        uniprot_entry = UniprotEntry(
            ac=row["mappingAccession"],
            id=row["mappingId"],
        )
        overview_items.append(
            Overview(
                summary=SummaryItems(
                    model_identifier=row["entryId"],
                    model_category=row["modelCategory"],
                    model_url=get_model_asset_url(
                        ASSETS_URL,
                        row["entryId"],
                        FORMAT_EXTENSION_MAP.get(os.environ.get("MODEL_FORMAT", "MMCIF"),"cif")
                    ),
                    provider=os.environ.get("PROVIDER"),
                    uniprot_start=row["start"],
                    uniprot_end=row["end"],
                    model_format=os.environ.get("MODEL_FORMAT", "MMCIF"),
                    created=row["createdDate"],
                    sequence_identity=row["sequenceIdentity"],
                    coverage=row["coverage"],
                    entities=[
                        Entity(
                            entity_type=x["entityType"].upper(),
                            description=""
                            if not x["entityDescription"]
                            else x["entityDescription"],
                            chain_ids=x["chainIds"],
                        )
                        for x in row["entities"]
                    ],
                )
            )
        )

    if not overview_items:
        return JSONResponse(content={}, status_code=status.HTTP_404_NOT_FOUND)

    return UniprotSummary(
        uniprot_entry=uniprot_entry,
        structures=overview_items,
    )

@app.get(
    "/uniprot/{qualifier}/metrics",
    status_code=status.HTTP_200_OK,
    summary="Get metrics for a UniProt residue range",
    description="Get all models for the UniProt metrics.",
    response_model=UniprotAverageMetrics,
    response_model_exclude_unset=True,
)
async def get_uniprot_metrics_api(
    qualifier: Any = Path(..., description=UNIPROT_QUAL_DESC),
):
    f"""Returns metrics details for a UniProt accession

    Args:
        qualifier (Any): {UNIPROT_QUAL_DESC}
    Raises:
        HTTPException: Raised when there are validation issues with parameters

    Returns:
        Model: A Model object
    """

    qualifier = qualifier.upper()
    models_db = SingletonMongoDB.get_models_db()
    model_collection = models_db.modelCollection
    results = model_collection.find(
        {
            "$or": [
                {"mappingAccession": {"$eq": qualifier}},
                {"mappingId": {"$eq": qualifier}},
            ],
            "$and": [
                {"mappingAccessionType": {"$eq": "uniprot"}},
            ],
        }
    )

    metrics: List[AFAverageConfidenceMetrics] = []
    uniprot_entry = None

    async for row in results:
        uniprot_entry = UniprotEntry(
            ac=row["mappingAccession"],
            id=row["mappingId"],
        )
        metrics.append(
            AFAverageConfidenceMetrics(
                model_identifier=row["entryId"],
                model_url=get_model_asset_url(
                    ASSETS_URL,
                    row["entryId"],
                    FORMAT_EXTENSION_MAP.get(os.environ.get("MODEL_FORMAT", "MMCIF"), "cif")
                ),
                provider=os.environ.get("PROVIDER"),
                uniprot_start=row["start"],
                uniprot_end=row["end"],
                coverage=row["coverage"],
                average_pLDDT=row["Average_pLDDT"],
                average_pTM=row["Average_pTM"],
                average_i_pTM=row["Average_i_pTM"],
                average_pAE=row["Average_pAE"],
                average_i_pAE=row["Average_i_pAE"],
                average_ipSAE=row["Average_ipSAE"],
                average_i_pLDDT=row["Average_i_pLDDT"],
            )
        )

    if not metrics:
        return JSONResponse(content={}, status_code=status.HTTP_404_NOT_FOUND)

    return UniprotAverageMetrics(
        uniprot_entry=uniprot_entry,
        metrics=metrics
    )

@app.get("/health-check", include_in_schema=False)
def health_check():
    return HTMLResponse("success", status_code=status.HTTP_200_OK)
