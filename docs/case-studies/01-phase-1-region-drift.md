# Case Study: Region Drift and Silent Configuration Mismatch (Phase 1)

**Project:** Serverless Image Processing Pipeline
**Environment:** Ubuntu/Debian Linux, LocalStack 3.0.2, AWS CLI 2.36.0, `awscli-local`
**Date:** Phase 1 — Provisioning local S3 and DynamoDB
**Severity:** Medium (not a blocker locally, but a guaranteed runtime failure in Phases 3–4 if left unfixed)
**Time to detect:** ~2 minutes after table creation
**Outcome:** Resolved — standardized on `us-west-2`; all resources aligned; Phase 1 closed

---

## 1. Summary

During Phase 1, a DynamoDB table was created successfully and reported `ACTIVE`. The command was considered "done" by every surface signal. However, inspecting the returned ARN revealed that the table had been created in **`us-west-2`** — not the `us-east-1` region assumed by the project's `docker-compose.yml` and the Lambda code samples.

This is a classic **silent configuration mismatch**: nothing errored, nothing warned, everything "worked," and yet a downstream component (the dashboard container) would have failed hours later with a `ResourceNotFoundException` that would have been extremely hard to trace back to the true cause.

The incident also surfaced two secondary issues worth documenting: a **trailing-space-after-backslash** shell bug and a **deprecated tool warning** (`awslocal` → `lstk aws`).

---

## 2. Timeline of Events

| #   | Action                                                   | Signal                                   | Assessment                         |
| --- | -------------------------------------------------------- | ---------------------------------------- | ---------------------------------- |
| 1   | `awslocal --version`                                     | Deprecation warning + version output     | ⚠️ Tool deprecated, but functional |
| 2   | `awslocal s3 mb s3://image-uploads` / `image-thumbnails` | `make_bucket: ...`                       | ✅ Correct                         |
| 3   | `awslocal dynamodb create-table ...`                     | JSON response, `TableStatus: ACTIVE`     | ✅ Looked correct                  |
| 4   | (Review of paste) `TableArn` contains `us-west-2`        | **Mismatch detected**                    | ❌ **Root cause found here**       |
| 5   | Confirmed `aws configure get region` → `us-west-2`       | Origin located                           | 🔍                                 |
| 6   | User decision: keep `us-west-2`                          | Architectural choice                     | ✅                                 |
| 7   | Persisted `us-west-2` to shell + AWS CLI config          | `aws configure get region` → `us-west-2` | ✅                                 |
| 8   | Verified table ARN + S3 listing                          | Both correct, both in `us-west-2`        | ✅ Phase 1 closed                  |

---

## 3. Primary Incident — Region Drift

### 3.1 Symptom

The DynamoDB `create-table` command returned successfully with this fragment:

```json
"TableArn": "arn:aws:dynamodb:us-west-2:000000000000:table/ImageMetadata"
```

Every field in the response was **internally consistent**:

- `TableStatus: ACTIVE` ✅
- `KeySchema: image_id (HASH)` ✅
- `BillingMode: PAY_PER_REQUEST` ✅
- `TableArn` ends with `table/ImageMetadata` ✅

Only the **region segment** in the ARN (`us-west-2`) was wrong relative to the project's assumed `us-east-1`.

### 3.2 Why This Is Dangerous

The failure mode is **deferred and misattributed**:

| When the bug would surface             | What the error would look like              | Where the developer would look first     |
| -------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| Phase 2 — Lambda writing to the table  | `ResourceNotFoundException` from DynamoDB   | Lambda IAM permissions, table name typos |
| Phase 3 — Dashboard scanning the table | `ResourceNotFoundException` / empty page    | Dashboard container config, networking   |
| Phase 4 — Real AWS deploy              | `ValidationException` / cross-region errors | IAM roles, bucket policies               |

In every case, the **actual cause** (a region mismatch set back in Phase 1) is invisible from the error message. The developer would waste hours checking the wrong thing.

### 3.3 Root Cause Analysis

**① The "AWS SDK/CLI default region" rule is subtle.**
The AWS CLI resolves its region using this priority order (highest to lowest):

