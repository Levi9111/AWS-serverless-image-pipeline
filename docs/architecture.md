<div align="center">
  <a href="../README.md">🏠 Back to Main README</a> &nbsp;|&nbsp;
  <a href="./runbook.md">📘 Operations Runbook</a> &nbsp;|&nbsp;
  <a href="./case-studies/00-phase-0-localstack-permission-crash.md">🔬 Case Studies</a>
</div>

---

# System Architecture & Service Map

This document details the cloud architecture, data flow, IAM security model, network topology, and CI/CD automation of the **Serverless Image Processing Pipeline**.

---

## 1. High-Level Cloud Architecture

```mermaid
flowchart TB
    subgraph ClientTier ["Client & Ingestion Tier"]
        CLI["AWS CLI / Uploader"]
        Browser["Web Browser\n(Admin User)"]
    end

    subgraph AWSCloud ["AWS Cloud / LocalStack (us-west-2)"]
        subgraph EventPipeline ["Event-Driven Serverless Pipeline"]
            S3Upload[("Amazon S3\nshanjid-2026-image-uploads\n(Source Bucket)")]
            Lambda["AWS Lambda\nimage-processor\n(Python 3.9 + Pillow 10.4)"]
            S3Thumb[("Amazon S3\nshanjid-2026-image-thumbnails\n(Private Thumbnail Bucket)")]
            DDB[("Amazon DynamoDB\nImageMetadata\n(PK: image_id)")]
            CW["Amazon CloudWatch Logs\n/aws/lambda/image-processor"]
        end

        subgraph ComputeAPI ["API & Proxy Tier (Amazon EC2)"]
            EC2["EC2 Instance (Ubuntu)\nSecurity Group: TCP 22, 5000\nIAM Profile: ec2-dashboard-profile"]
            DockerAPI["Docker Container: dashboard-container\nFlask 3.0 + Gunicorn/Werkzeug (:5000)"]
            EC2 --- DockerAPI
        end

        subgraph FrontendHosting ["Static Web Hosting Tier"]
            S3Web[("Amazon S3 Static Website\nshanjid-2026-frontend\n(React 19 + TS + Tailwind + GSAP)")]
        end
    end

    CLI -->|"1. PutObject (Original Image)"| S3Upload
    S3Upload -->|"2. s3:ObjectCreated:* Event"| Lambda
    Lambda -->|"3. GetObject (Download Bytes)"| S3Upload
    Lambda -->|"4. PutObject (200x200 JPEG)"| S3Thumb
    Lambda -->|"5. PutItem (Metadata JSON)"| DDB
    Lambda -.->|"6. Execution Telemetry"| CW

    Browser -->|"7. Loads SPA Bundle"| S3Web
    Browser -->|"8. GET /api/images"| DockerAPI
    Browser -->|"9. GET /thumb/<key>"| DockerAPI
    DockerAPI -->|"10. dynamodb:Scan (via IMDS Role)"| DDB
    DockerAPI -->|"11. s3:GetObject (via IMDS Role)"| S3Thumb
```

---

## 2. Service Map & Resource Inventory

| Service Tier | Resource Name (LocalStack) | Resource Name (Production AWS `us-west-2`) | Purpose & Configuration |
| :--- | :--- | :--- | :--- |
| **Source Storage** | `s3://image-uploads` | `s3://shanjid-2026-image-uploads` | Receives raw image uploads; configured with `LambdaFunctionConfigurations` on `s3:ObjectCreated:*`. |
| **Serverless Compute** | `image-processor` | `arn:aws:lambda:us-west-2:199720489393:function:image-processor` | Python `3.9`, `256 MB` RAM, `30s` timeout, `x86_64` `cpython-39` Pillow package (`function.zip`). |
| **Processed Storage** | `s3://image-thumbnails` | `s3://shanjid-2026-image-thumbnails` | Stores resized JPEG thumbnails (`thumb-<original_key>`). Private bucket; accessed via Flask proxy. |
| **NoSQL Metadata Store** | `ImageMetadata` | `arn:aws:dynamodb:us-west-2:199720489393:table/ImageMetadata` | Partition Key: `image_id` (`String`), `PAY_PER_REQUEST` (On-Demand) capacity mode. |
| **Backend REST API** | `dashboard` (`localstack-net:5000`) | EC2 `i-011898b03051e8d61` (`35.87.135.224:5000`) | Flask `3.0` + `flask-cors` Docker container serving `/api/images` and `/thumb/<key>`. |
| **Frontend Console** | `localhost:5173` (Vite Dev) | `s3://shanjid-2026-frontend` | React 19 + TypeScript + Tailwind v4 + GSAP SPA served via S3 Static Website Hosting. |

