from __future__ import annotations
import gzip
import logging
import math
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ParsedTrackPoint:
    timestamp: datetime | None = None
    lat: float | None = None
    lon: float | None = None
    elevation_m: float | None = None
    distance_m: float | None = None
    heart_rate_bpm: int | None = None
    cadence_spm: float | None = None
    speed_mps: float | None = None


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    v = value.strip()
    try:
        if v.endswith("Z"):
            v = v[:-1] + "+00:00"
        dt = datetime.fromisoformat(v)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ"):
            try:
                return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                pass
    return None


def _open_text(path: Path):
    return gzip.open(path, "rt", encoding="utf-8", errors="replace") if path.name.endswith(".gz") else open(path, "rt", encoding="utf-8", errors="replace")


def _strip(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _float(v: Any) -> float | None:
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _int(v: Any) -> int | None:
    f = _float(v)
    return int(round(f)) if f is not None else None


def normalize_elevation(value: Any) -> float | None:
    f = _float(value)
    if f is None:
        return None
    # Common FIT/Strava sentinel/default for missing altitude.
    if f == -1:
        return None
    return f


def normalize_cadence(value: float | None) -> float | None:
    if value is None:
        return None
    # Most Strava/FIT run exports expose one-foot cadence near 80-95. Store steps/min.
    return value * 2 if 20 <= value < 130 else value


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1); dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def enrich_cumulative_distance(points: list[ParsedTrackPoint]) -> list[ParsedTrackPoint]:
    """Post-normalization distance enrichment. Preserve monotonic source distances; fill gaps from GPS."""
    cumulative = 0.0
    prev_gps: ParsedTrackPoint | None = None
    prev_distance: float | None = None
    for p in points:
        if prev_gps and p.lat is not None and p.lon is not None and prev_gps.lat is not None and prev_gps.lon is not None:
            cumulative += haversine_m(prev_gps.lat, prev_gps.lon, p.lat, p.lon)
        source_ok = p.distance_m is not None and p.distance_m >= 0 and (prev_distance is None or p.distance_m >= prev_distance)
        if source_ok:
            cumulative = float(p.distance_m)
            prev_distance = cumulative
        elif p.lat is not None and p.lon is not None:
            p.distance_m = cumulative
            prev_distance = cumulative
        else:
            p.distance_m = None
        if p.lat is not None and p.lon is not None:
            prev_gps = p
    return points


class TrackPointsFileParser:
    parser_name = "TrackPointsFileParser"
    supported_extensions: set[str] = set()
    def parse(self, path: Path) -> list[ParsedTrackPoint]:
        raise NotImplementedError


class GpxTrackPointsParser(TrackPointsFileParser):
    parser_name = "GpxTrackPointsParser"
    supported_extensions = {".gpx", ".gpx.gz"}

    def parse_file(self, path: Path) -> ET.Element:
        with _open_text(path) as f:
            return ET.parse(f).getroot()

    def normalize(self, raw: ET.Element) -> list[ParsedTrackPoint]:
        points: list[ParsedTrackPoint] = []
        for trkpt in raw.iter():
            if _strip(trkpt.tag) != "trkpt":
                continue
            p = ParsedTrackPoint(lat=_float(trkpt.attrib.get("lat")), lon=_float(trkpt.attrib.get("lon")))
            for child in trkpt.iter():
                name = _strip(child.tag).lower()
                text = child.text.strip() if child.text else None
                if name == "ele":
                    p.elevation_m = normalize_elevation(text)
                elif name == "time":
                    p.timestamp = parse_time(text)
                elif name in {"hr", "heartrate"}:
                    p.heart_rate_bpm = _int(text)
                elif name in {"cad", "cadence", "runcadence"}:
                    p.cadence_spm = normalize_cadence(_float(text))
                elif name == "speed":
                    p.speed_mps = _float(text)
            points.append(p)
        return points

    def parse(self, path: Path) -> list[ParsedTrackPoint]:
        raw = self.parse_file(path)
        return enrich_cumulative_distance(self.normalize(raw))


