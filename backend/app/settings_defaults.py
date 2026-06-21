from __future__ import annotations

DEFAULT_DASHBOARD_SECTIONS = {
    "summary": True,
    "weeklyVolume": True,
    "trainingConsistency": True,
    "personalBests": True,
    "bestEffortTrend": True,
    "longRun": True,
    "paceTrend": True,
    "elevationTrend": True,
    "distanceDistribution": True,
    "heartRateZones": True,
    "paceZones": True,
    "recentRuns": True,
}

DEFAULT_SETTINGS = {
    "dashboard": {
        "visibleSections": DEFAULT_DASHBOARD_SECTIONS,
        "sectionOrder": list(DEFAULT_DASHBOARD_SECTIONS.keys()),
        "defaultTimeRange": "6mo",
        "defaultBucket": "week",
    },
    "maps": {
        "defaultOverlay": "none",
        "defaultMapType": "satellite",
    },
    "charts": {
        "paceSmoothingWindowM": 500,
        "elevationSmoothingWindowM": 100,
        "gradientSmoothingWindowM": 100,
    },
    "trainingZones": {
        "heartRate": [
            {"label": "Resting", "min": 0, "max": 100},
            {"label": "Zone 1", "min": 101, "max": 140},
            {"label": "Zone 2", "min": 141, "max": 155},
            {"label": "Zone 3", "min": 156, "max": 170},
            {"label": "Zone 4", "min": 171, "max": 185},
            {"label": "Zone 5", "min": 186, "max": 220},
        ],
        "pace": [
            {"label": "Easy", "min": 330, "max": 390},
            {"label": "Steady", "min": 300, "max": 330},
            {"label": "Tempo", "min": 270, "max": 300},
            {"label": "Interval", "min": 210, "max": 270},
        ],
    },
}

DEFAULT_BEST_EFFORT_DISTANCES = [
    ("400m", 400.0),
    ("800m", 800.0),
    ("1km", 1000.0),
    ("1 mile", 1609.344),
    ("3km", 3000.0),
    ("5km", 5000.0),
    ("10km", 10000.0),
    ("15km", 15000.0),
    ("Half marathon", 21097.5),
    ("Marathon", 42195.0),
]


def deep_merge(defaults: dict, value: dict | None) -> dict:
    out = dict(defaults)
    if not isinstance(value, dict):
        return out
    for key, item in value.items():
        if isinstance(out.get(key), dict) and isinstance(item, dict):
            out[key] = deep_merge(out[key], item)
        else:
            out[key] = item
    return out
