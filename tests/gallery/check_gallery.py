#!/usr/bin/env python3
"""
Prueba rápida del listado de galería (GET /photos/), igual que usa el frontend.

Uso (API en marcha, p. ej. start.bat / gateway 8732):
  python tests/gallery/check_gallery.py
  set PHOTOS_API_BASE=http://127.0.0.1:18733 && python tests/gallery/check_gallery.py

Solo base de datos (sin servidor; SQLite en modo lectura):
  python tests/gallery/check_gallery.py --offline

Desde la raíz del repo (U:\\photosRecognizer o equivalente).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Raíz del repo: tests/gallery -> tests -> repo
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _http_get_json(url: str, timeout: float = 30.0) -> tuple[int, object]:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8", errors="replace")
        return resp.status, json.loads(body) if body.strip() else []


def check_http(base: str, min_items: int = 100, page_size: int = 60) -> int:
    """Replica carga tipo galería con EXIF: varias páginas hasta min_items o sin más datos."""
    base = base.rstrip("/")
    page_size = max(1, min(page_size, 1000))

    # Humo rápido (misma familia de URLs que antes)
    smoke = [
        f"{base}/photos/?skip=0&limit=5",
        f"{base}/photos/?skip=0&limit=5&has_exif_date=true",
        f"{base}/photos/?skip=0&limit=3&has_exif_date=false",
    ]
    for url in smoke:
        try:
            status, data = _http_get_json(url)
            n = len(data) if isinstance(data, list) else "?"
            print(f"OK  {status}  items={n}  {url}")
        except urllib.error.URLError as e:
            print(f"FAIL  {url}")
            print(f"      {type(e).__name__}: {e.reason!r}")
            print("      Levanta la app (start.bat) o define PHOTOS_API_BASE al puerto correcto.")
            return 1
        except Exception as e:
            print(f"FAIL  {url}  {type(e).__name__}: {e}")
            return 1

    # Galería “real”: con fecha EXIF, paginado (page_size como el frontend ~60)
    print(f"--- Paginado has_exif_date=true hasta >= {min_items} fotos (page_size={page_size}) ---")
    total_ok = 0
    skip = 0
    page = 0
    while total_ok < min_items:
        page += 1
        url = f"{base}/photos/?skip={skip}&limit={page_size}&has_exif_date=true"
        try:
            status, data = _http_get_json(url, timeout=120.0)
        except urllib.error.HTTPError as e:
            print(f"FAIL HTTP {e.code}  {url}")
            try:
                print(f"      body: {e.read().decode('utf-8', errors='replace')[:800]}")
            except Exception:
                pass
            return 1
        except urllib.error.URLError as e:
            print(f"FAIL URL {e.reason!r}  {url}")
            print("      ¿Está start.bat / el gateway escuchando? (por defecto 8732)")
            return 1
        except Exception as e:
            print(f"FAIL  {url}  {type(e).__name__}: {e}")
            return 1

        if not isinstance(data, list):
            print(f"FAIL respuesta no es lista: {type(data)}  {url}")
            return 1
        got = len(data)
        total_ok += got
        print(f"OK  página {page}  skip={skip}  +{got}  acumulado={total_ok}  HTTP {status}")
        if got == 0:
            print("      (no hay más filas con EXIF)")
            break
        skip += got
        if page > 500:
            print("FAIL demasiadas páginas, aborto")
            return 1

    if total_ok < min_items:
        print(f"WARN solo se obtuvieron {total_ok} fotos con EXIF (pedido mínimo {min_items})")
    else:
        print(f"OK  total fotos traídas con EXIF: {total_ok} (objetivo >= {min_items})")
    return 0


def check_offline(min_items: int = 100) -> int:
    from sqlalchemy import text
    from sqlalchemy.orm import Session, sessionmaker

    from indexer.db import DB_PATH, get_engine

    db_path = Path(os.environ.get("PHOTOS_DB_PATH", DB_PATH))
    if not db_path.is_file():
        print(f"FAIL No existe la BD: {db_path}")
        return 1

    try:
        engine = get_engine(db_path, read_only=True)
    except Exception as e:
        print(f"FAIL No se pudo abrir motor: {e}")
        return 1

    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    try:
        row = session.execute(text("PRAGMA integrity_check")).fetchone()
        ic = row[0] if row else ""
        if ic != "ok":
            print(f"WARN PRAGMA integrity_check: {ic!r}")

        # Consulta alineada con la galería (con fecha EXIF), sin ORM completo
        # para no exigir columnas añadidas por migraciones recientes en modo RO.
        sql = """
        SELECT f.id, f.path, f.exif_date
        FROM files f
        WHERE f.archived = 0 AND f.exif_date IS NOT NULL
        ORDER BY f.exif_date DESC, f.mtime DESC
        LIMIT :lim
        """
        rows = session.execute(text(sql), {"lim": max(min_items, 5)}).fetchall()
        print(f"OK  offline  con_exif  filas={len(rows)} (pedido min {min_items})")
        for r in rows[:3]:
            print(f"      id={r[0]} path={str(r[1])[:80]}")

        total = session.execute(
            text("SELECT COUNT(*) FROM files WHERE archived = 0")
        ).scalar()
        print(f"OK  offline  total no archivados = {total}")
    except Exception as e:
        print(f"FAIL consulta galería: {type(e).__name__}: {e}")
        return 1
    finally:
        session.close()

    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Probar GET /photos/ (galería)")
    p.add_argument(
        "--base-url",
        default=os.environ.get("PHOTOS_API_BASE", "http://127.0.0.1:8732").rstrip("/"),
        help="Base del API (gateway por defecto 8732)",
    )
    p.add_argument(
        "--offline",
        action="store_true",
        help="Solo SQLite en modo lectura, sin HTTP",
    )
    p.add_argument(
        "--min-items",
        type=int,
        default=100,
        help="Mínimo de ítems (HTTP: galería con EXIF paginada; --offline: LIMIT SQL)",
    )
    p.add_argument(
        "--page-size",
        type=int,
        default=60,
        help="Tamaño de página para el paginado HTTP (máx. 1000)",
    )
    args = p.parse_args()

    os.chdir(REPO_ROOT)
    if args.offline:
        return check_offline(min_items=args.min_items)
    return check_http(args.base_url, min_items=args.min_items, page_size=args.page_size)


if __name__ == "__main__":
    raise SystemExit(main())
