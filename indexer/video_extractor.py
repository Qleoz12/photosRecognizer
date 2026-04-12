"""
Extracts representative frames from video files using ffmpeg.
For scale: extracts at most MAX_FRAMES per video (start, middle, end),
regardless of duration — avoids 100k ffmpeg calls on 3k videos.
"""
import subprocess
import tempfile
import os
from pathlib import Path
from typing import Generator, Tuple

try:
    from PIL import Image
except ImportError:
    Image = None

MAX_FRAMES = 3  # start + middle + end; enough for face detection


def get_video_duration(video_path: Path) -> float | None:
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(video_path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return float(result.stdout.strip())
    except Exception:
        return None


def get_video_metadata(video_path: Path) -> dict:
    """Return duration (s), width, height from ffprobe. Returns empty dict on failure."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_format", "-show_streams",
                "-select_streams", "v:0",
                "-of", "json",
                str(video_path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            return {}
        import json
        data = json.loads(result.stdout)
        out = {}
        if "format" in data and "duration" in data["format"]:
            out["duration"] = float(data["format"]["duration"])
        if "streams" in data and len(data["streams"]) > 0:
            s = data["streams"][0]
            if "width" in s:
                out["width"] = int(s["width"])
            if "height" in s:
                out["height"] = int(s["height"])
        return out
    except Exception:
        return {}


def extract_frames(
    video_path: Path,
    max_frames: int = MAX_FRAMES,
) -> Generator[Tuple[int, "Image.Image"], None, None]:
    """
    Yield (timestamp_seconds, PIL.Image) for up to max_frames frames.
    Picks evenly spaced timestamps: start, middle, end.
    """
    duration = get_video_duration(video_path)
    if duration is None or duration < 1:
        return

    # Pick evenly spaced timestamps across the video
    if max_frames == 1:
        timestamps = [int(duration * 0.1)]
    else:
        step = duration / max_frames
        timestamps = [int(step * i + step * 0.1) for i in range(max_frames)]
        # Clamp to valid range
        timestamps = [min(int(t), int(duration) - 1) for t in timestamps]
        timestamps = sorted(set(timestamps))

    with tempfile.TemporaryDirectory() as tmpdir:
        for ts in timestamps:
            out_path = os.path.join(tmpdir, f"frame_{ts:06d}.jpg")
            try:
                result = subprocess.run(
                    [
                        "ffmpeg", "-y",
                        "-ss", str(ts),
                        "-i", str(video_path),
                        "-vframes", "1",
                        "-q:v", "2",
                        out_path,
                    ],
                    capture_output=True,
                    timeout=30,
                )
                if result.returncode == 0 and os.path.exists(out_path):
                    img = Image.open(out_path).copy()
                    yield ts, img
            except Exception:
                continue


def extract_first_frame_any(video_path: Path) -> "Image.Image | None":
    """
    Un fotograma para CLIP / asignación manual cuando no hay caras indexadas.
    Reutiliza extract_frames; si falla (vídeo muy corto, duración desconocida), prueba t=0.
    """
    if Image is None:
        return None
    for _, img in extract_frames(video_path, max_frames=MAX_FRAMES):
        return img
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            out_path = os.path.join(tmpdir, "f0.jpg")
            result = subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-ss",
                    "0",
                    "-i",
                    str(video_path),
                    "-vframes",
                    "1",
                    "-q:v",
                    "2",
                    out_path,
                ],
                capture_output=True,
                timeout=45,
            )
            if result.returncode == 0 and os.path.exists(out_path):
                return Image.open(out_path).copy()
    except Exception:
        pass
    return None
