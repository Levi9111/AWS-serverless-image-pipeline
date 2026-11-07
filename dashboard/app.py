from flask import Flask, render_template_string, Response, jsonify
import boto3
import os

app = Flask(__name__)

REGION = os.environ.get("AWS_DEFAULT_REGION", "us-west-2")
ENDPOINT = os.environ.get("AWS_ENDPOINT_URL")
TABLE = os.environ.get("TABLE_NAME", "ImageMetadata")
THUMB_BKT = os.environ.get("THUMBNAIL_BUCKET", "image-thumbnails")


boto_kwargs = {"region_name": REGION}
if ENDPOINT:
    boto_kwargs["endpoint_url"] = ENDPOINT

dynamodb = boto3.resource("dynamodb", **boto_kwargs)
s3 = boto3.client("s3", **boto_kwargs)


dynamodb = boto3.resource("dynamodb", region_name=REGION, endpoint_url=ENDPOINT)
s3 = boto3.client("s3", region_name=REGION, endpoint_url=ENDPOINT)
table = dynamodb.Table(TABLE)

TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <title>Image Dashboard</title>
    <style>
        body { font-family: system-ui, sans-serif; margin: 2em; background: #f8f9fa; }
        h1 { color: #333; }
        .count { color: #666; margin-bottom: 1em; }
        table { border-collapse: collapse; background: white; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
        th, td { padding: 0.6em 1em; border: 1px solid #ddd; text-align: left; vertical-align: middle; }
        th { background: #007bff; color: white; }
        tr:nth-child(even) { background: #f9f9f9; }
        img { border-radius: 4px; display: block; }
        code { background: #eef; padding: 2px 4px; border-radius: 3px; font-size: 0.85em; }
    </style>
</head>
<body>
    <h1>📸 Image Processing Dashboard</h1>
    <div class="count">{{ items|length }} image(s) processed</div>
    {% if items %}
    <table>
        <tr>
            <th>Thumbnail</th>
            <th>Image ID</th>
            <th>Original</th>
            <th>Uploaded</th>
            <th>Size</th>
        </tr>
        {% for item in items %}
        <tr>
            <td><img src="/thumb/{{ item.thumbnail_key }}" width="150"></td>
            <td><code>{{ item.image_id }}</code></td>
            <td>{{ item.original_key }}</td>
            <td>{{ item.uploaded_at }}</td>
            <td>{{ item.size_bytes }} bytes</td>
        </tr>
        {% endfor %}
    </table>
    {% else %}
    <p>No images processed yet. Upload one to <code>s3://image-uploads/</code> to test.</p>
    {% endif %}
</body>
</html>
"""


@app.route("/")
def index():
    items = table.scan().get("Items", [])
    items.sort(key=lambda x: x.get("uploaded_at", ""), reverse=True)
    return render_template_string(TEMPLATE, items=items)


@app.route("/thumb/<path:key>")
def thumb(key):
    try:
        obj = s3.get_object(Bucket=THUMB_BKT, Key=key)
        return Response(obj["Body"].read(), mimetype="image/jpeg")
    except Exception as e:
        return Response(f"Thumbnail not found: {e}", status=404)


@app.route("/health")
def health():
    return jsonify(status="ok")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
