from flask import Flask, Response, jsonify, render_template_string, request
from flask_cors import CORS
from botocore.config import Config
import boto3
import os
from decimal import Decimal

app = Flask(__name__)
CORS(app)  # Allow React to fetch data from this server

REGION = os.environ.get("AWS_DEFAULT_REGION", "us-west-2")
ENDPOINT = os.environ.get("AWS_ENDPOINT_URL")
TABLE = os.environ.get("TABLE_NAME", "ImageMetadata")
THUMB_BKT = os.environ.get("THUMBNAIL_BUCKET", "shanjid-2026-image-thumbnails")
UPLOAD_BKT = os.environ.get("UPLOAD_BUCKET", "shanjid-2026-image-uploads")

# Configure boto3
boto_kwargs = {"region_name": REGION}
if ENDPOINT:
    boto_kwargs["endpoint_url"] = ENDPOINT

dynamodb = boto3.resource("dynamodb", **boto_kwargs)
s3 = boto3.client("s3", config=Config(signature_version="s3v4"), **boto_kwargs)
table = dynamodb.Table(TABLE)


# Helper to handle DynamoDB Decimals for JSON
def decimal_default(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError


WELCOME_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Serverless Image Pipeline — Backend API</title>
    <style>
        :root {
            --bg: #090d16;
            --card: rgba(15, 23, 42, 0.8);
            --border: rgba(99, 102, 241, 0.25);
            --text: #f8fafc;
            --muted: #94a3b8;
            --accent: #6366f1;
            --cyan: #06b6d4;
            --emerald: #10b981;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: radial-gradient(circle at top left, #1e1b4b 0%, var(--bg) 45%, #020617 100%);
            color: var(--text);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1.5rem;
        }
        .container {
            max-width: 720px;
            width: 100%;
            background: var(--card);
            backdrop-filter: blur(16px);
            border: 1px solid var(--border);
            border-radius: 24px;
            padding: 2.5rem;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 0 40px rgba(99, 102, 241, 0.12);
        }
        .badge {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.35rem 0.85rem;
            border-radius: 999px;
            background: rgba(16, 185, 129, 0.12);
            border: 1px solid rgba(16, 185, 129, 0.35);
            color: #34d399;
            font-size: 0.78rem;
            font-weight: 600;
            letter-spacing: 0.02em;
            margin-bottom: 1.25rem;
        }
        .pulse {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--emerald);
            box-shadow: 0 0 10px var(--emerald);
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.25); }
        }
        h1 {
            font-size: 1.85rem;
            font-weight: 700;
            letter-spacing: -0.02em;
            background: linear-gradient(90deg, #ffffff, #a5b4fc, #38bdf8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.6rem;
        }
        p.subtitle {
            color: var(--muted);
            font-size: 0.95rem;
            line-height: 1.6;
            margin-bottom: 1.75rem;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
            gap: 0.85rem;
            margin-bottom: 1.75rem;
        }
        .stat-box {
            background: rgba(30, 41, 59, 0.55);
            border: 1px solid rgba(148, 163, 184, 0.14);
            border-radius: 14px;
            padding: 0.9rem 1rem;
        }
        .stat-label {
            font-size: 0.72rem;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: var(--muted);
            margin-bottom: 0.3rem;
        }
        .stat-value {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 0.88rem;
            color: #e2e8f0;
            word-break: break-all;
        }
        .endpoints {
            background: rgba(2, 6, 23, 0.65);
            border: 1px solid rgba(148, 163, 184, 0.15);
            border-radius: 16px;
            padding: 1.25rem;
            margin-bottom: 1.5rem;
        }
        .endpoints h2 {
            font-size: 0.82rem;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #818cf8;
            margin-bottom: 0.85rem;
        }
        .endpoint-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
            padding: 0.6rem 0;
            border-bottom: 1px solid rgba(148, 163, 184, 0.1);
            font-size: 0.88rem;
        }
        .endpoint-row:last-child { border-bottom: none; padding-bottom: 0; }
        .method {
            font-family: monospace;
            font-size: 0.75rem;
            font-weight: 700;
            padding: 0.2rem 0.5rem;
            border-radius: 6px;
            background: rgba(99, 102, 241, 0.2);
            color: #a5b4fc;
            border: 1px solid rgba(99, 102, 241, 0.35);
        }
        code {
            font-family: ui-monospace, SFMono-Regular, monospace;
            color: #38bdf8;
        }
        .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 0.75rem;
        }
        a.btn {
            display: inline-flex;
            align-items: center;
            gap: 0.45rem;
            padding: 0.65rem 1.15rem;
            border-radius: 12px;
            font-size: 0.85rem;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.2s ease;
        }
        a.btn-primary {
            background: linear-gradient(135deg, #4f46e5, #7c3aed);
            color: white;
            box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);
        }
        a.btn-primary:hover { transform: translateY(-1px); opacity: 0.95; }
        a.btn-secondary {
            background: rgba(30, 41, 59, 0.8);
            color: #cbd5e1;
            border: 1px solid rgba(148, 163, 184, 0.25);
        }
        a.btn-secondary:hover { background: rgba(51, 65, 85, 0.8); color: white; }
    </style>
