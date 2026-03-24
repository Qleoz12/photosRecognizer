"""
Streaming de vídeo con soporte HTTP Range (206) para que el visor del navegador pueda adelantar / saltar.
"""
import re
from pathlib import Path

from fastapi import Request
from fastapi.responses import Response, StreamingResponse

VIDEO_MEDIA_TYPES: dict[str, str] = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".wmv": "video/x-ms-wmv",
    ".3gp": "video/3gpp",
}


def video_content_type(path: Path) -> str:
    return VIDEO_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")


def stream_video_file(path: Path, request: Request) -> Response | StreamingResponse:
    """Responde con 200 o 206 + Content-Range según cabecera Range."""
    path = path.resolve()
    file_size = path.stat().st_size
    media = video_content_type(path)
    range_h = request.headers.get("range") or request.headers.get("Range")

    chunk = 1024 * 1024

    def iter_file(start: int, length: int):
        read_left = length
        with open(path, "rb") as f:
            f.seek(start)
            while read_left > 0:
                n = min(chunk, read_left)
                data = f.read(n)
                if not data:
                    break
                read_left -= len(data)
                yield data

    if not range_h:
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
        }
        return StreamingResponse(
            iter_file(0, file_size),
            media_type=media,
            headers=headers,
        )

    m = re.match(r"bytes=(\d*)-(\d*)", range_h.strip())
    if not m:
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
        }
        return StreamingResponse(
            iter_file(0, file_size),
            media_type=media,
            headers=headers,
        )

    start_s, end_s = m.group(1), m.group(2)
    start = int(start_s) if start_s else 0
    if start >= file_size:
        return Response(
            status_code=416,
            headers={
                "Content-Range": f"bytes */{file_size}",
            },
        )

    if end_s:
        end = int(end_s)
    else:
        end = file_size - 1
    end = min(end, file_size - 1)
    content_length = end - start + 1

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(content_length),
    }
    return StreamingResponse(
        iter_file(start, content_length),
        status_code=206,
        media_type=media,
        headers=headers,
    )
