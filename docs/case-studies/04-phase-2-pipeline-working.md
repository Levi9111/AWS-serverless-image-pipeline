<div align="center">
  <a href="./03-phase-2-docker-permission-failures.md">⬅️ Prev: Phase 2B — Docker Permission Failures</a> &nbsp;|&nbsp;
  <a href="../../README.md">🏠 Back to Main README</a> &nbsp;|&nbsp;
  <a href="./05-phase-3-dashboard.md">Next: Phase 3 — Flask S3 Proxy Dashboard ➡️</a>
</div>

---

# Case Study 04: End-to-End Serverless Pipeline Working Locally (Phase 2C)

| Field | Details |
| :--- | :--- |
| **Project** | Serverless Image Processing Pipeline |
| **Phase** | Phase 2C — S3 Event Trigger Wiring & End-to-End Verification |
| **Milestone** | First complete `S3 Upload` → `Lambda Resize` → `S3 Thumbnail` + `DynamoDB Metadata` execution |
| **Performance** | `6,208 B` JPEG resized to `1,888 B` (`200×150` JPEG, **69.6% reduction**) in **~80 ms** billed duration |
| **Status** | ✅ **Verified across S3, DynamoDB, CloudWatch Logs, and Binary Inspection** |

---

## 1. Executive Summary

After resolving 5 distinct engineering hurdles across build permissions, Docker socket SELinux confinement, X-Ray UDP port collisions, and test input validation, the serverless image processing pipeline executed end-to-end. Uploading a `6.2 KB` JPEG (`test.jpg`) to `s3://image-uploads/` automatically triggered `image-processor`, generated a `1.9 KB` `200×150` thumbnail (`s3://image-thumbnails/thumb-test.jpg`), and persisted a structured metadata item in DynamoDB (`ImageMetadata`) in under `100 ms`.

---

## 2. The 5 Hurdles Overcome Prior to End-to-End Success

| # | Failure Encountered | Root Cause | Engineering Fix |
| :---: | :--- | :--- | :--- |
| **1** | SAM build container `Permission denied` | SELinux + root UID mismatch on bind mount | `--user $(id -u):$(id -g)` + `-e HOME=/tmp` + `:z` |
| **2** | Lambda `State: Failed` (`Docker not available`) | SELinux blocking `/var/run/docker.sock` inside LocalStack | `security_opt: [label=disable]` on `localstack` |
| **3** | X-Ray UDP port `2000` collision on Lambda spawn | `LAMBDA_DOCKER_NETWORK=host` caused port conflict with LocalStack | Created custom bridge network `localstack-net` |
| **4** | `PIL.UnidentifiedImageError` on downloaded test image | `curl` from Wikimedia downloaded an HTML bot-challenge page instead of a JPEG | Generated a valid RGB gradient JPEG via Pillow (`test.jpg`, `6,208` bytes) |
| **5** | `botocore.errorfactory.NoSuchKey` on direct invoke | Invoked Lambda with sample payload before uploading `test.jpg` to `s3://image-uploads/` | Uploaded `test.jpg` to S3, firing both the trigger and populating the key |

---

## 3. Step-by-Step Verification & Evidence

### 3.1 Wiring the S3 Invoke Permission & Bucket Notification
To allow `s3://image-uploads` to invoke `image-processor`, we attached a resource-based permission statement (`lambda add-permission`) and configured `put-bucket-notification-configuration` for `s3:ObjectCreated:*`:

| Adding Lambda Permission (`phase-2-add-permission.png`) | S3 Trigger Configuration (`phase-2-trigger-config.png`) |
| :---: | :---: |
| ![Add Permission](../../evidence/phase-2-add-permission.png) | ![Trigger Config](../../evidence/phase-2-trigger-config.png) |

Full state restoration and verification after configuring `localstack-net`:

![State Restored Verification](../../evidence/phase-2-state-restored.png)

<details>
<summary>📄 <strong>View Raw Log: <code>evidence/phase-2-state-restored-log.txt</code></strong></summary>