1. `--region` flag on the command
2. `AWS_REGION` environment variable
3. `AWS_DEFAULT_REGION` environment variable
4. `region` key in `~/.aws/config` under `[default]`
5. **SDK default → `us-east-1`** (only if none of the above are set)

In this environment, the value came from layer 4 — an existing `~/.aws/config` with `region = us-west-2` (likely left over from previous AWS experimentation on this machine). Because `LocalStack` accepts any region string and echoes it back in ARNs, the CLI silently used that value without any indication that it disagreed with the project's intent.

**② LocalStack does not enforce region consistency.**
Unlike real AWS (where a resource in one region is invisible from another), **LocalStack behaves as if all regions are aliases of a single backend**. So creating a table in `us-west-2` works, and querying it from `us-east-1` _inside LocalStack_ also works — **which masks the bug even when it should be most visible**. This is a critical footgun: code that passes locally with mismatched regions **will fail on real AWS**.

**③ The project documentation (my sample code) hard-coded `us-east-1` in multiple places:**

- `docker-compose.yml` → `AWS_DEFAULT_REGION=us-east-1`
- Lambda `app.py` → `region_name='us-east-1'`
- Dashboard `app.py` → `region_name='us-east-1'`
- All `awslocal` examples in the walkthrough (implicit default)

Because the walkthrough used `awslocal` without `--region`, the actual region came from the developer's environment, **not** from the project spec. This is a documentation bug, not a code bug — but it created the mismatch.

### 3.4 Resolution

Two architectural options were on the table:

| Option                                              | Pro                                                            | Con                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| **A) Force everything to `us-east-1`**              | Matches existing documentation                                 | Requires changing developer's environment; real-AWS region may differ |
| **B) Adopt the environment's region (`us-west-2`)** | No environment changes; matches developer's existing AWS setup | Requires updating docs and `docker-compose.yml`                       |

**Option B** was chosen because:

- The developer had a reason to prefer `us-west-2` (existing familiarity / existing real-AWS resources)
- `docker-compose.yml` and the Python code samples were trivial to update (one line each)
- Region is now explicit and consistent across **all** layers

### 3.5 Fix Applied

**Persisted the region at three layers** so no ambiguity remains:

```bash
# 1. Current shell
export AWS_DEFAULT_REGION=us-west-2

# 2. Future shells
echo 'export AWS_DEFAULT_REGION=us-west-2' >> ~/.bashrc

# 3. AWS CLI config file (authoritative for awslocal/aws)
aws configure set region us-west-2
```

**Verified consistency:**

```bash
aws configure get region                  # → us-west-2
echo $AWS_DEFAULT_REGION                  # → us-west-2
awslocal dynamodb describe-table ...      # → ARN contains us-west-2
```

**Planned code change (Phase 2/3):** Replace hard-coded `region_name='us-east-1'` with:

```python
import os
REGION = os.environ.get('AWS_DEFAULT_REGION', 'us-west-2')
```

This makes the code region-agnostic and eliminates this class of bug permanently.

---

## 4. Secondary Incident — Trailing Space After Line Continuation

### 4.1 Symptom

The original pasted command contained a **space after the backslash** on one line:

```bash
  --attribute-definitions AttributeName=image_id,AttributeType=S \
  --key-schema AttributeName=image_id,KeyType=HASH \
```

