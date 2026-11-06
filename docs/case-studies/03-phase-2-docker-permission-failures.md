# Case Study: Two Docker Permission Failures in Phase 2

**Project:** Serverless Image Processing Pipeline
**Phase:** Phase 2 — Lambda build & deployment
**Date:** 2026-11-06
**Time to resolve:** ~30 minutes total across both incidents
**Outcome:** Resolved — function `Active`, pipeline ready for trigger wiring

---

## Summary

Phase 2 hit two related permission failures, both caused by **host↔container access boundaries**. The first blocked the Lambda _build_; the second blocked the Lambda _runtime_. Both looked like different problems but shared the same root cause: on Fedora with SELinux enforcing, a bind-mounted host resource is not automatically accessible inside a container unless explicitly permitted.

The pattern is worth documenting because it will recur — it's not a one-off.

---

## Timeline

| #   | Action                                                    | Result                                                                        |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Build Pillow into `package/` inside a SAM container       | ❌ `Permission denied: '/var/task/requirements.txt'`                          |
| 2   | Cascading errors                                          | ❌ `cp: cannot create ... 'package/'` (dir never created), wrong zip produced |
| 3   | Rebuild with `:z` + `--user` + `-e HOME`                  | ✅ `function.zip` 4.7 MB, `cpython-39` ABI confirmed                          |
| 4   | `create-function` returned `State: Pending`               | ⏳ Expected                                                                   |
| 5   | `State: Pending` → `State: Failed`                        | ❌ `StateReason: "Docker not available"`                                      |
| 6   | Diagnostic: `ls /var/run/docker.sock` inside LocalStack   | ❌ `Permission denied` (SELinux blocking `stat()`)                            |
| 7   | Add `security_opt: label=disable` to `localstack` service | ✅ Socket accessible                                                          |
| 8   | `create-function` again                                   | ✅ `State: Active` on first poll                                              |

---

## Error 1 — Build container cannot read bind-mounted source

### Symptom

```
ERROR: Could not open requirements file: [Errno 13] Permission denied: '/var/task/requirements.txt'
cp: cannot create regular file 'package/': Not a directory
cd: no such file or directory: package
```

The zip that eventually got produced was broken (1.6 KB, contained a stray `Dockerfile`, no `app.py`).

### Root Cause

The `docker run -v "$PWD":/var/task` bind mount was not readable by the SAM container under Fedora's SELinux policy. Additionally, the container ran as a different UID than the host user, so even without SELinux, files pip created would be owned by `root` and unwritable afterwards.

### Fix

Four flags on the `docker run` command:

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -v "$PWD":/var/task:z \
  public.ecr.aws/sam/build-python3.9:latest \
  pip install --no-cache-dir -r /var/task/requirements.txt -t /var/task/package
