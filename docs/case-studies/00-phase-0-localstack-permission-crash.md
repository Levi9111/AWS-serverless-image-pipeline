# Case Study: LocalStack Container Crash on Startup (Phase 0)

**Project:** Serverless Image Processing Pipeline
**Environment:** Ubuntu/Debian Linux, Docker Engine, Docker Compose V2, LocalStack 3.0
**Date:** Phase 0 — Local environment setup
**Severity:** Blocker (halted all progress)
**Time to resolve:** ~15 minutes
**Outcome:** Resolved — LocalStack 3.0.2 running with S3, DynamoDB, and Lambda all `available`

---

## 1. Summary

During the initial setup of the local development environment, two permission-related failures occurred in sequence. The first prevented Docker from being used at all. The second — the more instructive one — allowed the LocalStack container to _start successfully according to Docker Compose_ while in reality crashing within seconds, leaving the health endpoint unreachable. The root cause was a **host–container permission mismatch on a bind-mounted volume**, compounded by **misleading status reporting** from `docker-compose up`.

---

## 2. Timeline of Events

| #   | Action                                              | Result                                                                         |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | `docker-compose up -d localstack`                   | `permission denied ... /var/run/docker.sock`                                   |
| 2   | Added user to `docker` group, applied with `newgrp` | Docker CLI functional                                                          |
| 3   | `docker-compose up -d localstack`                   | Compose reports **"Container Started"** after 18.2s                            |
| 4   | `curl localhost:4566/_localstack/health`            | `Connection refused`                                                           |
| 5   | `docker-compose ps`                                 | **Empty table** — container not listed                                         |
| 6   | `docker ps -a`                                      | Container status: **`Exited (1)`**                                             |
| 7   | `docker-compose logs localstack`                    | `mkdir: cannot create directory '/var/lib/localstack/logs': Permission denied` |
| 8   | Removed volume dir, recreated with open permissions | Container started and stayed up                                                |
| 9   | `curl .../health`                                   | All required services `available` ✅                                           |

---

## 3. Error 1 — Docker Socket Permission Denied

### Symptom

```
permission denied while trying to connect to the docker API
at unix:///var/run/docker.sock
```

### Root Cause

The Docker daemon exposes its API through a Unix socket (`/var/run/docker.sock`) owned by `root:docker` with mode `660`. A user who is not a member of the `docker` group has no write access to that socket and therefore cannot issue any Docker commands, even though the Docker CLI itself is installed correctly.

This is a **standard post-installation step on Linux** that Docker's installer intentionally leaves to the administrator, because membership in the `docker` group is effectively equivalent to root-level privileges.

### Resolution

```bash
sudo usermod -aG docker $USER   # add user to docker group
newgrp docker                   # apply group change to current shell
docker ps                       # verify
```

### Takeaway

Group membership changes only apply to **new** login sessions. `newgrp` (or a full logout/login) is required — a common source of confusion where users "fix" the problem but see no change until they reboot.

---

## 4. Error 2 — LocalStack Container Exited Immediately (The Main Case)

### 4.1 Symptom

This error was deceptive because it presented **three contradictory signals**:

| Signal                                    | What it suggested          | Reality                                    |
| ----------------------------------------- | -------------------------- | ------------------------------------------ |
| Compose output: `✔ Container ... Started` | Success                    | Container had already exited               |
| `curl` to port 4566                       | Server unreachable         | No process listening                       |
| `docker-compose ps`                       | Empty table                | Only shows _running_ containers by default |
| `docker ps -a`                            | `Exited (1) 2 minutes ago` | **The truth**                              |

### 4.2 Diagnostic Path

The key insight was recognizing that **`docker-compose ps` hides stopped containers**. Once `docker ps -a` was used, the `Exited (1)` status revealed the crash, and `docker-compose logs localstack` produced the definitive error:

```
localstack-1 | mkdir: cannot create directory '/var/lib/localstack/logs': Permission denied
```

The `mkdir` failure occurred inside LocalStack's entrypoint script, before any AWS service emulation had begun — which is why no port was ever bound and the health check was refused.

### 4.3 Root Cause Analysis

Three factors combined:

**① LocalStack 3.x changed its data directory.**
LocalStack 3.0 moved persistent state from `/tmp/localstack` (2.x) to `/var/lib/localstack`. Our volume mount targeted the new path, which is correct — but this means the container's entrypoint attempts to create a _hierarchy_ of subdirectories (`logs/`, `data/`, `cache/`, etc.) inside that path at startup.

