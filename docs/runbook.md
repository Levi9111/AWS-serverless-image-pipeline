<div align="center">
  <a href="../README.md">🏠 Back to Main README</a> &nbsp;|&nbsp;
  <a href="./architecture.md">🏗️ System Architecture</a> &nbsp;|&nbsp;
  <a href="./case-studies/00-phase-0-localstack-permission-crash.md">🔬 Case Studies</a>
</div>

---

# Operations & Deployment Runbook

This runbook provides complete, copy-pasteable procedures to build, run, verify, and troubleshoot the **Serverless Image Processing Pipeline** in both **LocalStack (Local Development)** and **Amazon Web Services (Production `us-west-2`)**.

---

## Part 1: Local Development Environment (LocalStack + Docker)

### 1.1 Start LocalStack Emulation
```bash
export AWS_DEFAULT_REGION=us-west-2
docker compose up -d localstack
```

Wait until all four emulated services (`s3`, `dynamodb`, `lambda`, `logs`) report `available`:
```bash
until curl -s http://localhost:4566/_localstack/health | grep -q '"s3": "available"'; do
  echo "Waiting for LocalStack..."
  sleep 2
done
curl -s http://localhost:4566/_localstack/health
```

### 1.2 Create S3 Buckets & DynamoDB Table
```bash
# Create source and thumbnail buckets
awslocal --region us-west-2 s3 mb s3://image-uploads
awslocal --region us-west-2 s3 mb s3://image-thumbnails

# Create DynamoDB table
awslocal --region us-west-2 dynamodb create-table \
  --table-name ImageMetadata \
  --attribute-definitions AttributeName=image_id,AttributeType=S \
  --key-schema AttributeName=image_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

### 1.3 Build the Lambda Deployment Package (`function.zip`)
```bash
cd lambda
rm -rf package function.zip

# Build Pillow==10.4.0 for Python 3.9 (Amazon Linux 2 ABI)
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -v "$PWD":/var/task:z \
  public.ecr.aws/sam/build-python3.9:latest \
  pip install --no-cache-dir -r /var/task/requirements.txt -t /var/task/package

# Bundle handler and zip from inside package/
cp app.py package/
(cd package && zip -r ../function.zip . > /dev/null)
cd ..

# Verify ABI compatibility
unzip -l lambda/function.zip | grep cpython-39
```

### 1.4 Deploy Lambda & Configure S3 Event Notification
```bash
awslocal --region us-west-2 lambda create-function \
  --function-name image-processor \
  --runtime python3.9 \
  --handler app.lambda_handler \
  --zip-file fileb://lambda/function.zip \
  --role arn:aws:iam::000000000000:role/lambda-role \
  --timeout 30 \
  --memory-size 256 \
  --environment "Variables={AWS_DEFAULT_REGION=us-west-2,AWS_ENDPOINT_URL=http://localstack:4566,UPLOAD_BUCKET=image-uploads,THUMBNAIL_BUCKET=image-thumbnails,TABLE_NAME=ImageMetadata}"

# Poll until State=Active
for i in $(seq 1 30); do
  state=$(awslocal --region us-west-2 lambda get-function-configuration \
    --function-name image-processor --query 'State' --output text 2>/dev/null)
  echo "Attempt $i: State=$state"
  [ "$state" = "Active" ] && break
  sleep 2
done

# Grant S3 permission to invoke Lambda
awslocal --region us-west-2 lambda add-permission \
  --function-name image-processor \
  --statement-id s3invoke \
  --action lambda:InvokeFunction \
  --principal s3.amazonaws.com \
  --source-arn arn:aws:s3:::image-uploads

# Attach S3 ObjectCreated notification trigger
awslocal --region us-west-2 s3api put-bucket-notification-configuration \
  --bucket image-uploads \
  --notification-configuration '{
    "LambdaFunctionConfigurations": [{
      "LambdaFunctionArn": "arn:aws:lambda:us-west-2:000000000000:function:image-processor",
      "Events": ["s3:ObjectCreated:*"]
    }]
  }'
```

### 1.5 Smoke-Test the Pipeline Locally
```bash
# Upload test image
awslocal --region us-west-2 s3 cp test.jpg s3://image-uploads/test.jpg
sleep 5

