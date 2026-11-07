from flask import Flask, Response, jsonify
from flask_cors import CORS
import boto3
import os
from decimal import Decimal

app = Flask(__name__)
CORS(app)  # Allow React to fetch data from this server

REGION = os.environ.get("AWS_DEFAULT_REGION", "us-west-2")
ENDPOINT = os.environ.get("AWS_ENDPOINT_URL")
TABLE = os.environ.get("TABLE_NAME", "ImageMetadata")
THUMB_BKT = os.environ.get("THUMBNAIL_BUCKET", "shanjid-2026-image-thumbnails")

# Configure boto3
boto_kwargs = {"region_name": REGION}
if ENDPOINT:
    boto_kwargs["endpoint_url"] = ENDPOINT

dynamodb = boto3.resource("dynamodb", **boto_kwargs)
s3 = boto3.client("s3", **boto_kwargs)
table = dynamodb.Table(TABLE)


# Helper to handle DynamoDB Decimals for JSON
def decimal_default(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError


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
