"""Display colours for lines.

Priority: the feed's route_color -> a colour word in the line name (only when enabled,
and reported as "inferred") -> a deterministic categorical fallback palette.
These are presentation constants, not transit data.
"""

# Tuned for legibility on light and dark map tiles rather than raw CSS keyword values.
COLOR_WORDS = {
    "red": "DC2626", "blue": "2563EB", "yellow": "CA8A04", "green": "16A34A", "violet": "7C3AED",
    "purple": "7C3AED", "pink": "DB2777", "magenta": "A21CAF", "orange": "EA580C", "gray": "6B7280",
    "grey": "6B7280", "aqua": "0891B2", "cyan": "0891B2", "teal": "0D9488", "brown": "92400E",
    "gold": "B45309", "lime": "65A30D", "navy": "1E3A8A", "maroon": "9F1239", "olive": "4D7C0F",
    "black": "1F2937", "silver": "94A3B8", "indigo": "4F46E5",
}

FALLBACK_PALETTE = ["0F766E", "B91C1C", "1D4ED8", "A16207", "7E22CE", "BE185D", "15803D", "C2410C",
                    "0369A1", "4D7C0F", "6D28D9", "9F1239"]


def infer_color(line_name: str) -> str | None:
    for token in line_name.lower().replace("/", " ").replace("-", " ").split():
        if token in COLOR_WORDS:
            return COLOR_WORDS[token]
    return None
