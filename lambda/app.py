import boto3
import os
import io
import uuid
from datetime import datetime
from PIL import Image

# ---- Configuration ------------------------------------------------------
# Region comes from the environment; fall back to the project's region.
REGION = os.environ.get("AWS_DEFAULT_REGION", "us-west-2")

# Optional endpoint override (LocalStack). Unset in real AWS.
ENDPOINT_URL = os.environ.get("AWS_ENDPOINT_URL")  # e.g. http://localhost:4566

UPLOAD_BUCKET = os.environ.get("UPLOAD_BUCKET", "image-uploads")
THUMBNAIL_BUCKET = os.environ.get("THUMBNAIL_BUCKET", "image-thumbnails")
TABLE_NAME = os.environ.get("TABLE_NAME", "ImageMetadata")
THUMBNAIL_SIZE = (200, 200)


def _client(service):
    """Build a boto3 client that works both locally and on real AWS."""
    kwargs = {"region_name": REGION}
    if ENDPOINT_URL:
        kwargs["endpoint_url"] = ENDPOINT_URL
    return boto3.client(service, **kwargs)


def lambda_handler(event, context):
    # The S3 event tells us which object was uploaded.
    record = event["Records"][0]["s3"]
    source_bucket = record["bucket"]["name"]
    object_key = record["object"]["key"]

    print(f"[handler] processing s3://{source_bucket}/{object_key}")

    s3 = _client("s3")
    ddb = boto3.resource(
        "dynamodb",
        region_name=REGION,
        **({"endpoint_url": ENDPOINT_URL} if ENDPOINT_URL else {}),
    )
    table = ddb.Table(TABLE_NAME)

    # 1. Download the original image
    obj = s3.get_object(Bucket=source_bucket, Key=object_key)
    image_data = obj["Body"].read()

    # 2. Create the thumbnail
    img = Image.open(io.BytesIO(image_data))
    img.thumbnail(THUMBNAIL_SIZE)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)

    # 3. Upload the thumbnail
    thumb_key = f"thumb-{object_key}"
    s3.put_object(
        Bucket=THUMBNAIL_BUCKET,
        Key=thumb_key,
        Body=buf,
        ContentType="image/jpeg",
    )
    print(f"[handler] uploaded thumbnail s3://{THUMBNAIL_BUCKET}/{thumb_key}")

    # 4. Persist metadata
    image_id = str(uuid.uuid4())
    table.put_item(
        Item={
            "image_id": image_id,
            "original_key": object_key,
            "thumbnail_key": thumb_key,
            "uploaded_at": datetime.utcnow().isoformat() + "Z",
            "size_bytes": len(image_data),
        }
    )
    print(f"[handler] wrote DynamoDB row image_id={image_id}")

    return {
        "statusCode": 200,
        "body": {"image_id": image_id, "thumbnail_key": thumb_key},
    }
