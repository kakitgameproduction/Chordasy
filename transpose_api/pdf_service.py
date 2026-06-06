from __future__ import annotations

import hashlib
import re
from pathlib import Path

import fitz

from .chords import is_probable_chord_token, transpose_chord_token


class PdfService:
    def __init__(self, cache_root: Path) -> None:
        self.cache_root = cache_root

    def supports_pdf_transpose(self) -> bool:
        return True

    def create_transposed_pdf(
        self,
        pdf_path: str | Path,
        *,
        semitones: int = 0,
        output_path: str | Path | None = None,
        highlight_fill: tuple[float, float, float] = (1.0, 0.96, 0.55),
    ) -> Path:
        source_path = Path(pdf_path)
        export_dir = self.cache_root / "exports"
        export_dir.mkdir(parents=True, exist_ok=True)

        if output_path is None:
            suffix = f"_transpose_{semitones:+d}" if semitones else "_original"
            output_path = export_dir / f"{self._safe_stem(source_path.stem)}{suffix}.pdf"
        else:
            output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)

        output_path = Path(output_path)
        if output_path.exists() and output_path.stat().st_mtime_ns >= source_path.stat().st_mtime_ns:
            return output_path

        if semitones == 0 and output_path != source_path:
            output_path.write_bytes(source_path.read_bytes())
            return output_path

        with fitz.open(source_path) as document:
            for page in document:
                self._overlay_transposed_chords(page, semitones, highlight_fill)
            document.save(output_path, garbage=4, deflate=True)

        return output_path

    def render_preview_images(
        self,
        pdf_path: str | Path,
        *,
        max_width: int = 820,
        max_height: int = 1100,
        min_zoom: float = 0.18,
        max_zoom: float = 1.0,
    ) -> list[Path]:
        path = Path(pdf_path)
        preview_root = self.cache_root / "previews"
        max_width = max(320, max_width)
        max_height = max(420, max_height)
        preview_key = hashlib.sha1(
            f"transpose-api-preview:{path}:{path.stat().st_mtime_ns}:{max_width}:{max_height}:{min_zoom}:{max_zoom}".encode("utf-8")
        ).hexdigest()
        preview_dir = preview_root / preview_key
        preview_dir.mkdir(parents=True, exist_ok=True)

        rendered_paths: list[Path] = []
        with fitz.open(path) as document:
            for index, page in enumerate(document, start=1):
                target = preview_dir / f"page_{index:03d}.png"
                if not target.exists():
                    page_rect = fitz.Rect(page.rect)
                    page_width = max(page_rect.width, 1)
                    page_height = max(page_rect.height, 1)
                    width_zoom = max_width / page_width
                    height_zoom = max_height / page_height
                    zoom = min(width_zoom, height_zoom)
                    zoom = max(min_zoom, min(max_zoom, zoom))
                    pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
                    pixmap.save(target)
                rendered_paths.append(target)

        return rendered_paths

    def _overlay_transposed_chords(
        self,
        page: fitz.Page,
        semitones: int,
        highlight_fill: tuple[float, float, float],
    ) -> None:
        words = page.get_text("words", sort=True)
        if not words:
            return

        line_groups: dict[tuple[int, int], list[tuple]] = {}
        for word in words:
            block_no = int(word[5])
            line_no = int(word[6])
            line_groups.setdefault((block_no, line_no), []).append(word)

        for group_words in line_groups.values():
            tokens = [str(word[4]).strip() for word in group_words if str(word[4]).strip()]
            if not self._is_chord_line(tokens):
                continue

            for word in group_words:
                token = str(word[4]).strip()
                if not is_probable_chord_token(token):
                    continue

                replacement = transpose_chord_token(token, semitones)
                x0, y0, x1, y1 = map(float, word[:4])
                rect = fitz.Rect(x0, y0, x1, y1)
                base_x_pad = max(3.0, rect.height * 0.22)
                base_y_pad = max(1.2, rect.height * 0.10)
                padded = fitz.Rect(
                    rect.x0 - base_x_pad,
                    rect.y0 - base_y_pad,
                    rect.x1 + base_x_pad,
                    rect.y1 + base_y_pad,
                )

                fontsize = max(8.0, min(18, rect.height * 0.94))
                inserted = -1
                final_rect = fitz.Rect(padded)
                final_font = fontsize

                for expansion in (0.0, 6.0, 12.0, 20.0):
                    candidate_rect = fitz.Rect(
                        max(page.rect.x0, padded.x0 - expansion),
                        max(page.rect.y0, padded.y0),
                        min(page.rect.x1, padded.x1 + expansion),
                        min(page.rect.y1, padded.y1),
                    )
                    text_rect = fitz.Rect(candidate_rect.x0 + 1, candidate_rect.y0, candidate_rect.x1 - 1, candidate_rect.y1 + 1)
                    trial_font = fontsize
                    while trial_font >= 7.5:
                        inserted = page.insert_textbox(
                            text_rect,
                            replacement,
                            fontname="helv",
                            fontsize=trial_font,
                            color=(0.08, 0.1, 0.14),
                            align=1,
                            overlay=False,
                        )
                        if inserted >= 0:
                            final_rect = candidate_rect
                            final_font = trial_font
                            break
                        trial_font -= 0.5
                    if inserted >= 0:
                        break

                if inserted >= 0:
                    page.draw_rect(final_rect, fill=(1, 1, 1), color=None, overlay=True)
                    page.draw_rect(final_rect, fill=highlight_fill, color=None, fill_opacity=0.82, overlay=True)
                    text_rect = fitz.Rect(final_rect.x0 + 1, final_rect.y0, final_rect.x1 - 1, final_rect.y1 + 1)
                    page.insert_textbox(
                        text_rect,
                        replacement,
                        fontname="helv",
                        fontsize=final_font,
                        color=(0.08, 0.1, 0.14),
                        align=1,
                        overlay=True,
                    )
                else:
                    fallback_rect = fitz.Rect(
                        max(page.rect.x0, rect.x0 - max(3.0, rect.height * 0.14)),
                        max(page.rect.y0, rect.y0 - max(0.8, rect.height * 0.08)),
                        min(page.rect.x1, rect.x0 + max(rect.width + 30, rect.height * 2.6)),
                        min(page.rect.y1, rect.y1 + max(1.2, rect.height * 0.10)),
                    )
                    page.draw_rect(fallback_rect, fill=(1, 1, 1), color=None, overlay=True)
                    page.draw_rect(fallback_rect, fill=highlight_fill, color=None, fill_opacity=0.82, overlay=True)
                    page.insert_text(
                        fitz.Point(fallback_rect.x0 + 3, fallback_rect.y1 - max(2, rect.height * 0.14)),
                        replacement,
                        fontname="helv",
                        fontsize=max(8.0, min(14, rect.height * 0.86)),
                        color=(0.08, 0.1, 0.14),
                        overlay=True,
                    )

    def _is_chord_line(self, tokens: list[str]) -> bool:
        filtered = [token for token in tokens if token and token not in {"|", "/"}]
        if not filtered:
            return False
        chordish = sum(1 for token in filtered if is_probable_chord_token(token.strip("[](){}")))
        if chordish == 0:
            return False
        if chordish / len(filtered) >= 0.55:
            return True
        return len(filtered) <= 4 and chordish == len(filtered)

    def _safe_stem(self, name: str) -> str:
        return re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_") or "chordlab_export"
