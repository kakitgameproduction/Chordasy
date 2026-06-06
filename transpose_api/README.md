# ChordLab Transpose API

This folder contains a standalone Python API for the ChordLab website transpose demo.

It is meant to be deployed separately from GitHub Pages, for example on Render.
This version is self-contained and does not depend on the app's `chordvault` package.

## What it does

- Accepts a PDF upload
- Generates preview pages
- Applies ChordLab-style transpose using the existing PDF service
- Returns a downloadable transposed PDF

## Endpoints

- `GET /api/health`
- `POST /api/transpose/upload`
- `GET /api/transpose/<document_id>/preview?transpose=2`
- `GET /api/transpose/<document_id>/pages/0?transpose=2`
- `GET /api/transpose/<document_id>/download?transpose=2`

## Local run

```bash
cd transpose_api
pip install -r requirements.txt
gunicorn app:app
```

Or:

```bash
cd transpose_api
python app.py
```

Default port is `8080`.

## Upload request

Use `multipart/form-data` with field name:

- `file`

Example using curl:

```bash
curl -X POST http://127.0.0.1:8080/api/transpose/upload \
  -F "file=@/path/to/chart.pdf"
```

## Typical response

```json
{
  "document_id": "2f7b9a0f4d6c4d2fa29f3d5b1d4a8e9f",
  "filename": "Amazing Grace.pdf",
  "transpose": 0,
  "transpose_supported": true,
  "page_count": 2,
  "pages": [
    "/api/transpose/2f7b9a0f4d6c4d2fa29f3d5b1d4a8e9f/pages/0?transpose=0",
    "/api/transpose/2f7b9a0f4d6c4d2fa29f3d5b1d4a8e9f/pages/1?transpose=0"
  ],
  "download_url": "/api/transpose/2f7b9a0f4d6c4d2fa29f3d5b1d4a8e9f/download?transpose=0"
}
```

## Render deploy

1. Push this repo to GitHub.
2. In Render, choose `New +` -> `Blueprint`, or `New +` -> `Web Service`.
3. Connect the GitHub repo.
4. If using `Blueprint`, Render can read `transpose_api/render.yaml`.
5. If using `Web Service`, set:

   - Root Directory: `transpose_api`
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `gunicorn app:app`

6. After deploy, your API URL will look like:

   `https://chordlab-transpose-api.onrender.com`

7. Your website can then call:

   `https://chordlab-transpose-api.onrender.com/api/transpose/upload`

## Website integration idea

Frontend flow:

1. Open transpose modal
2. Upload PDF
3. Receive `document_id` and preview pages
4. Change transpose amount with `-1 / +1 / Reset`
5. Call preview endpoint again
6. Use returned `download_url` for the final file

## Notes

- This service currently supports PDF only.
- Uploaded files are stored temporarily and cleaned up automatically.
- GitHub Pages cannot run this service directly; it must be hosted on a Python-capable platform.
