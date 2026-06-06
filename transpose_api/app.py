from __future__ import annotations

import os
import re
import shutil
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_file


RUNTIME_ROOT = Path(os.environ.get("TRANSPOSE_API_HOME", "/tmp/chordlab-transpose-api")).resolve()

if __package__ in {None, ""}:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from transpose_api.pdf_service import PdfService
else:
    from .pdf_service import PdfService


MAX_UPLOAD_BYTES = int(os.environ.get("TRANSPOSE_API_MAX_UPLOAD_MB", "20")) * 1024 * 1024
UPLOAD_RETENTION_SECONDS = int(os.environ.get("TRANSPOSE_API_RETENTION_HOURS", "24")) * 60 * 60
UPLOAD_ROOT = RUNTIME_ROOT / "documents"


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES

pdf_service = PdfService(RUNTIME_ROOT / "cache")


@dataclass(slots=True)
class StoredDocument:
    document_id: str
    original_name: str
    stored_path: Path
    created_at: float


def _safe_stem(name: str) -> str:
    stem = Path(name).stem.strip() or "chart"
    return re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-._") or "chart"


def _safe_filename(name: str) -> str:
    suffix = Path(name).suffix.lower()
    if suffix != ".pdf":
        suffix = ".pdf"
    return f"{_safe_stem(name)}{suffix}"


def _document_dir(document_id: str) -> Path:
    return UPLOAD_ROOT / document_id


def _cleanup_expired_documents() -> None:
    if not UPLOAD_ROOT.exists():
        return
    cutoff = time.time() - UPLOAD_RETENTION_SECONDS
    for child in UPLOAD_ROOT.iterdir():
        try:
            if not child.is_dir():
                continue
            if child.stat().st_mtime >= cutoff:
                continue
            shutil.rmtree(child, ignore_errors=True)
        except OSError:
            continue


def _resolve_document(document_id: str) -> StoredDocument:
    if not re.fullmatch(r"[0-9a-f]{32}", document_id):
        raise FileNotFoundError("Invalid document id")
    doc_dir = _document_dir(document_id)
    source = doc_dir / "source.pdf"
    name_file = doc_dir / "original_name.txt"
    if not source.exists() or not name_file.exists():
        raise FileNotFoundError("Document not found")
    return StoredDocument(
        document_id=document_id,
        original_name=name_file.read_text(encoding="utf-8").strip() or "chart.pdf",
        stored_path=source,
        created_at=source.stat().st_mtime,
    )


def _transpose_value() -> int:
    raw = request.args.get("transpose", "0").strip()
    value = int(raw or 0)
    return max(-12, min(12, value))


def _transposed_pdf_path(document: StoredDocument, semitones: int) -> Path:
    if semitones == 0:
        return document.stored_path
    output_path = _document_dir(document.document_id) / f"transpose_{semitones:+d}.pdf"
    return pdf_service.create_transposed_pdf(document.stored_path, semitones=semitones, output_path=output_path)


def _preview_paths(document: StoredDocument, semitones: int) -> list[Path]:
    source_pdf = _transposed_pdf_path(document, semitones)
    return pdf_service.render_preview_images(
        source_pdf,
        max_width=1280,
        max_height=1880,
        min_zoom=0.24,
        max_zoom=1.45,
    )


def _preview_payload(document: StoredDocument, semitones: int) -> dict[str, Any]:
    pages = _preview_paths(document, semitones)
    base_url = request.url_root.rstrip("/")
    return {
        "document_id": document.document_id,
        "filename": document.original_name,
        "transpose": semitones,
        "transpose_supported": pdf_service.supports_pdf_transpose(),
        "page_count": len(pages),
        "pages": [
            f"{base_url}/api/transpose/{document.document_id}/pages/{index}?transpose={semitones}"
            for index in range(len(pages))
        ],
        "download_url": f"{base_url}/api/transpose/{document.document_id}/download?transpose={semitones}",
    }


@app.before_request
def _before_request() -> Any:
    if request.method == "OPTIONS":
        return ("", 204)
    _cleanup_expired_documents()
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    return None


@app.after_request
def _apply_cors(response):  # type: ignore[no-untyped-def]
    response.headers["Access-Control-Allow-Origin"] = os.environ.get("TRANSPOSE_API_ALLOW_ORIGIN", "*")
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


@app.get("/api/health")
def health() -> Any:
    return jsonify(
        {
            "ok": True,
            "service": "chordlab-transpose-api",
            "pdf_transpose_supported": pdf_service.supports_pdf_transpose(),
            "runtime_root": str(RUNTIME_ROOT),
        }
    )


@app.post("/api/transpose/upload")
def upload_document() -> Any:
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify({"error": "A PDF file is required under form field 'file'."}), 400
    filename = _safe_filename(upload.filename)
    if Path(filename).suffix.lower() != ".pdf":
        return jsonify({"error": "Only PDF files are supported in this transpose demo."}), 400

    document_id = uuid.uuid4().hex
    doc_dir = _document_dir(document_id)
    doc_dir.mkdir(parents=True, exist_ok=True)
    source_path = doc_dir / "source.pdf"
    upload.save(source_path)
    (doc_dir / "original_name.txt").write_text(filename, encoding="utf-8")

    try:
        preview = _preview_payload(
            StoredDocument(
                document_id=document_id,
                original_name=filename,
                stored_path=source_path,
                created_at=time.time(),
            ),
            0,
        )
    except Exception as error:
        shutil.rmtree(doc_dir, ignore_errors=True)
        return jsonify({"error": f"Unable to preview this PDF: {error}"}), 400

    return jsonify(preview), 201


@app.get("/api/transpose/<document_id>/preview")
def transpose_preview(document_id: str) -> Any:
    try:
        document = _resolve_document(document_id)
        return jsonify(_preview_payload(document, _transpose_value()))
    except FileNotFoundError as error:
        return jsonify({"error": str(error)}), 404
    except ValueError as error:
        return jsonify({"error": str(error)}), 400


@app.get("/api/transpose/<document_id>/pages/<int:page_index>")
def preview_page(document_id: str, page_index: int) -> Any:
    try:
        document = _resolve_document(document_id)
        pages = _preview_paths(document, _transpose_value())
    except FileNotFoundError as error:
        return jsonify({"error": str(error)}), 404
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    if page_index < 0 or page_index >= len(pages):
        return jsonify({"error": "Page not found"}), 404
    return send_file(pages[page_index], mimetype="image/png", max_age=0)


@app.get("/api/transpose/<document_id>/download")
def download_transposed_pdf(document_id: str) -> Any:
    try:
        document = _resolve_document(document_id)
        semitones = _transpose_value()
        export_path = _transposed_pdf_path(document, semitones)
    except FileNotFoundError as error:
        return jsonify({"error": str(error)}), 404
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    stem = _safe_stem(document.original_name)
    transpose_suffix = f"_transpose_{semitones:+d}" if semitones else "_original"
    download_name = f"{stem}{transpose_suffix}.pdf"
    return send_file(export_path, mimetype="application/pdf", as_attachment=True, download_name=download_name, max_age=0)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=False)
