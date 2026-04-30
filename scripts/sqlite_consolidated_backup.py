#!/usr/bin/env python3
"""
Copia la base SQLite a un único archivo usando sqlite3.Connection.backup().

Incluye el contenido fusionado (equivalente a un checkpoint limpio): sirve para
archivar o copiar a otro disco sin depender de photos.db-wal / photos.db-shm.

Requisito: ningún otro proceso debe tener la BD abierta en escritura (cerrar
PhotosRecognizer / stop.bat). Si hay lectores, a veces funciona; si falla,
cierra todo y reintenta.
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser(description="Copia SQLite consolidada (un solo .db)")
    p.add_argument("src", type=Path, help="Origen, ej. data/photos.db")
    p.add_argument("dst", type=Path, help="Destino, ej. backup/photos.db")
    args = p.parse_args()
    src = args.src.resolve()
    dst = args.dst.resolve()
    if not src.is_file():
        print(f"No existe: {src}", file=sys.stderr)
        return 1
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.unlink()

    src_conn = sqlite3.connect(str(src), timeout=120)
    try:
        dst_conn = sqlite3.connect(str(dst), timeout=120)
        try:
            src_conn.backup(dst_conn)
        finally:
            dst_conn.close()
    finally:
        src_conn.close()

    n = dst.stat().st_size
    print(f"OK {dst} ({n} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
