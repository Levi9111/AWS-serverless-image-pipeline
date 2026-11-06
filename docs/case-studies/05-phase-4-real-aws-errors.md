# Case Study: Phase 4 — Deploying to Real AWS

**Project:** Serverless Image Processing Pipeline
**Phase:** Phase 4 — Real AWS Deployment
**Date:** 2026-11-06
**Outcome:** Resolved — Backend pipeline successfully deployed to real AWS (S3 → Lambda → DynamoDB).

## Summary

Moving from LocalStack to real AWS exposed several critical differences in security, permissions, and platform defaults. While LocalStack is permissive (everything is `test`/`test` and ACLs are open), real AWS strictly enforces IAM boundaries and locks down public access by default.

We encountered **five distinct failures** during deployment. Each failure revealed an important AWS security concept.

## Timeline of Failures & Fixes

| #   | Incident               | Symptom                                                                   | Root Cause                                                                                              | Fix                                                                                    |
| --- | ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | **IAM Bootstrapping**  | `AccessDenied` when attaching policies to `pipeline-dev` via local CLI.   | An IAM user cannot grant itself permissions. It lacked `iam:AttachUserPolicy`.                          | Logged in as Root → CloudShell → attached policies.                                    |
| 2   | **Console UI Filter**  | Searching for `AWSLambda_FullAccess` returned "0 matches" in the console. | The console defaults to filtering by "Customer managed" policies, hiding "AWS managed" policies.        | Changed the filter dropdown to "AWS managed" (or used CloudShell/CLI to bypass UI).    |
| 3   | **Missing CreateRole** | `AccessDenied` when creating the Lambda IAM Role.                         | `IAMReadOnlyAccess` allows reading, but not creating roles (`iam:CreateRole`).                          | Added `IAMFullAccess` to `pipeline-dev` via CloudShell.                                |
| 4   | **Reserved Env Var**   | `InvalidParameterValueException` when creating Lambda.                    | Tried to set `AWS_DEFAULT_REGION` manually. AWS reserves `AWS_*` variables and manages them internally. | Removed it from the `create-function` command. Code falls back to `us-west-2` default. |
| 5   | **S3 ACL Block**       | Lambda crashed: `AccessControlListNotSupported`.                          | AWS S3 blocks public access by default. The code tried to upload a thumbnail with `ACL='public-read'`.  | Removed `ACL='public-read'` from `app.py`, rebuilt zip, updated function.              |

## Key Lessons Learned

1. **The "Root User" is your emergency key.** For the very first setup of a new AWS account, the IAM user you create (like `pipeline-dev`) often won't have permission to configure IAM. You must use the Root user to "bootstrap" the IAM user with the right policies.
2. **Real AWS is "Deny by Default."** LocalStack lets you do anything. Real AWS blocks public S3 buckets, requires strict IAM roles, and rejects reserved environment variables. This is good for production security, but it creates friction during learning.
3. **CloudShell is a lifesaver.** When the IAM Console UI bugs out or your local CLI is locked out due to IAM bootstrapping, logging in as Root and using CloudShell bypasses all local credential issues because it inherits root permissions directly in the browser.
4. **Logs are non-negotiable.** On LocalStack, we saw errors in the terminal. On real AWS, the Lambda crashed silently. Without `aws logs tail /aws/lambda/image-processor --follow`, we would have had no idea that `ACL='public-read'` was the culprit.

## Final Success

After removing the public ACL, the pipeline executed flawlessly. A file uploaded to `shanjid-2026-image-uploads/test-v4.jpg` was successfully processed into `thumb-test-v4.jpg` in S3, and a metadata record was written to the real DynamoDB `ImageMetadata` table.
