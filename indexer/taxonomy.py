"""
Taxonomía fija de etiquetas semánticas (CLIP texto ↔ imagen).
Incrementar TAXONOMY_VERSION al cambiar prompts o modelo CLIP asociado.
"""
from __future__ import annotations

from typing import List, TypedDict


class TaxonomyTag(TypedDict):
    id: str
    prompt: str


# Versión alineada con filas en file_tags (invalidar vía indexer al subir).
TAXONOMY_VERSION = 1

# Prompts en inglés (estándar CLIP); ids estables para API y UI.
TAXONOMY_TAGS: List[TaxonomyTag] = [
    {"id": "beach", "prompt": "a photo of a beach or ocean shoreline"},
    {"id": "food", "prompt": "a photo of food or a meal on a plate"},
    {"id": "document", "prompt": "a photo of a document, paper, or screenshot of text"},
    {"id": "pet", "prompt": "a photo of a dog or cat or pet animal"},
    {"id": "night", "prompt": "a photo taken at night or in the dark with artificial lights"},
    {"id": "screenshot", "prompt": "a screenshot of a computer or phone user interface"},
    {"id": "nature", "prompt": "a photo of nature, forest, mountains, or landscape without people"},
    {"id": "indoor", "prompt": "a photo taken indoors inside a room or building"},
    {"id": "sports", "prompt": "a photo of sports or athletic activity"},
    {"id": "vehicle", "prompt": "a photo of a car, motorcycle, or vehicle"},
    {"id": "portrait", "prompt": "a portrait photo of a person facing the camera"},
    {"id": "crowd", "prompt": "a photo of a crowd or many people in a public place"},
]


def tag_ids() -> List[str]:
    return [t["id"] for t in TAXONOMY_TAGS]


def prompts_ordered() -> List[str]:
    return [t["prompt"] for t in TAXONOMY_TAGS]
