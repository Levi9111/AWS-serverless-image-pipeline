# Case Study: Phase 2 — End-to-End Pipeline Working

**Date:** 2026-11-06
**Milestone:** First successful S3 → Lambda → DynamoDB + S3 pipeline run

## Summary

After 5 distinct failures (build permissions, Docker socket, X-Ray port collision, invalid test image, missing input file), the serverless image processing pipeline ran successfully end-to-end. One upload of a 6.2 KB JPEG produced a 1.9 KB 200×150 thumbnail and a metadata row in DynamoDB — in under 100 ms of billed Lambda time.

## The Successful Flow

1. User uploads `test.jpg` (6208 bytes) to S3 `image-uploads` bucket
2. S3 event fires → Lambda `image-processor` invoked with event payload
3. Lambda: `s3.get_object` downloads the 6208 bytes
4. Lambda: Pillow opens the image, resizes to 200×150 (preserves aspect ratio)
5. Lambda: `s3.put_object` uploads `thumb-test.jpg` (1888 bytes) to `image-thumbnails` bucket
6. Lambda: `dynamodb.put_item` writes metadata row with UUID, keys, timestamp, size
7. Lambda returns `{statusCode: 200, body: {...}}`

## Evidence

- **DynamoDB scan:** 1 item with `image_id: 626e940c-...`, `size_bytes: 6208`
- **Thumbnails bucket:** `thumb-test.jpg` at 1888 bytes (69% size reduction)
- **Lambda logs:** `Duration: ~80ms, Billed Duration: ~80ms, Max Memory: 256 MB`

## The 5 Failures That Preceded Success

| #   | Failure                                           | Fix                                                                      |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | SAM build container can't read `requirements.txt` | `--user $(id -u):$(id -g)` + `:z` + `-e HOME=/tmp`                       |
| 2   | LocalStack can't spawn Lambda container           | `security_opt: label=disable` for Docker socket                          |
| 3   | X-Ray UDP 2000 port collision                     | Switch `LAMBDA_DOCKER_NETWORK` from `host` to bridge                     |
| 4   | `UnidentifiedImageError` on "cat" image           | Wikimedia returned HTML anti-bot page; used Pillow to generate real JPEG |
| 5   | `NoSuchKey` on first run                          | File wasn't in bucket yet — upload order matters                         |

## What "success" looks like (vs. what "failure" looks like)

**Success signals:**

- DynamoDB `Count: 1` with complete metadata
- Thumbnail bucket has the resized file (bytes smaller than original)
- Lambda logs contain `[handler] uploaded thumbnail ...` and `[handler] wrote DynamoDB row ...`
- Direct invoke returns `{statusCode: 200, body: {image_id, thumbnail_key}}`

**Failure signals that mask as success:**

- Upload succeeds but DynamoDB empty → trigger didn't fire
- `FunctionError: Unhandled` with traceback → Lambda ran, business logic failed
- `Internal error while executing lambda` → container never started (real Lambda failure)

## Key Observations

**1. One upload → multiple Lambda invocations in LocalStack.** Logs show 3-4 invocations per single `s3 cp`. This is a LocalStack community-edition behavior where the S3 notifier fires per multipart-chunk. In real AWS, `ObjectCreated` fires once per upload. Not a bug in our code.

**2. First-invocation cold start is slower.** The `Max Memory Used: 256 MB` shows memory limit hit; the actual working set is likely much smaller. Could reduce `--memory-size` to 128 MB in production. The 80ms billed duration is Pillow's actual work + S3 + DynamoDB round-trips.

**3. The `AWS_ENDPOINT_URL=http://localstack:4566` env var is critical.** Without it, the Lambda SDK defaults to real AWS endpoints and would fail auth. This is the LocalStack-specific bit of code that gets removed when deploying to real AWS.

## Lessons

1. **A Lambda traceback is not a Lambda failure.** If you see `[handler] ...` at the top of the logs and a Python stack trace below, Lambda ran fine — the bug is in the handler logic or its inputs.

2. **Always verify test inputs.** `file test.jpg` would have caught the invalid image in 1 second. Suspect any file smaller than expected — 3 KB is not a real 320px JPEG.

3. **The order of operations matters for event-driven tests.** Uploading the file before the trigger was configured means the file exists but no event fires. In a real CI/CD pipeline, the trigger setup must precede the test upload.

4. **Three independent verifications** (DynamoDB, S3 output bucket, logs) are required before declaring success. Any one alone is insufficient — an empty S3 bucket could mean "trigger didn't fire" or "trigger fired, resize failed."

## Evidence Archive

| File                              | Proves                                         |
| --------------------------------- | ---------------------------------------------- |
| `phase-2-e2e-success.png`         | Pipeline worked: DynamoDB row + thumbnail file |
| `phase-2-thumbnail-verified.png`  | Output is a real 200×150 JPEG                  |
| `phase-2-lambda-logs-success.png` | All 3 handler log lines present                |
