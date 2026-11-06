Phase 3 milestone: Flask dashboard running in Docker, reading DynamoDB and proxying thumbnails from S3.
Note: First build failed with failed to read dockerfile because dashboard/requirements.txt and dashboard/Dockerfile didn't exist yet — only app.py was in the folder. Second build succeeded (51s).
Key design choice: thumbnails proxied through Flask (/thumb/<key> → s3.get_object) rather than served from presigned URLs, because presigned URLs contain the internal hostname localstack:4566 which the browser can't resolve.
Lesson: when the frontend and backend are on different networks (browser vs Docker), proxy is the safe default — presigned URLs only work when the storage endpoint is publicly reachable.