# 1. Check DynamoDB metadata
awslocal --region us-west-2 dynamodb scan --table-name ImageMetadata

# 2. Check generated thumbnail in S3
awslocal --region us-west-2 s3 ls s3://image-thumbnails/

# 3. Download and verify thumbnail binary
awslocal --region us-west-2 s3 cp s3://image-thumbnails/thumb-test.jpg ./thumb-verify.jpg
file ./thumb-verify.jpg
```

### 1.6 Start Flask API & React Admin Console
```bash
# Start containerized Flask API on port 5000
docker compose up -d --build dashboard

# Start React Admin Console on port 5173
cd frontend
npm install
npm run dev
```

---

## Part 2: Production AWS Deployment (`us-west-2`)

### 2.1 Provision S3 & DynamoDB
```bash
aws s3 mb s3://shanjid-2026-image-uploads --region us-west-2
aws s3 mb s3://shanjid-2026-image-thumbnails --region us-west-2

aws dynamodb create-table \
  --table-name ImageMetadata \
  --attribute-definitions AttributeName=image_id,AttributeType=S \
  --key-schema AttributeName=image_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-west-2
```

### 2.2 Create IAM Execution Role for Lambda
```bash
aws iam create-role \
  --role-name lambda-image-processor-role \
  --assume-role-policy-document file://trust-policy.json

aws iam attach-role-policy \
  --role-name lambda-image-processor-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws iam put-role-policy \
  --role-name lambda-image-processor-role \
  --policy-name LambdaS3DynamoDBPolicy \
  --policy-document file://lambda-permissions.json
```

### 2.3 Deploy Production Lambda Function
```bash
aws lambda create-function \
  --function-name image-processor \
  --runtime python3.9 \
  --handler app.lambda_handler \
  --role arn:aws:iam::199720489393:role/lambda-image-processor-role \
  --zip-file fileb://lambda/function.zip \
  --timeout 30 \
  --memory-size 256 \
  --environment "Variables={UPLOAD_BUCKET=shanjid-2026-image-uploads,THUMBNAIL_BUCKET=shanjid-2026-image-thumbnails,TABLE_NAME=ImageMetadata}" \
  --region us-west-2
```

### 2.4 Provision EC2 Instance Profile for Backend API
```bash
aws iam create-role \
  --role-name ec2-dashboard-role \
  --assume-role-policy-document file://lambda/ec2-trust-policy.json

aws iam put-role-policy \
  --role-name ec2-dashboard-role \
  --policy-name EC2DashboardPermissions \
  --policy-document file://ec2-permissions.json

aws iam create-instance-profile --instance-profile-name ec2-dashboard-profile
aws iam add-role-to-instance-profile \
  --instance-profile-name ec2-dashboard-profile \
  --role-name ec2-dashboard-role
```

---

## Part 3: Diagnostic & Troubleshooting Quick Reference

| Symptom | Diagnostic Command | Root Cause & Fix |
| :--- | :--- | :--- |
| LocalStack container exits immediately | `docker ps -a && docker compose logs localstack` | Host permission/SELinux denial on `./localstack_data`. Fix with `chmod 777 localstack_data` and `:z` mount flag. |
| Lambda `State: Failed` (`Docker not available`) | `docker compose exec localstack ls -la /var/run/docker.sock` | SELinux blocking `/var/run/docker.sock`. Add `security_opt: [label=disable]` to `localstack` in `docker-compose.yml`. |
| Lambda fails with `Invalid ELF header` or `_imaging` error | `unzip -l lambda/function.zip \| grep cpython` | Built on host Python 3.14 instead of `python3.9`. Rebuild using `public.ecr.aws/sam/build-python3.9:latest`. |
| Real AWS Lambda crashes on `s3.put_object` | `aws logs tail /aws/lambda/image-processor --follow` | `AccessControlListNotSupported`: remove `ACL="public-read"` from `s3.put_object()`. |
| Frontend shows `Failed to Load Pipeline Data` | `curl -i http://<EC2_HOST>:5000/api/images` | Verify EC2 container is running (`sudo docker ps`) and Security Group allows inbound TCP `5000`. |

---

<div align="center">
  <a href="../README.md">🏠 Back to Main README</a> &nbsp;|&nbsp;
  <a href="./architecture.md">🏗️ System Architecture</a>
</div>