```text
=== Final verification ===
2026-11-06 17:12:22 image-uploads
2026-11-06 17:12:23 image-thumbnails
Active
{
    "LambdaFunctionConfigurations": [
        {
            "Id": "9bbb2c80",
            "LambdaFunctionArn": "arn:aws:lambda:us-west-2:000000000000:function:image-processor",
            "Events": [
                "s3:ObjectCreated:*"
            ]
        }
    ]
}
```
</details>

---

### 3.2 Diagnosing `NoSuchKey` & Uploading `test.jpg` (`phase-2-upload.png`)
When invoking the Lambda directly before `test.jpg` existed in S3, the handler returned a clean `NoSuchKey` stack trace—proving the Lambda container and `cpython-39` Pillow runtime loaded properly. Uploading `test.jpg` (`awslocal s3 cp test.jpg s3://image-uploads/test.jpg`) immediately triggered the pipeline:

![Direct Invoke & S3 Upload](../../evidence/phase-2-upload.png)

---

### 3.3 Triple Verification: DynamoDB + S3 Thumbnail + CloudWatch Logs (`phase-2-e2e-success.png`)
Within seconds of uploading `test.jpg`, we verified all three output channels:

![End-to-End Success Screenshot](../../evidence/phase-2-e2e-success.png)

<details>
<summary>📄 <strong>View Raw Log: <code>evidence/phase-2-e2e-success-log.txt</code></strong></summary>

```json
=== DynamoDB ===
{
    "Items": [
        {
            "size_bytes": { "N": "6208" },
            "image_id": { "S": "626e940c-a142-496f-b015-a4b0113b5718" },
            "thumbnail_key": { "S": "thumb-test.jpg" },
            "original_key": { "S": "test.jpg" },
            "uploaded_at": { "S": "2026-11-06T11:45:23.278755Z" }
        }
    ],
    "Count": 1,
    "ScannedCount": 1
}
=== Thumbnails bucket ===
2026-11-06 17:45:23       1888 thumb-test.jpg
```
</details>

---

### 3.4 Binary & Visual Verification of the Generated Thumbnail
We downloaded `s3://image-thumbnails/thumb-test.jpg` to `./thumb-verify.jpg` and inspected it with `file` and VS Code's image viewer:

| Binary `file` Inspection (`phase-2-thumbnail-verified.png`) | Visual Thumbnail Preview (`phase-2-thumbnail-visual.png`) |
| :---: | :---: |
| ![Binary Verification](../../evidence/phase-2-thumbnail-verified.png) | ![Visual Thumbnail Preview](../../evidence/phase-2-thumbnail-visual.png) |

- **Original (`test.jpg`)**: `6,208 bytes` (`400×300` JPEG)
- **Processed Thumbnail (`thumb-verify.jpg`)**: `1,888 bytes` (`200×150` JPEG, JFIF standard 1.01, aspect ratio preserved, **69.6% size reduction**)

---

## 4. Key Engineering Lessons

1. **A Python Traceback Inside CloudWatch Means Infrastructure Succeeded**: Seeing `NoSuchKey` or `UnidentifiedImageError` inside `/aws/lambda/image-processor` proved that Docker socket permissions, container networking, and Pillow's C extensions were all working—only the test input needed fixing.
2. **Validate Test Fixtures with `file`**: Running `file test.jpg` immediately catches HTML error pages masquerading as `.jpg` downloads.
3. **Custom Docker Bridge Network (`localstack-net`)**: Placing `localstack`, `dashboard`, and spawned Lambda containers (`LAMBDA_DOCKER_NETWORK=localstack-net`) on a shared bridge network allows every container to resolve `http://localstack:4566` by hostname without host port collisions.

---

<div align="center">
  <a href="./03-phase-2-docker-permission-failures.md">⬅️ Prev: Phase 2B — Docker Permission Failures</a> &nbsp;|&nbsp;
  <a href="../../README.md">🏠 Back to Main README</a> &nbsp;|&nbsp;
  <a href="./05-phase-3-dashboard.md">Next: Case Study 05 — Flask S3 Proxy Dashboard ➡️</a>
</div>
