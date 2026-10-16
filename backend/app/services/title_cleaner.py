"""Làm sạch tiêu đề video YouTube thành các câu truy vấn tìm tên anime."""

import re
from dataclasses import dataclass

_BRACKETS = re.compile(r"【[^】]*】|\[[^\]]*\]|\([^)]*\)")
_LABEL = re.compile(r"\b(opening|ending|ncop|nced|op|ed)\s*0*(\d+)\b", re.IGNORECASE)
_KEYWORDS = re.compile(
    r"\b(?:full|hd|4k|1080p|lyrics|mad|amv|ncop\d*|nced\d*|creditless|official|mv|tv[\s-]?size)\b",
    re.IGNORECASE,
)
_SEQUENCE = re.compile(r"\b(?:opening|ending|op|ed)\s*\d*\b", re.IGNORECASE)
_SPLIT = re.compile(r"\s+-\s+|\||/|「|」")
_TRIM = " -–—:·~|,"


@dataclass(frozen=True)
class CleanedTitle:
    parts: list[str]
    label_hint: str | None


def clean_title(title: str) -> CleanedTitle:
    label_hint = None
    match = _LABEL.search(title)
    if match:
        kind = "OP" if match.group(1).lower() in ("opening", "op", "ncop") else "ED"
        label_hint = f"{kind}{int(match.group(2))}"
    text = _BRACKETS.sub(" ", title)
    text = _KEYWORDS.sub(" ", text)
    text = _SEQUENCE.sub(" ", text)
    parts: list[str] = []
    for raw in _SPLIT.split(text):
        part = re.sub(r"\s+", " ", raw).strip(_TRIM)
        if part and part.casefold() not in {p.casefold() for p in parts}:
            parts.append(part)
    return CleanedTitle(parts=parts, label_hint=label_hint)