Note the `\ ` (backslash + space) on the first line, versus `\` (backslash only) on the second.

### 4.2 Root Cause

In bash, `\` at end of line means **"continue onto the next line."** But `\ ` (backslash-space) means **"escape the space character."** These are two completely different behaviors:

- `\` + `\n` → line continuation (correct)
- `\ ` + `\n` → escapes the space, then **ends the command at the newline** (bug)

The command **appeared** to work in the terminal because:

- It's possible the pasted text had a display artifact, not an actual space
- Or the `awslocal` wrapper happened to tolerate it this time

However, this exact pattern **will fail silently or loudly in a CI/CD environment** (Phase 6), where bash is run non-interactively and whitespace handling is stricter. GitHub Actions runners, for example, will refuse to parse such a command correctly.

### 4.3 Resolution and Prevention

**Rule:** _Never_ put whitespace after `\` in a multi-line shell command.

**Prevention checklist:**

- [ ] Enable a `cat -A` habit when debugging multi-line commands: `\ ` shows as `\ $` (trailing space) vs `\` as `\$`
- [ ] Use `shellcheck` on any shell script that will end up in CI/CD
- [ ] Prefer `printf` or array-based argument construction over line continuations in scripts (Phase 6 will do this)

---

## 5. Tertiary Incident — `awslocal` Deprecation Warning

### 5.1 Symptom

Every `awslocal` call now prints a large, noisy banner:

```
WARNING: 'awslocal' is deprecated. Use 'lstk aws' instead.
```

### 5.2 Root Cause

LocalStack's ecosystem is migrating from `awscli-local` (the `awslocal` wrapper) to `lstk`, a new unified CLI. `awslocal` still works, but is in maintenance mode.

### 5.3 Resolution

**Immediate — silence the noise:**

```bash
export DISABLE_DEPRECATION_NOTICE=1
```

**Long term (Phase 6 or later):** Migrate all scripts and CI workflows to `lstk aws`, which uses **identical subcommands** — only the prefix changes:

| Old                                  | New                                  |
| ------------------------------------ | ------------------------------------ |
| `awslocal s3 mb s3://bucket`         | `lstk aws s3 mb s3://bucket`         |
| `awslocal dynamodb create-table ...` | `lstk aws dynamodb create-table ...` |

No subcommand syntax changes; no `--endpoint-url` needed. This is a **cosmetic migration**, so it can be deferred without risk.

---

## 6. Lessons Learned

1. **"Command succeeded" does not mean "intent achieved."** The `create-table` command returned `ACTIVE` — every field looked correct. The only way to catch the region bug was to **read the full ARN carefully**. Verifying output means verifying **semantics**, not just exit codes.

2. **LocalStack's region-agnostic behavior is a two-edged sword.** It makes local development flexible, but it **hides bugs that will bite on real AWS**. This is a critical reason to migrate to real AWS in Phase 4 before considering the project "done."

3. **The AWS CLI's region resolution order is a common footgun.** `~/.aws/config` is the _last_ non-default layer, but it often goes unnoticed because it's a leftover from unrelated work. When a project assumes a specific region, **that assumption must be enforced at every layer** — env var, config file, `docker-compose.yml`, and code — not left to chance.

4. **Environment variables ≠ intent.** `AWS_DEFAULT_REGION` set in a developer's shell can silently disagree with what a project file says. **Project documentation and code should never assume a region**; they should read from a single explicit source.

5. **Hard-coded values in sample code are a class of debt.** The `us-east-1` values I wrote into the code samples looked harmless but created an implicit contract with the environment. The better pattern (`os.environ.get('AWS_DEFAULT_REGION', ...)`) is a one-line fix that prevents a whole class of bugs.

6. **Whitespace is code.** A single trailing space after `\` is the difference between a working command and a broken one in CI. `shellcheck` catches this; eyeballs don't.

7. **Deprecation warnings are cheap to fix now, expensive later.** The `awslocal` → `lstk` migration is trivial today but will become urgent when LocalStack drops `awslocal` support entirely. Track these signals even when they don't block progress.

---

## 7. Final State (Phase 1 Closed)

**Region:** `us-west-2` — enforced at shell env var, `~/.aws/config`, and (planned) `docker-compose.yml`

**S3 buckets:**

```
image-uploads      (2026-11-05)
image-thumbnails   (2026-11-05, ACL public-read)
```

**DynamoDB table:**

```json
{
  "TableName": "ImageMetadata",
  "TableStatus": "ACTIVE",
  "TableArn": "arn:aws:dynamodb:us-west-2:000000000000:table/ImageMetadata",
  "KeySchema": [{ "AttributeName": "image_id", "KeyType": "HASH" }],
  "BillingMode": "PAY_PER_REQUEST"
}
```

**Open action items carried into Phase 2:**

- [ ] Update `docker-compose.yml` → `AWS_DEFAULT_REGION=us-west-2`
- [ ] Update Lambda and dashboard code → `REGION = os.environ.get('AWS_DEFAULT_REGION', 'us-west-2')`
- [ ] Add `shellcheck` to CI/CD pipeline (Phase 6)
- [ ] Plan migration from `awslocal` → `lstk aws` before LocalStack drops support (Phase 6)
