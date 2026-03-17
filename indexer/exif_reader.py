"""
EXIF metadata extraction from photos (date, GPS coordinates).
"""
import io
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple, Dict


def extract_exif(path: Path) -> Tuple[Optional[datetime], Optional[float], Optional[float]]:
    """
    Returns (datetime, lat, lon) from EXIF data. Any field can be None.
    """
    try:
        import exifread
        with open(path, "rb") as f:
            tags = exifread.process_file(f, stop_tag="GPS GPSLongitude", details=False)
        dt = _parse_date(tags)
        lat, lon = _parse_gps(tags)
        return dt, lat, lon
    except Exception:
        return None, None, None


def _parse_date(tags: dict) -> Optional[datetime]:
    for key in ("EXIF DateTimeOriginal", "EXIF DateTimeDigitized", "Image DateTime"):
        val = tags.get(key)
        if val:
            try:
                return datetime.strptime(str(val), "%Y:%m:%d %H:%M:%S")
            except ValueError:
                pass
    return None


def extract_all_exif_dates(path: Path) -> Dict[str, Optional[datetime]]:
    """
    Returns all EXIF date fields. Keys: datetime_original, datetime_digitized, image_datetime.
    """
    out = {
        "datetime_original": None,
        "datetime_digitized": None,
        "image_datetime": None,
    }
    try:
        import exifread
        with open(path, "rb") as f:
            tags = exifread.process_file(f, details=False)
        mapping = {
            "EXIF DateTimeOriginal": "datetime_original",
            "EXIF DateTimeDigitized": "datetime_digitized",
            "Image DateTime": "image_datetime",
        }
        for tag_key, out_key in mapping.items():
            val = tags.get(tag_key)
            if val:
                try:
                    out[out_key] = datetime.strptime(str(val), "%Y:%m:%d %H:%M:%S")
                except ValueError:
                    pass
    except Exception:
        pass
    return out


def _parse_gps(tags: dict) -> Tuple[Optional[float], Optional[float]]:
    def to_decimal(values, ref: str) -> Optional[float]:
        try:
            d = float(values[0].num) / float(values[0].den)
            m = float(values[1].num) / float(values[1].den)
            s = float(values[2].num) / float(values[2].den)
            result = d + m / 60 + s / 3600
            if ref in ("S", "W"):
                result = -result
            return result
        except Exception:
            return None

    lat_tag = tags.get("GPS GPSLatitude")
    lat_ref = str(tags.get("GPS GPSLatitudeRef", "N"))
    lon_tag = tags.get("GPS GPSLongitude")
    lon_ref = str(tags.get("GPS GPSLongitudeRef", "E"))

    lat = to_decimal(lat_tag.values, lat_ref) if lat_tag else None
    lon = to_decimal(lon_tag.values, lon_ref) if lon_tag else None
    return lat, lon