class TcxTrackPointsParser(TrackPointsFileParser):
    parser_name = "TcxTrackPointsParser"
    supported_extensions = {".tcx", ".tcx.gz"}

    def parse_file(self, path: Path) -> ET.Element:
        with _open_text(path) as f:
            return ET.parse(f).getroot()

    def normalize(self, raw: ET.Element) -> list[ParsedTrackPoint]:
        points: list[ParsedTrackPoint] = []
        for tp in raw.iter():
            if _strip(tp.tag) != "Trackpoint":
                continue
            p = ParsedTrackPoint()
            for child in tp.iter():
                name = _strip(child.tag)
                text = child.text.strip() if child.text else None
                if name == "Time":
                    p.timestamp = parse_time(text)
                elif name == "LatitudeDegrees":
                    p.lat = _float(text)
                elif name == "LongitudeDegrees":
                    p.lon = _float(text)
                elif name == "AltitudeMeters":
                    p.elevation_m = normalize_elevation(text)
                elif name == "DistanceMeters":
                    p.distance_m = _float(text)
                elif name in {"Cadence", "RunCadence"}:
                    p.cadence_spm = normalize_cadence(_float(text))
                elif name == "Speed":
                    p.speed_mps = _float(text)
            # ElementTree lacks parent ptr: find HR under direct subtree explicitly.
            for hr in tp.iter():
                if _strip(hr.tag) == "HeartRateBpm":
                    for val in hr.iter():
                        if _strip(val.tag) == "Value":
                            p.heart_rate_bpm = _int(val.text)
                            break
            points.append(p)
        return points

    def parse(self, path: Path) -> list[ParsedTrackPoint]:
        raw = self.parse_file(path)
        return enrich_cumulative_distance(self.normalize(raw))


class FitTrackPointsParser(TrackPointsFileParser):
    parser_name = "FitTrackPointsParser"
    supported_extensions = {".fit", ".fit.gz"}

    def parse_file(self, path: Path) -> list[dict[str, Any]]:
        from fitparse import FitFile
        if path.name.endswith(".gz"):
            with gzip.open(path, "rb") as src, tempfile.NamedTemporaryFile(suffix=".fit") as tmp:
                tmp.write(src.read()); tmp.flush()
                fit = FitFile(tmp.name)
                return [m.get_values() for m in fit.get_messages("record")]
        fit = FitFile(str(path))
        return [m.get_values() for m in fit.get_messages("record")]

    def normalize(self, raw: list[dict[str, Any]]) -> list[ParsedTrackPoint]:
        points: list[ParsedTrackPoint] = []
        for row in raw:
            lat = row.get("position_lat")
            lon = row.get("position_long")
            if lat is not None:
                lat = lat * (180 / 2**31)
            if lon is not None:
                lon = lon * (180 / 2**31)
            ts = row.get("timestamp")
            if isinstance(ts, datetime) and ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            speed = row.get("enhanced_speed", row.get("speed"))
            elev = row.get("enhanced_altitude", row.get("altitude"))
            points.append(ParsedTrackPoint(
                timestamp=ts if isinstance(ts, datetime) else None,
                lat=_float(lat), lon=_float(lon), elevation_m=normalize_elevation(elev),
                distance_m=_float(row.get("distance")), heart_rate_bpm=_int(row.get("heart_rate")),
                cadence_spm=normalize_cadence(_float(row.get("cadence"))), speed_mps=_float(speed),
            ))
        return points

    def parse(self, path: Path) -> list[ParsedTrackPoint]:
        raw = self.parse_file(path)
        return enrich_cumulative_distance(self.normalize(raw))


PARSERS = [GpxTrackPointsParser(), TcxTrackPointsParser(), FitTrackPointsParser()]


def suffix_key(path: Path) -> str:
    name = path.name.lower()
    for ext in (".gpx.gz", ".tcx.gz", ".fit.gz", ".gpx", ".tcx", ".fit"):
        if name.endswith(ext):
            return ext
    return ''.join(path.suffixes).lower()


def get_parser(path: Path) -> TrackPointsFileParser:
    ext = suffix_key(path)
    for parser in PARSERS:
        if ext in parser.supported_extensions:
            return parser
    raise ValueError(f"Unsupported activity file extension: {path.name}")