---

## 3. Data Model (`ImageMetadata` DynamoDB Table)

Every processed image writes a single item to `ImageMetadata`:

| Attribute | DynamoDB Type | Example Value | Description |
| :--- | :---: | :--- | :--- |
| **`image_id`** *(PK)* | `S` (String) | `"626e940c-a142-496f-b015-a4b0113b5718"` | UUIDv4 generated at processing time. |
| **`original_key`** | `S` (String) | `"test-v4.jpg"` | Object key in the source S3 upload bucket. |
| **`thumbnail_key`** | `S` (String) | `"thumb-test-v4.jpg"` | Object key in the S3 thumbnail bucket. |
| **`size_bytes`** | `N` (Number) | `6208` | Original uploaded file size in bytes. |
| **`uploaded_at`** | `S` (String) | `"2026-11-06T14:15:38.246674Z"` | ISO-8601 UTC timestamp of processing. |

---

## 4. Security & IAM Least-Privilege Matrix

```mermaid
flowchart LR
    subgraph Roles ["IAM Principals & Roles"]
        R1["lambda-image-processor-role\n(Assumed by lambda.amazonaws.com)"]
        R2["ec2-dashboard-role\n(Attached via ec2-dashboard-profile)"]
        R3["GitHubActions-DeployRole\n(Assumed via GitHub OIDC)"]
    end

    subgraph Policies ["Scoped Permissions"]
        P1["s3:GetObject on uploads/*\ns3:PutObject on thumbnails/*\ndynamodb:PutItem on ImageMetadata\nlogs:CreateLogStream / PutLogEvents"]
        P2["dynamodb:Scan on ImageMetadata\ns3:GetObject on thumbnails/*"]
        P3["lambda:UpdateFunctionCode\ns3:PutObject / DeleteObject on frontend/*"]
    end

    R1 --> P1
    R2 --> P2
    R3 --> P3
```

- **Lambda Execution Policy**: Defined in [`trust-policy.json`](../trust-policy.json) and [`lambda-permissions.json`](../lambda-permissions.json).
- **EC2 Instance Profile Policy**: Defined in [`lambda/ec2-trust-policy.json`](../lambda/ec2-trust-policy.json) and [`ec2-permissions.json`](../ec2-permissions.json).
- **Frontend Bucket Policy**: Defined in [`frontend-policy.json`](../frontend-policy.json) (`s3:GetObject` scoped strictly to static web assets in `shanjid-2026-frontend/*`).

---

## 5. CI/CD Deployment Topology (`.github/workflows/`)

```mermaid
flowchart TD
    Push["git push origin main"] --> PathFilter{"Changed Path Filter"}

    PathFilter -->|"lambda/**"| W1["deploy-lambda.yml"]
    PathFilter -->|"dashboard/**"| W2["deploy-backend.yml"]
    PathFilter -->|"frontend/**"| W3["deploy-frontend.yml"]

    W1 -->|"SAM Python 3.9 Container Build"| Zip["function.zip (cpython-39)"]
    Zip -->|"AWS OIDC Role"| UpdateLambda["aws lambda update-function-code"]

    W2 -->|"docker build & push"| DockerHub["Docker Hub: image-dashboard:latest"]
    DockerHub -->|"SSH Action (appleboy/ssh-action)"| RestartEC2["EC2: docker pull & docker run :5000"]

    W3 -->|"npm ci && npm run build"| Dist["frontend/dist/"]
    Dist -->|"AWS OIDC Role"| SyncS3["aws s3 sync --delete s3://shanjid-2026-frontend/"]
```

---

<div align="center">
  <a href="../README.md">🏠 Back to Main README</a> &nbsp;|&nbsp;
  <a href="./runbook.md">📘 Next: Operations Runbook ➡️</a>
</div>