</head>
<body>
    <div class="container">
        <div class="badge">
            <span class="pulse"></span>
            <span>BACKEND API SERVICE ONLINE &bull; v1.1.0 (CI/CD Active)</span>
        </div>
        <h1>⚡ Serverless Image Pipeline API</h1>
        <p class="subtitle">
            You have reached the <strong>Flask REST API &amp; S3 Thumbnail Proxy</strong> backend for the
            Serverless Image Processing Pipeline. This service queries Amazon DynamoDB metadata and streams resized S3 thumbnails to the React Admin Console.
        </p>

        <div class="grid">
            <div class="stat-box">
                <div class="stat-label">AWS Region</div>
                <div class="stat-value">{{ region }}</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">DynamoDB Table</div>
                <div class="stat-value">{{ table }}</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">S3 Thumbnail Bucket</div>
                <div class="stat-value">{{ bucket }}</div>
            </div>
        </div>

        <div class="endpoints">
            <h2>Available API Endpoints</h2>
            <div class="endpoint-row">
                <div><span class="method">GET</span> <code>/api/images</code></div>
                <span style="color: var(--muted);">Returns processed image metadata JSON from DynamoDB</span>
            </div>
            <div class="endpoint-row">
                <div><span class="method">POST</span> <code>/api/upload-url</code></div>
                <span style="color: var(--muted);">Generates a 5-minute S3 presigned PUT URL for uploads</span>
            </div>
            <div class="endpoint-row">
                <div><span class="method">GET</span> <code>/thumb/&lt;thumbnail_key&gt;</code></div>
                <span style="color: var(--muted);">Streams JPEG thumbnail binary from Amazon S3</span>
            </div>
            <div class="endpoint-row">
                <div><span class="method">GET</span> <code>/health</code></div>
                <span style="color: var(--muted);">Service health check probe</span>
            </div>
        </div>

        <div class="actions">
            <a class="btn btn-primary" href="/api/images">Inspect /api/images JSON &rarr;</a>
            <a class="btn btn-secondary" href="/health">Check /health JSON</a>
            <a class="btn btn-secondary" href="http://shanjid-2026-frontend.s3-website-us-west-2.amazonaws.com" target="_blank" rel="noopener noreferrer">Open React Admin Console &nearr;</a>
        </div>
    </div>
</body>
</html>
"""


@app.route("/", methods=["GET"])
def index():
    return render_template_string(
        WELCOME_HTML,
        region=REGION,
        table=TABLE,
        bucket=THUMB_BKT,
    )


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "ok",
            "version": "1.1.0",
            "service": "serverless-image-pipeline-backend",
            "region": REGION,
            "dynamodb_table": TABLE,
            "thumbnail_bucket": THUMB_BKT,
            "upload_bucket": UPLOAD_BKT,
        }
    )


@app.route("/api/upload-url", methods=["POST"])
def get_upload_url():
    data = request.get_json() or {}
    filename = data.get("filename")

    if not filename:
        return jsonify({"error": "Filename is required"}), 400

    try:
        # Generate a presigned URL valid for 5 minutes
        presigned_url = s3.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": UPLOAD_BKT,
                "Key": filename,
                "ContentType": "image/jpeg",  # Assuming jpeg for simplicity
            },
            ExpiresIn=300,
        )
        return jsonify({"upload_url": presigned_url, "filename": filename})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/images", methods=["GET"])
def get_images():
    try:
        items = table.scan().get("Items", [])
        # Sort by uploaded_at descending
        items.sort(key=lambda x: x.get("uploaded_at", ""), reverse=True)
        return jsonify(items)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/thumb/<path:key>")
def thumb(key):
    try:
        obj = s3.get_object(Bucket=THUMB_BKT, Key=key)
        return Response(obj["Body"].read(), mimetype="image/jpeg")
    except Exception as e:
        return Response(f"Not found: {e}", status=404)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