**② A bind mount overrides the image's filesystem permissions.**
When you bind-mount a host directory (`./localstack_data`) over a container path, the **host directory's ownership and mode replace** whatever the image had configured at that location. The image's internal `chown`/`chmod` setup is invisible — the container only sees the host directory's permissions.

**③ UID/GID (and possibly SELinux) mismatch.**
The host directory `./localstack_data` was created implicitly by Docker with the host user's UID and restrictive default permissions. The process inside the container does not necessarily run as a UID with write access to that directory. Depending on the host's Docker configuration, this can be worsened by:

- **User-namespace remapping (`userns-remap`)** — container root maps to a high, unprivileged UID on the host
- **Rootless Docker** — the entire daemon runs under the user's UID with restricted capabilities
- **SELinux** (Fedora/RHEL/CentOS) — unlabeled bind mounts are denied by policy regardless of Unix permissions

The result: a `mkdir` call inside the container fails with `Permission denied`, the entrypoint script aborts, and the container exits with code 1.

### 4.4 Resolution

Two complementary fixes were applied:

**Fix A — Reset and relax the host directory permissions:**

```bash
docker-compose down
sudo rm -rf localstack_data      # remove dir with wrong ownership
mkdir -p localstack_data
chmod 777 localstack_data        # accept any container UID — safe for local dev only
```

**Fix B (if SELinux is enforcing) — relabel the mount:**

```yaml
volumes:
  - "./localstack_data:/var/lib/localstack:z"
```

The `:z` flag instructs Docker to apply an SELinux label allowing container access.

**Alternative fix (offered and often preferable) — switch to a Docker named volume:**

```yaml
volumes:
  - "localstack_data:/var/lib/localstack"

volumes:
  localstack_data:
```

Named volumes are managed by Docker, initialized from the image's content **including ownership metadata**, and therefore sidestep host filesystem permission and SELinux issues entirely. This is generally the more robust choice for services that expect to own their data directory.

### 4.5 Verification

```bash
curl http://localhost:4566/_localstack/health
```

Returned `"s3": "available"`, `"dynamodb": "available"`, `"lambda": "available"` — confirming the container remained alive past initialization.

---

## 5. Contributing Factor — The Obsolete `version` Attribute

Docker Compose emitted this warning on every invocation:

```
WARN the attribute `version` is obsolete, it will be ignored
```

This was **not** related to the crash. In Compose V2, the `version:` key is deprecated and ignored; including it is harmless but noisy. It was removed from `docker-compose.yml` for cleanliness. The lesson here is prioritization: benign warnings can distract from real failures, so it helps to know which warnings are cosmetic before chasing them.

---

## 6. Lessons Learned

1. **"Started" ≠ "Running."** `docker-compose up` reports that a container was _created and launched_, not that the process inside it is still alive. Always confirm with `docker ps` or a health check before treating a service as available.

2. **`docker-compose ps` hides stopped containers.** It lists running containers by default. `docker ps -a` is the correct tool when a service appears missing.

3. **Logs are the ground truth.** In both errors, the actual cause (`usermod` needed; `mkdir` denied) was visible only in the logs — the CLI output was either silent (empty `ps` table) or actively misleading (`✔ Started`).

4. **Bind mounts transfer permission problems into containers.** A container's filesystem is only as permissioned as the host directory it's mounted over. When a containerized service needs to own its data directory, **named volumes are safer than bind mounts** — Docker initializes them with correct ownership from the image.

5. **Know your platform's security layer.** On Linux, permission failures involving containers usually stem from one of three layers: the Docker socket group, UID mapping (including rootless/userns-remap), or SELinux/AppArmor. The `:z` flag exists precisely for the third layer.

6. **Pinned image versions pay off.** Using `localstack/localstack:3.0` rather than `:latest` meant the behavior documented here (the `/var/lib/localstack` path) matched the version we were debugging against. Unpinned tags turn permission debugging into guesswork across changing release notes.

---

## 7. Prevention Checklist

For any future Docker-based local environment:

- [ ] Add the user to the `docker` group **immediately after installing Docker**, then `newgrp docker`.
- [ ] Prefer **named volumes** over bind mounts for stateful services (databases, emulators, caches).
- [ ] If a bind mount is required, pre-create the directory and `chmod 777` it (local dev) or match the container's UID explicitly.
- [ ] On SELinux hosts, append `:z` to bind-mount volume declarations.
- [ ] After `docker-compose up -d`, always verify with **both** `docker ps` and an application-level health check before proceeding.
- [ ] When a container is unexpectedly unreachable, diagnose in this order: `docker ps -a` → `docker-compose logs <service>` → `lsof -i :<port>`.
- [ ] Pin image tags (`:3.0`, not `:latest`) and remove obsolete Compose keys such as `version:`.

---
