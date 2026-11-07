# Case Study: Phase 4 — Real AWS IAM, EC2, and Deployment Pitfalls

**Project:** Serverless Image Processing Pipeline
**Phase:** Phase 4 — Real AWS Deployment
**Date:** 2026-11-07
**Outcome:** Resolved — Live dashboard on EC2 successfully authenticating via IAM Instance Profile.

## Summary

After successfully deploying the Serverless backend (S3 → Lambda → DynamoDB) to real AWS, we attempted to host the Flask dashboard on an EC2 instance. This phase exposed the complexities of AWS IAM (Identity and Access Management), the differences between LocalStack and real AWS security defaults, and how EC2 metadata provides credentials to containers.

## The 5 Failures & Fixes

| #   | Incident                          | Symptom                                                                                                       | Root Cause                                                                            | Fix                                                                          |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | **Reserved Environment Variable** | `InvalidParameterValueException` when creating Lambda.                                                        | AWS manages `AWS_*` variables internally; you cannot override `AWS_DEFAULT_REGION`.   | Removed it from the `create-function` command.                               |
| 2   | **S3 ACL Block**                  | Lambda crashed with `AccessControlListNotSupported`.                                                          | Real AWS S3 blocks public ACLs by default for security. Code had `ACL='public-read'`. | Removed `ACL='public-read'` from `app.py`, rebuilt zip, updated function.    |
| 3   | **Missing IAM Instance Profile**  | Dropdown in EC2 console was empty.                                                                            | The CLI command to create the profile failed silently earlier.                        | Re-ran `aws iam create-instance-profile` and `add-role-to-instance-profile`. |
| 4   | **Endpoint URL Hardcoded**        | Browser showed `500 Internal Server Error`.                                                                   | Flask app defaulted to `http://localstack:4566` (LocalStack) instead of real AWS.     | Removed the LocalStack endpoint default in `app.py`, rebuilt Docker image.   |
| 5   | **EC2 AccessDenied**              | Logs: `User: arn:aws:sts::...:assumed-role/ec2-dashboard-role... is not authorized to perform: dynamodb:Scan` | The IAM Role attached to EC2 lacked the specific DynamoDB policy.                     | Ran `aws iam put-role-policy` to attach the missing permissions.             |

## Deep Dive: How EC2 talks to AWS without Passwords

When running the Docker container on EC2, we did **not** pass `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY`.

1. The EC2 instance is attached to an **IAM Instance Profile** (`ec2-dashboard-profile`).
2. Inside the Docker container, `boto3` looks for credentials and sees none. It then queries the EC2 Instance Metadata Service (IMDS) at `http://169.254.169.254`.
3. The EC2 service intercepts this request, uses the Instance Profile to call AWS STS, and returns temporary, rotating credentials back to the container.
4. `boto3` uses these temporary credentials to query DynamoDB and S3.

**Why this is important:** Hardcoding credentials in Docker containers is a massive security risk. Using IAM Roles ensures that even if the container is compromised, the attacker only gets temporary access that expires automatically.

## Key Lessons Learned

1. **Real AWS is "Deny by Default".** LocalStack is permissive; real AWS requires explicit, step-by-step permissions (Roles, Policies, Instance Profiles, and Security Groups).
2. **CLI silent failures are dangerous.** When scripting IAM creation, always verify the output (e.g., `aws iam get-instance-profile`). A missing instance profile blocks EC2 setup entirely.
3. **IAM Propagation is fast, but not instant.** Updating a policy takes ~10–30 seconds to take effect globally.
4. **LocalStack vs. Real AWS Code:** Always write code that can handle both. Using `os.environ.get('AWS_ENDPOINT_URL')` allowed us to switch from LocalStack to real AWS with zero code changes for the Lambda, and only a tiny tweak for Flask.
5. **Logs are your only lifeline.** In the cloud, you can't put a `print()` statement in your terminal. `docker logs` on the EC2 server and `aws logs tail` for Lambda are the only way to debug.
