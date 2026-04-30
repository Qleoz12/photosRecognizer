"""
Calcula etiquetas semánticas (taxonomía CLIP) y las guarda en file_tags.
Uso: python -m indexer.tag_clip_taxonomy [--limit N] [--taxonomy-version V]
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone

import numpy as np
from sqlalchemy.orm import Session
from tqdm import tqdm

from indexer.db import FileClipEmbedding, FileTag, get_engine, File as FileModel
from indexer.db import bytes_to_embedding
from indexer.region_embedder import embed_text_prompts
from indexer.taxonomy import TAXONOMY_TAGS, TAXONOMY_VERSION


def run_tagging(limit: int | None, taxonomy_version: int, min_score: float = 0.22) -> int:
    engine = get_engine()
    tag_ids = [t["id"] for t in TAXONOMY_TAGS]
    prompts = [t["prompt"] for t in TAXONOMY_TAGS]
    text_mat = embed_text_prompts(prompts)  # (K, 512)

    with Session(engine) as session:
        q = (
            session.query(FileClipEmbedding.file_id, FileClipEmbedding.embedding)
            .join(FileModel, FileClipEmbedding.file_id == FileModel.id)
            .filter(FileModel.file_type == "photo")
            .filter(FileModel.archived == 0)
        )
        if limit:
            q = q.limit(limit)
        rows = q.all()

        if not rows:
            print("No hay file_clip_embeddings para etiquetar.", flush=True)
            return 0

        processed = 0
        for file_id, emb_blob in tqdm(rows, desc="CLIP taxonomy", unit="img"):
            emb = bytes_to_embedding(emb_blob).astype(np.float32)
            emb = emb / (np.linalg.norm(emb) + 1e-9)
            scores = emb @ text_mat.T

            session.query(FileTag).filter(
                FileTag.file_id == file_id,
                FileTag.taxonomy_version == taxonomy_version,
            ).delete(synchronize_session=False)

            for j, tag_id in enumerate(tag_ids):
                s = float(scores[j])
                if s < min_score:
                    continue
                session.add(
                    FileTag(
                        file_id=file_id,
                        tag_id=tag_id,
                        taxonomy_version=taxonomy_version,
                        score=s,
                        computed_at=datetime.now(timezone.utc),
                    )
                )
            processed += 1
            if processed % 100 == 0:
                session.commit()
        session.commit()
        print(
            f"Etiquetados {processed} archivos (taxonomy_version={taxonomy_version}, min_score={min_score}).",
            flush=True,
        )
        return processed


def main() -> None:
    p = argparse.ArgumentParser(description="Etiquetas CLIP por taxonomía fija → file_tags")
    p.add_argument("--limit", type=int, default=None, help="Máximo de fotos a procesar (debug)")
    p.add_argument(
        "--taxonomy-version",
        type=int,
        default=TAXONOMY_VERSION,
        help=f"Versión a escribir (default {TAXONOMY_VERSION})",
    )
    p.add_argument("--min-score", type=float, default=0.22, help="Umbral mínimo coseno para guardar etiqueta")
    args = p.parse_args()
    run_tagging(args.limit, args.taxonomy_version, min_score=args.min_score)


if __name__ == "__main__":
    main()