```

| Flag                       | Fixes                                                          |
| -------------------------- | -------------------------------------------------------------- |
| `--user $(id -u):$(id -g)` | UID mismatch — pip writes files as the invoking user, not root |
| `-e HOME=/tmp`             | pip needs a writable home even with `--no-cache-dir`           |
| `:z`                       | SELinux label — allows container read/write on the mount       |

Result: `function.zip` grew to 4.7 MB, contained `app.py` at root, and `PIL/*.cpython-39-*.so` confirmed the correct ABI.

---

## Error 2 — LocalStack cannot spawn Lambda runtime container

### Symptom

```json
{
  "State": "Failed",
  "StateReason": "Error while creating lambda: Docker not available",
  "StateReasonCode": "InternalError"
}
```

### Diagnostic

```bash
docker-compose exec localstack ls -la /var/run/docker.sock
```

Output:

```
ls: cannot access '/var/run/docker.sock': Permission denied
```

**This is the key signal.** The socket was _mounted_ (per `docker-compose.yml`), but a basic `stat()` from inside the container was denied. That is not a UID/permission problem — the socket's `srw-rw----` mode would produce `No such file` or show the file even to non-members. `Permission denied` on `stat()` is the **SELinux signature**: the container's confinement profile forbids access to the socket's host label (`docker_var_run_t`).

To run a Lambda, LocalStack calls the Docker API to start a sibling container (`public.ecr.aws/lambda/python:3.9`). With the socket inaccessible, that call fails, and the function state flips to `Failed`.

### Fix

Add `security_opt` to the `localstack` service in `docker-compose.yml`:

```yaml
localstack:
  # ... existing config ...
  security_opt:
    - label=disable
```

Then restart:

```bash
docker-compose down
docker-compose up -d localstack
```

After restart:

```bash
docker-compose exec localstack ls -la /var/run/docker.sock
# → srw-rw----. 1 root 967 0 Nov  5 15:30 /var/run/docker.sock
```

No more permission denied. Re-running `create-function` produced `State: Active` on the first poll.

### Why `label=disable` and not `user: root`

`user: root` fixes UID mismatch but **does not disable SELinux labeling** — the container process would still be denied access to the socket under the default policy. `label=disable` is the **targeted fix** for exactly this class of failure, recommended by both Docker and SELinux documentation for "container needs to reach a host resource that SELinux protects."

Side effect: none for other containers; only this one. `user: root` should only be added if `label=disable` alone is insufficient.

---

## What Made This Hard to Diagnose

1. **`docker-compose ps` shows only running containers.** The `Failed` state is not reflected — you must use `get-function-configuration --query StateReason` to see _why_ the state is Failed.
2. **`State: Pending` looks like success.** It is not — the function record was created, but the runtime container had not started. Only polling to `Active` confirms success.
3. **LocalStack does not surface the true cause in `create-function`.** The API returns `Pending` immediately; the `Failed` state appears seconds later with no error to the caller.
4. **`docker` CLI absent in LocalStack container is a red herring.** LocalStack talks to Docker via the Python SDK, not the CLI. `docker: executable not found` is expected and unrelated to the failure.

**Diagnostic order that worked:**
`create-function` returns `Pending` → poll state → `Failed` → fetch `StateReason` → `"Docker not available"` → test socket from inside container → `Permission denied` on `stat()` → SELinux issue confirmed.

---

## Lessons Learned

1. **`Pending` is not `Active`.** In both Phase 0 (container "Started" ≠ running) and Phase 2 (`Pending` ≠ deployed), the API acknowledgment is not the completion. Always poll until the steady-state terminal value (`Running`, `Active`).

2. **`Failed` requires a second API call to understand.** `StateReason`/`StateReasonCode` contain the diagnostic; the state itself is just a status flag.

3. **`Permission denied` on `stat()` inside a container = SELinux**, not UID mismatch. UID mismatch shows as "file exists but can't write"; SELinux shows as "cannot even access". The fix (`label=disable`) is different from the fix for UID (`--user`).

4. **Docker `--user` does not solve SELinux.** It changes file ownership but the container's SELinux confinement still applies. Both flags are needed on Fedora/RHEL. On Ubuntu or macOS, `--user` alone would have sufficed.

5. **Fedora-specific behavior — document it.** Every mount into a container needs `:z` or `security_opt: label=disable` on Fedora. This is invisible on other OSes and will bite anyone running the same project on a different distribution.

6. **A three-attempt build/deploy cycle is not a failure — it's the discovery process.** Each fix revealed the next layer. Scripting earlier would have hidden all three behind a single exit-1, losing the reasoning.

---

## Evidence Checklist

| File                        | Captures                                                      |
| --------------------------- | ------------------------------------------------------------- |
| `phase-2-build-FAILED.png`  | Build error + broken 1.6 KB zip with `Dockerfile` inside      |
| `phase-2-build-package.png` | Successful `function.zip` (4.7 MB) + `cpython-39` ABI proof   |
| `phase-2-lambda-FAILED.png` | `State: Failed` + `StateReason: "Docker not available"`       |
| `phase-2-socket-FAILED.png` | `ls: cannot access '/var/run/docker.sock': Permission denied` |
| `phase-2-socket-fixed.png`  | `srw-rw---- ... /var/run/docker.sock` after `label=disable`   |
| `phase-2-lambda-ACTIVE.png` | Poll loop ending in `✅ Function is Active`                   |

---

## Recurring Pattern — Three Instances in This Project

| Phase           | Host resource              | Container           | Fix                               |
| --------------- | -------------------------- | ------------------- | --------------------------------- |
| 0               | `localstack_data/`         | LocalStack          | `chmod 777` + `:z`                |
| 2 (build)       | `lambda/`                  | SAM build container | `--user` + `:z`                   |
| **2 (runtime)** | **`/var/run/docker.sock`** | **LocalStack**      | **`security_opt: label=disable`** |

All three are the same underlying problem: **Fedora's SELinux blocks container access to host mounts unless explicitly permitted**. This is the most transferable lesson from Phase 2 — every Docker-based project on Fedora/RHEL will encounter a version of this.
