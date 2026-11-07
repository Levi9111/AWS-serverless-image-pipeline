# Case Study: Phase 6 — CI/CD OIDC Authentication & The GitHub Immutable ID Trap

**Project:** Serverless Image Processing Pipeline
**Phase:** Phase 6 — CI/CD with GitHub Actions
**Date:** 2026-11-07
**Outcome:** Resolved — Automated frontend deployment triggered successfully via GitHub Actions.

## Summary

We implemented CI/CD pipelines using GitHub Actions. To follow AWS security best practices, we avoided hardcoding long-lived AWS Access Keys in GitHub secrets. Instead, we used **OIDC (OpenID Connect)** to allow GitHub to temporarily assume an IAM Role in AWS.

However, the pipeline failed with `Not authorized to perform sts:AssumeRoleWithWebIdentity`. The root cause was a recent change by GitHub regarding how repositories identify themselves in OIDC tokens.

## Timeline of Errors & Fixes

| #   | Incident                    | Symptom                                                  | Root Cause                                                                                                                                                      | Fix                                                                                                                                |
| --- | --------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **AWS Console Validation**  | "GitHub organization is required"                        | AWS Wizard expects an org name.                                                                                                                                 | Used the personal GitHub username (`Levi9111`) as the org name.                                                                    |
| 2   | **Wildcard Restriction**    | AWS blocked saving trust policy with `repo:user/repo:*`. | AWS security validation flags wildcards as a risk.                                                                                                              | Tried to specify the exact branch: `ref:refs/heads/main`.                                                                          |
| 3   | **OIDC AssumeRole Failure** | `Error: Could not assume role with OIDC: Not authorized` | GitHub updated their `sub` (subject) claim to include immutable numeric IDs (e.g., `repo:Levi9111@12345/repo@67890...`). Our exact string match missed the IDs. | Updated the Trust Policy to use wildcards just for the IDs: `repo:Levi9111@*/AWS-serverless-image-pipeline@*:ref:refs/heads/main`. |
| 4   | **Docker Auth Error**       | `malformed HTTP Authorization header`                    | The `DOCKERHUB_USERNAME` GitHub Secret had a capital `L` (`Levi9111`), but the actual Docker Hub ID was lowercase (`levi9111`).                                 | Corrected the secret to the exact case-sensitive username.                                                                         |

## The "Immutable ID" Problem Explained

Historically, a GitHub OIDC token's `sub` claim looked like this:
`repo:Levi9111/AWS-serverless-image-pipeline:ref:refs/heads/main`

In 2024/2025, GitHub introduced **Immutable IDs** for repositories. Now, the claim looks like this:
`repo:Levi9111@12345678/AWS-serverless-image-pipeline@87654321:ref:refs/heads/main`

Because the numbers (`@12345678`) are unpredictable, hardcoding the exact string in an AWS Trust Policy is nearly impossible. The solution is to use a `StringLike` condition with wildcards that still safely restrict access to the specific user, repository, and branch:

```json
"StringLike": {
  "token.actions.githubusercontent.com:sub": "repo:Levi9111@*/AWS-serverless-image-pipeline@*:ref:refs/heads/main"
}
```

## Key Lessons Learned

1. **Secrets vs. OIDC:** Storing AWS Access Keys in GitHub secrets works, but it's a security risk. OIDC is the modern standard because it uses short-lived, rotating tokens.
2. **The AWS Console is just a UI:** The AWS IAM "Web Identity" creation wizard can be clunky. Manual editing of the Trust Relationship JSON is almost always required for exact precision.
3. **The Sub Claim is Dynamic:** Always verify the exact OIDC `sub` claim format. A quick debug workflow can print the decoded token if things fail.
4. **The Power of Path Filtering:** The CI/CD workflows are highly efficient. Because we used `paths: - 'frontend/**'`, changing the React app does not trigger a rebuild of the Python Lambda function or the Docker container.

## Final Architecture

- **Frontend (`frontend/`):** Changes pushed to `main` trigger GitHub Actions -> builds Vite React app -> syncs to AWS S3.
- **Backend (`dashboard/`):** Changes trigger GitHub Actions -> builds Docker image -> pushes to Docker Hub -> SSHes into EC2 to pull and restart.
- **Lambda (`lambda/`):** Changes trigger GitHub Actions -> builds Python 3.9 zip inside Docker -> updates AWS Lambda code.
- **Authentication:** Secure OIDC connection (`GitHubActions-DeployRole`) with no exposed passwords.
