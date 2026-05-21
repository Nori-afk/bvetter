#!/usr/bin/env python3
"""Image feature helper for BVETTER Lost & Found.

The PHP endpoint calls this script when Python is available. It intentionally
returns compact JSON features so PHP can keep owning persistence and matching.
"""

import hashlib
import json
import math
import os
import sys

try:
    from PIL import Image
except Exception:  # pragma: no cover - PHP can still fall back to metadata.
    Image = None


def fail(message):
    print(json.dumps({"success": False, "message": message}))
    return 1


def sha1_file(path):
    digest = hashlib.sha1()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def brightness_hash(image, size=12):
    gray = image.convert("L").resize((size, size))
    values = list(gray.getdata())
    avg = sum(values) / max(1, len(values))
    return "".join("1" if value >= avg else "0" for value in values)


def color_histogram(image, bins=4):
    rgb = image.convert("RGB").resize((64, 64))
    hist = [0] * (bins * bins * bins)
    for r, g, b in rgb.getdata():
        ri = min(bins - 1, r * bins // 256)
        gi = min(bins - 1, g * bins // 256)
        bi = min(bins - 1, b * bins // 256)
        hist[(ri * bins * bins) + (gi * bins) + bi] += 1
    total = sum(hist) or 1
    return [round(value / total, 6) for value in hist]


def average_rgb(image):
    rgb = image.convert("RGB").resize((32, 32))
    pixels = list(rgb.getdata())
    total = len(pixels) or 1
    return [
        round(sum(pixel[index] for pixel in pixels) / total)
        for index in range(3)
    ]


def features(path):
    if not os.path.exists(path):
        raise FileNotFoundError(path)

    base = {
        "sha1": sha1_file(path),
        "engine": "python",
    }

    if Image is None:
        base["engine"] = "python-metadata"
        return base

    with Image.open(path) as image:
        image.load()
        base.update(
            {
                "width": image.width,
                "height": image.height,
                "mime": Image.MIME.get(image.format, image.format),
                "avg_rgb": average_rgb(image),
                "brightness_hash": brightness_hash(image),
                "color_histogram": color_histogram(image),
            }
        )
    return base


def cosine_similarity(left, right):
    if not left or not right or len(left) != len(right):
        return None
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if not left_norm or not right_norm:
        return None
    return dot / (left_norm * right_norm)


def hamming_similarity(left, right):
    if not left or not right or len(left) != len(right):
        return None
    diff = sum(1 for a, b in zip(left, right) if a != b)
    return 1 - (diff / len(left))


def compare(path_a, path_b):
    left = features(path_a)
    right = features(path_b)
    scores = []
    reasons = []

    hist = cosine_similarity(left.get("color_histogram"), right.get("color_histogram"))
    if hist is not None:
        scores.append(hist)
        if hist >= 0.82:
            reasons.append("Similar image color distribution")

    hash_score = hamming_similarity(left.get("brightness_hash"), right.get("brightness_hash"))
    if hash_score is not None:
        scores.append(hash_score)
        if hash_score >= 0.68:
            reasons.append("Similar image structure")

    confidence = round((sum(scores) / len(scores)) * 100) if scores else 0
    return {"confidence": confidence, "reasons": reasons, "left": left, "right": right}


def main(argv):
    if len(argv) < 3:
        return fail("Usage: image_matcher.py features <path> OR compare <left> <right>")

    mode = argv[1]
    try:
        if mode == "features":
            print(json.dumps({"success": True, "features": features(argv[2])}))
            return 0
        if mode == "compare" and len(argv) >= 4:
            print(json.dumps({"success": True, **compare(argv[2], argv[3])}))
            return 0
    except Exception as exc:
        return fail(str(exc))

    return fail("Unknown mode")


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
