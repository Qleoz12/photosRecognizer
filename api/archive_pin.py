"""
PIN numérico (7 u 8 dígitos) para ver / desarchivar (variable ARCHIVE_PIN en el servidor).
"""
import hmac
import os


def _valid_pin_length(n: int) -> bool:
    return n in (7, 8)


def expected_archive_pin() -> str | None:
    p = (os.environ.get("ARCHIVE_PIN") or "").strip()
    if _valid_pin_length(len(p)) and p.isdigit():
        return p
    return None


def archive_pin_configured() -> bool:
    return expected_archive_pin() is not None


def archive_pin_matches(header_value: str | None) -> bool:
    exp = expected_archive_pin()
    if not exp or not header_value:
        return False
    hv = header_value.strip()
    if len(hv) != len(exp) or not hv.isdigit():
        return False
    return hmac.compare_digest(hv, exp)
