"""
Puerta de enlace HTTP para SQLite bajo carga: varias instancias de solo lectura + una escritora.

- GET/HEAD/OPTIONS → READ_UPSTREAM (Uvicorn con PHOTOS_API_MODE=read, varios --workers).
- POST salvo rutas declaradas como solo-lectura → WRITE_UPSTREAM (1 worker, escritura real).
- POST /search/* excepto /search/recluster e /search/invalidate-index → lectura (búsqueda sin mutar BD).
- POST /people/{id}/find-similar-in-page → lectura.

Variables de entorno:
  READ_UPSTREAM   default http://127.0.0.1:18734
  WRITE_UPSTREAM  default http://127.0.0.1:18733

Limitación: índices en memoria (p. ej. /search/face) y centroides quedan por proceso; tras
re-cluster en el escritor, los workers de lectura pueden servir datos viejos hasta que se
reconstruya el índice en ese proceso (p. ej. reiniciar lectura o esperar TTL interno si existe).
"""
from __future__ import annotations

import os
import re
from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import Response, StreamingResponse
from starlette.routing import Route

READ_UPSTREAM = os.environ.get("READ_UPSTREAM", "http://127.0.0.1:18734").rstrip("/")
WRITE_UPSTREAM = os.environ.get("WRITE_UPSTREAM", "http://127.0.0.1:18733").rstrip("/")

_HOP_BY_HOP = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
        "host",
    }
)


def _norm_path(path: str) -> str:
    if not path.startswith("/"):
        path = "/" + path
    return path.rstrip("/") or "/"


def _is_read_safe_post(path: str) -> bool:
    p = _norm_path(path)
    if p.startswith("/search/"):
        if p in ("/search/recluster", "/search/invalidate-index"):
            return False
        return True
    if re.match(r"^/people/\d+/find-similar-in-page$", p):
        return True
    return False


def _upstream_for(method: str, path: str) -> str:
    m = method.upper()
    if m in ("GET", "HEAD", "OPTIONS"):
        return READ_UPSTREAM
    if m == "POST" and _is_read_safe_post(path):
        return READ_UPSTREAM
    return WRITE_UPSTREAM


def _filter_response_headers(headers: httpx.Headers) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in headers.items():
        if k.lower() in _HOP_BY_HOP:
            continue
        out[k] = v
    return out


@asynccontextmanager
async def _lifespan(app: Starlette) -> AsyncIterator[None]:
    timeout = httpx.Timeout(600.0, connect=30.0)
    limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
    async with httpx.AsyncClient(timeout=timeout, limits=limits, follow_redirects=False) as client:
        app.state.http = client
        yield


async def _proxy(request: Request) -> Response:
    base = _upstream_for(request.method, request.url.path)
    url = f"{base}{request.url.path}"
    q = request.url.query
    if q:
        url = f"{url}?{q}"

    hdrs = {k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP}
    body = await request.body()
    client: httpx.AsyncClient = request.app.state.http

    req = client.build_request(
        request.method,
        url,
        headers=hdrs,
        content=body if body else None,
    )
    resp = await client.send(req, stream=True)

    async def stream_body() -> AsyncIterator[bytes]:
        try:
            async for chunk in resp.aiter_raw():
                yield chunk
        finally:
            await resp.aclose()

    return StreamingResponse(
        stream_body(),
        status_code=resp.status_code,
        headers=_filter_response_headers(resp.headers),
    )


routes = [
    Route("/", endpoint=_proxy, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
    Route("/{path:path}", endpoint=_proxy, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
]

app = Starlette(routes=routes, lifespan=_lifespan)
