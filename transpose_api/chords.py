from __future__ import annotations

import re


SHARP_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT_TO_SHARP = {
    "Db": "C#",
    "Eb": "D#",
    "Gb": "F#",
    "Ab": "G#",
    "Bb": "A#",
    "Cb": "B",
    "Fb": "E",
    "E#": "F",
    "B#": "C",
}

CHORD_CORE_RE = re.compile(
    r"^"
    r"([A-G](?:#|b)?)"
    r"("
    r"(?:"
    r"(?:maj|min|mi|ma|m|sus|add|dim|aug|dom|no|omit)?"
    r"(?:2|4|5|6|7|9|11|13|69)?"
    r"(?:[#b](?:2|4|5|6|7|9|11|13))?"
    r"(?:sus(?:2|4)?)?"
    r"(?:add(?:2|4|9|11|13))?"
    r"(?:\([^)]*\))?"
    r")*"
    r")"
    r"(?:/([A-G](?:#|b)?(?:maj|min|mi|ma|m|sus(?:2|4)?|add(?:2|4|9|11|13))?(?:2|4|5|6|7|9|11|13|69)?(?:[#b](?:2|4|5|6|7|9|11|13))?))?"
    r"$"
)
LEADING_WRAPPERS_RE = re.compile(r"^([\[\(\{\|\\/:;,_\-\u2013\u2014\u2022\u00b7]+)")
TRAILING_MARKS_RE = re.compile(r"([\]\)\}\|/\\:;,_\-\u2013\u2014\u2022\u00b7]+)$")
TRAILING_REPEAT_RE = re.compile(r"(?i)((?:\s*[x×]\s*\d+)+)$")


def normalize_note(note: str) -> str:
    return FLAT_TO_SHARP.get(note, note)


def transpose_note(note: str, semitones: int) -> str:
    normalized = normalize_note(note)
    index = SHARP_NOTES.index(normalized)
    return SHARP_NOTES[(index + semitones) % len(SHARP_NOTES)]


def _split_token_shell(token: str) -> tuple[str, str, str]:
    text = token.strip()
    if not text:
        return "", "", ""

    prefix_match = LEADING_WRAPPERS_RE.match(text)
    prefix = prefix_match.group(1) if prefix_match else ""
    remainder = text[len(prefix):]

    repeat_match = TRAILING_REPEAT_RE.search(remainder)
    repeat_suffix = repeat_match.group(1) if repeat_match else ""
    without_repeat = remainder[:-len(repeat_suffix)] if repeat_suffix else remainder

    suffix_match = TRAILING_MARKS_RE.search(without_repeat)
    suffix = suffix_match.group(1) if suffix_match else ""
    core = without_repeat[:-len(suffix)] if suffix else without_repeat
    return prefix, core.strip(), f"{suffix}{repeat_suffix}"


def transpose_chord_token(token: str, semitones: int) -> str:
    prefix, core, suffix = _split_token_shell(token)
    match = CHORD_CORE_RE.fullmatch(core)
    if not match:
        return token
    root, chord_suffix, bass = match.groups()
    transposed_root = transpose_note(root, semitones)
    transposed = f"{transposed_root}{chord_suffix}"
    if bass:
        bass_match = CHORD_CORE_RE.fullmatch(bass)
        if bass_match:
            bass_root, bass_suffix, _ = bass_match.groups()
            transposed_bass = f"{transpose_note(bass_root, semitones)}{bass_suffix}"
        else:
            transposed_bass = transpose_note(bass, semitones)
        transposed = f"{transposed}/{transposed_bass}"
    return f"{prefix}{transposed}{suffix}"


def is_probable_chord_token(token: str) -> bool:
    _prefix, core, _suffix = _split_token_shell(token)
    if not core:
        return False
    return CHORD_CORE_RE.fullmatch(core) is not None
