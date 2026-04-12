"""
Puerta de enlace HTTP para SQLite bajo carga: varias instancias de solo lectura + una escritora.

- GET/HEAD/OPTIONS → READ_UPSTREAM (Uvicorn con PHOTOS_API_MODE=read, varios --workers).
- POST salvo rutas declaradas como solo-lectura → WRITE_UPSTREAM (1 worker, escritura real).
- POST /search/* excepto /search/recluster e /search/invalidate-index → lectura (búsqueda sin mutar BD).
- POST /people/{id}/find-similar-in-page → lectura.

Variables de entorno:
  READ_UPSTREAM   default http://127.0.0.1:18734
  WRITE_UPSTREAM  default http://127.0.0.1:18733
  GATEWAY_SERIALIZE_WRITES  default 1 — cola global en el gateway para mutaciones (PATCH/POST/…)
    hacia el único API escritor; evita ráfagas concurrentes sobre un solo proceso SQLite.

No uses dos procesos Uvicorn «write» contra el mismo photos.db: SQLite solo serializa un escritor
real; varios procesos generan locks y errores. Más lectores sí (API_READ_WORKERS).

Limitación: índices en memoria (p. ej. /search/face) y centroides quedan por proceso; tras
re-cluster en el escritor, los workers de lectura pueden servir datos viejos hasta que se
reconstruya el índice en ese proceso (p. ej. reiniciar lectura o esperar TTL interno si existe).

Ante cortes TCP intermitentes hacia el upstream (p. ej. httpx.ReadError al leer cabeceras),
se reintenta una vez las peticiones idempotentes; el resto devuelve 502 si el upstream cae.
"""
from __future__ import annotations

import asyncio
import logging
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

logger = logging.getLogger(__name__)

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


def _proxy_retryable(method: str, path: str) -> bool:
    """Solo reintentar si es seguro repetir la petición (sin efectos duplicados)."""
    m = method.upper()
    if m in ("GET", "HEAD", "OPTIONS"):
        return True
    return m == "POST" and _is_read_safe_post(path)


def _filter_response_headers(headers: httpx.Headers) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in headers.items():
        if k.lower() in _HOP_BY_HOP:
            continue
        out[k] = v
    return out


def _gateway_serialize_writes() -> bool:
    v = os.environ.get("GATEWAY_SERIALIZE_WRITES", "1").strip().lower()
    return v not in ("0", "false", "no", "off")


@asynccontextmanager
async def _lifespan(app: Starlette) -> AsyncIterator[None]:
    timeout = httpx.Timeout(600.0, connect=30.0)
    limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
    app.state.write_lock = asyncio.Lock()
    async with httpx.AsyncClient(timeout=timeout, limits=limits, follow_redirects=False) as client:
        app.state.http = client
        yield


async def _proxy_upstream(
    request: Request,
    base: str,
    body: bytes,
) -> Response:
    url = f"{base}{request.url.path}"
    q = request.url.query
    if q:
        url = f"{url}?{q}"

    hdrs = {k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP}
    client: httpx.AsyncClient = request.app.state.http

    max_attempts = 2 if _proxy_retryable(request.method, request.url.path) else 1
    _RETRIABLE = (httpx.ReadError, httpx.ConnectError, httpx.RemoteProtocolError)
    resp: httpx.Response | None = None
    for attempt in range(max_attempts):
        req = client.build_request(
            request.method,
            url,
            headers=hdrs,
            content=body if body else None,
        )
        try:
            resp = await client.send(req, stream=True)
            break
        except _RETRIABLE as exc:
            if attempt + 1 < max_attempts:
                logger.warning(
                    "gateway proxy retry %s %s (attempt %s/%s): %s",
                    request.method,
                    request.url.path,
                    attempt + 1,
                    max_attempts,
                    exc,
                )
                continue
            logger.error(
                "gateway proxy upstream failed %s %s: %s",
                request.method,
                request.url.path,
                exc,
            )
            return Response(
                status_code=502,
                content=b"Bad Gateway: upstream connection error",
                media_type="text/plain",
            )

    assert resp is not None

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


async def _proxy(request: Request) -> Response:
    base = _upstream_for(request.method, request.url.path)
    body = await request.body()

    if _gateway_serialize_writes() and base == WRITE_UPSTREAM:
        async with request.app.state.write_lock:
            return await _proxy_upstream(request, base, body)
    return await _proxy_upstream(request, base, body)


routes = [
    Route("/", endpoint=_proxy, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
    Route("/{path:path}", endpoint=_proxy, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
]

app = Starlette(routes=routes, lifespan=_lifespan)
