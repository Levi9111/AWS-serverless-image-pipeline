# Case Study: The Lambda Deployment Package (`function.zip`) — Concept, Construction, and Benefits

**Project:** Serverless Image Processing Pipeline
**Phase:** Phase 2 — Lambda function build & package
**Topic:** Why Lambda requires a single zip artifact, how it is built, and what engineering benefits this pattern provides
**Audience:** Developer learning AWS Lambda + Docker; useful as portfolio documentation

---

## 1. Summary

Before deploying the `image-processor` Lambda function, we spent three steps building a single file: `function.zip` (4.7 MB). A reader unfamiliar with Lambda's execution model may reasonably ask: _"Why not just upload `app.py`? Why do we need a zip? And why is it 4.7 MB for 2.5 KB of code?"_

This case study answers those questions. The short version: **AWS Lambda has no `pip`, no internet, and no persistent filesystem at runtime.** The zip is the only mechanism to ship third-party libraries (`Pillow` and its C dependencies) alongside user code. The zip is not a style choice — it is the deployment contract.

The zip must also be built **for the correct Python version** (`3.9`, matching Lambda's runtime), which is why we built it inside a `build-python3.9` container rather than on the host.

---

## 2. Background — What Lambda Actually Provides (and Doesn't)

Understanding `function.zip` requires understanding the Lambda execution model. When a Lambda function is invoked, AWS:

1. **Allocates a micro-VM** (Firecracker) — a fresh, isolated container
2. **Unpacks the deployment package** into `/var/task/`
3. **Runs the handler** using the runtime binary (e.g., `/var/lang/bin/python3.9`)
4. **Freezes or destroys** the VM after invocation (warm/cold start pattern)

What the Lambda runtime environment **provides**:

| Provided by AWS                                   | Notes                                        |
| ------------------------------------------------- | -------------------------------------------- |
| Python interpreter (`python3.9`)                  | The binary that executes `app.py`            |
| `boto3` + `botocore`                              | Pre-installed in every Python runtime        |
| Standard library (`os`, `io`, `uuid`, `datetime`) | Built into Python                            |
| Amazon Linux 2 userspace                          | glibc, `/tmp` (512 MB writable), environment |
| Network access (during invocation)                | To call AWS APIs, HTTP endpoints             |

What the Lambda runtime environment **does NOT provide**:

| Not provided                                          | Consequence                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pip`                                                 | Cannot install libraries at runtime                                              |
| Internet access for `pip`                             | Even if `pip` existed, it couldn't download anything                             |
| Third-party libraries (`Pillow`, `requests`, `numpy`) | Must be bundled in the zip                                                       |
| Persistent storage                                    | `/tmp` is ephemeral; nothing outside the package is preserved across cold starts |
| A package manager or build tools                      | No `yum`, `apt`, or `gcc` at runtime                                             |

**Implication:** Every library `app.py` imports at module level (or at handler level) must exist _inside_ the package — except for `boto3`, `botocore`, and Python stdlib.

`app.py` imports:

```python
import boto3                # ← pre-installed by Lambda, no action needed
import os                   # ← stdlib
import io                   # ← stdlib
import uuid                 # ← stdlib
from datetime import datetime  # ← stdlib
from PIL import Image       # ← NOT provided. MUST be in the zip.
```

That single import — `from PIL import Image` — is the entire reason `function.zip` is 4.7 MB instead of 2.5 KB.

---

## 3. What Is Actually Inside `function.zip`

The archive is a flat filesystem tree unpacked to `/var/task/`. Our particular zip contains three logical groups:

### 3.1 User code — 2.5 KB

```
app.py                            ← the handler function itself
```

Placed at the **root** of the archive (not inside a subfolder) because the `--handler` parameter is `app.lambda_handler`, which resolves to `app.py:lambda_handler`. If the file were nested under `src/app.py`, the handler path would need to be `src/app.lambda_handler`.

### 3.2 Pillow Python modules — ~500 KB

```
PIL/
├── Image.py
├── ImageOps.py
├── JpegImagePlugin.py
├── PngImagePlugin.py
├── ... (~250 Python modules)
└── __pycache__/*.pyc               ← precompiled bytecode
```

These are Pillow's pure-Python modules. They provide the API (`Image.open`, `Image.thumbnail`, `Image.save`).

### 3.3 Pillow compiled extensions + system libraries — ~4.2 MB

```
PIL/
├── _imaging.cpython-39-x86_64-linux-gnu.so        ← 3.1 MB
├── _imagingft.cpython-39-x86_64-linux-gnu.so      ← font rendering
├── _webp.cpython-39-x86_64-linux-gnu.so           ← WebP support
├── _imagingmath.cpython-39-x86_64-linux-gnu.so
└── ... (other .so files)

pillow.libs/
├── libjpeg-177d514f.so.62.4.0                     ← 800 KB, JPEG decoder
├── libpng16-8b7e0db9.so.16.43.0                   ← 280 KB, PNG decoder
├── libtiff-f683b479.so.6.0.2                      ← 700 KB, TIFF decoder
├── libfreetype-e3eca772.so.6.20.1                 ← 1.4 MB, font rendering
├── libharfbuzz-db277735.so.0.60850.0              ← 3.4 MB, text shaping
└── ... (other shared libraries)
```

These are **compiled C code**. Decoding a JPEG in pure Python would be prohibitively slow (seconds per image); Pillow's `.so` files use `libjpeg`'s highly optimized C decoder (milliseconds per image).

**This is the dominant contributor to the 4.7 MB size** — the C dependencies for image codecs are simply large. A Lambda with _only_ `boto3` usage would be ~5 KB; adding Pillow brings it to multiple megabytes regardless of which deployment method is used (zip, layer, or container image).

### 3.4 The `cpython-39` marker — the version contract

Every compiled extension in the zip has `cpython-39` in its filename. This is Python's ABI (Application Binary Interface) tag:

- `cpython-39` → built for CPython 3.9 → **will load on Lambda's `python3.9` runtime**
- `cpython-314` → built for CPython 3.14 → **will fail on Lambda with `Invalid ELF header`**

The marker is baked into the filename by `pip` at build time and cannot be renamed post-hoc. This is why we built the package inside `public.ecr.aws/sam/build-python3.9:latest` instead of on the Fedora host (which has Python 3.14): the container's Python version determines the ABI tag.

| Where the build runs        | Python version | ABI tag in `.so` | Works on Lambda 3.9? |
| --------------------------- | -------------- | ---------------- | -------------------- |
| Fedora host                 | 3.14           | `cpython-314`    | ❌ No                |
| `build-python3.9` container | 3.9            | `cpython-39`     | ✅ Yes               |

This is the single most common Lambda deployment mistake, and the reason we verified `cpython-39` in the zip contents as a gate before deployment.

---

## 4. How the Zip Is Constructed — Step-by-Step Mapping

The three commands that produced `function.zip`:

### 4.1 Build the dependency tree

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -v "$PWD":/var/task:z \
  public.ecr.aws/sam/build-python3.9:latest \
  pip install --no-cache-dir -r /var/task/requirements.txt -t /var/task/package
```

**Effect:** A container with Python 3.9 starts, runs `pip install Pillow==10.4.0`, and dumps the installed files into `lambda/package/` on the host. `-t` (target) overrides pip's default site-packages installation and puts everything in the specified directory.

**Result on disk:**

```
lambda/package/
├── PIL/
├── pillow.libs/
└── pillow-10.4.0.dist-info/
```

### 4.2 Add user code

```bash
cp app.py package/
```

**Effect:** `app.py` now sits alongside `PIL/` inside `package/`. If we skipped this step, the zip would contain only libraries — Lambda would fail at runtime with `Unable to import module 'app'`.

### 4.3 Archive the tree

```bash
cd package
zip -r ../function.zip .
```

**Effect:** Compresses the _contents_ of `package/` into a single `function.zip` at the lambda directory level. The `.` (current directory) is critical: it zips the _contents_, not the _folder itself_.

**Correct archive root:**

```
function.zip
├── app.py
├── PIL/
└── pillow.libs/
```

**Incorrect archive root (`.zip` of the folder):**

```
function.zip
└── package/
    ├── app.py
    ├── PIL/
    └── pillow.libs/
```

The incorrect version would fail at runtime with `Unable to import module 'app': No module named 'app'` because Lambda looks for `app.py` at the archive root.

---

## 5. The Engineering Benefits of the Zip Model

Why does Lambda use this deployment mechanism, and what does it buy you compared to alternatives (uploading individual files, pulling from a repo, running in a container)?

### 5.1 Immutable, atomic deployment artifact

The zip is a single file whose hash uniquely identifies the function version. `aws lambda update-function-code --zip-file fileb://function.zip` either fully succeeds or fully fails — there is no partial deployment state. This is the same guarantee Docker images provide for containers.

**Benefit:** Rollback is trivial — re-deploy a previous zip. Reproducibility is exact — the same zip produces the same runtime behavior. Debugging is easier — "the version that ran" is a specific, byte-identifiable artifact.

### 5.2 Language-agnostic contract

Every AWS Lambda runtime (Python, Node, Java, Go, .NET, Ruby, custom) accepts a zip. The mechanism is uniform across languages. Teams using multiple runtimes in the same project don't need language-specific deployment tools — the same `create-function --zip-file` call works for all.

### 5.3 Small and cacheable

4.7 MB is small enough to upload in seconds even on a modest connection and to cache in CI/CD pipelines. The same zip can be reused across test, staging, and production environments without re-building — a key enabler for "build once, deploy many" pipelines (Phase 6 will exploit this).

### 5.4 No runtime dependency on external services

A zip-deployed Lambda has no dependency on npm, PyPI, or Maven _at runtime_. Whatever libraries the function needs, they're bundled. This eliminates a whole class of failure modes:

- PyPI is down → no impact on runtime
- A library version gets yanked → no impact on running function
- A transitive dependency is compromised → not pulled in after deployment

The supply chain is pinned at build time.

### 5.5 Fits within Lambda's cold-start model

Cold starts unpack the zip into `/var/task/`. A 4.7 MB zip unpacks in ~50–100 ms (from a warm S3 cache). This contributes meaningfully less to cold start than the container initialization itself. Larger packages (up to 250 MB unzipped) are allowed but add latency.

**Benefit:** Encourages mindful dependency selection — you _can_ add `numpy` and `pandas`, but you see the impact on package size, which in turn correlates with cold-start latency.

### 5.6 Layers enable reuse without bloat

If the same Pillow dependency were needed by 10 Lambda functions, you could publish it once as a **Lambda Layer** and reference it from all 10 zips. Each function's zip stays small (~KB); the large binary lives in the shared layer.

This is an evolution of the zip model, not a replacement — the layer is itself a zip. Our project doesn't need layers (one function), but they become valuable as a project grows.

### 5.7 Works naturally with CI/CD

The build-and-zip process is fully scriptable (as Phase 6 will demonstrate). A GitHub Actions workflow can:

1. Spin up the `build-python3.9` container
2. `pip install` the requirements
3. `zip -r` the artifact
4. `aws lambda update-function-code` with the zip

No manual UI clicks, no language-specific toolchain, no separate "build" vs. "deploy" tools. The artifact is a file; the deploy is one API call.

---

## 6. Trade-offs and Limitations

The zip model is not universally superior. Understanding its limitations clarifies when alternatives are better.

| Limitation                                                      | Mitigation                                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **50 MB zipped / 250 MB unzipped hard limit**                   | Use Layers for shared large dependencies; use EFS for data; use container images for larger packages |
| **No system-level dependencies**                                | Bundle `.so` files with `LD_LIBRARY_PATH` setup (as Pillow does with `pillow.libs/`)                 |
| **No installed OS packages** (`git`, `ffmpeg`, `poppler-utils`) | Bundle static binaries, use a Layer with pre-built binaries, or use a container image Lambda         |
| **Rebuild required for each Python version bump**               | CI/CD (Phase 6) can rebuild automatically on runtime upgrade                                         |
| **No layered caching across invocations**                       | Lambda snapshots the unpacked zip after cold start; warm invocations skip the unpack                 |
| **Filesystem is read-only** (except `/tmp`)                     | Write caches to `/tmp`; keep source files immutable                                                  |

For projects that hit these limits (e.g., ML models >1 GB, or `ffmpeg`-based video processing), **container image Lambdas** (up to 10 GB) become the right choice. That's a Phase-4+ topic but worth knowing now.

---

## 7. Alternatives Considered

| Alternative                       | Why not for this project                                                                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Upload `app.py` alone, no zip** | Would fail at runtime: `ModuleNotFoundError: No module named 'PIL'`. Lambda has no `pip`                                                                               |
| **Lambda Layer for Pillow**       | Valid; would work. But for a single function, a zip is simpler — one artifact to build, one to deploy. Layers shine when dependencies are shared across many functions |
| **Container image Lambda**        | Also valid; useful when package >250 MB or when you need OS packages. More complex (Dockerfile, ECR, multi-stage build). Overkill for a 5 MB project                   |
| **Pip-install at runtime**        | Impossible: no `pip`, no internet                                                                                                                                      |
| **Reference packages from S3**    | Would require a custom bootstrap to download at cold start — adds latency, complexity, and a runtime dependency. The zip model exists precisely to avoid this          |

The zip model is the **right default** for small-to-medium Lambda functions. It becomes the _wrong_ choice only when you need >250 MB or OS-level packages.

---

## 8. What We Learned — Key Insights

1. **`function.zip` is the deployment contract, not a stylistic choice.** Lambda's runtime simply does not have the tools to install libraries. The zip is the only mechanism that ships them.

2. **The zip size is dominated by compiled C libraries, not by user code.** Our `app.py` is 2.5 KB; Pillow's native codecs add ~4.2 MB. This is normal and expected for any non-trivial Lambda using libraries with native components.

3. **The `cpython-39` ABI tag is a hard requirement, enforced by the filename.** A zip built on the host's Python 3.14 will _deploy successfully_ (Lambda accepts any valid zip) but fail at _invocation time_ with `Invalid ELF header`. The mismatch is only visible at runtime, which is why the container-based build is non-negotiable.

4. **The `--handler` string and the zip layout must agree.** `app.lambda_handler` requires `app.py` at the archive root with a `lambda_handler` function inside. A zip where `app.py` is nested under a subdirectory would fail with `Unable to import module 'app'`.

5. **The `pip install -t` pattern is the standard.** It cleanly separates the build output (in `package/`) from the source (in `lambda/`), keeping the source tree unpolluted with library files.

6. **The zip is a cacheable, hashable, atomic artifact.** This makes CI/CD straightforward (Phase 6 will reuse the exact same zip across stages) and rollbacks trivial (redeploy a previous zip).

7. **The zip model has well-defined limits.** 50 MB zipped / 250 MB unzipped. When those are hit, the answer is Layer or Container Image, not "make the zip smaller by hacking."

8. **`function.zip` is a convention, not a requirement.** AWS examples use `my_deployment_package.zip`, `myFunction.zip`, and `function.zip` interchangeably. What matters is what is _inside_ and where `--zip-file fileb://...` points.

---

## 9. Final Artifact — Verification Checklist

For a Lambda zip to be deployable, all of the following must be true. Our `function.zip` passed all of them:

| #   | Check                             | Command                                                            | Observed                              |
| --- | --------------------------------- | ------------------------------------------------------------------ | ------------------------------------- |
| 1   | User code present at archive root | `unzip -l function.zip \| grep ' app\.py$'`                        | `app.py` at root ✅                   |
| 2   | ABI version matches runtime       | `unzip -l function.zip \| grep cpython-39`                         | Multiple `*.cpython-39-*.so` files ✅ |
| 3   | No wrong-ABI files                | `unzip -l function.zip \| grep -E 'cpython-(31[0-9]\|[4-9][0-9])'` | No matches ✅                         |
| 4   | Reasonable size                   | `ls -lh function.zip`                                              | 4.7 MB ✅                             |
| 5   | Package dir owned by user         | `ls -ld package/`                                                  | Owned by `levi9111`, not `root` ✅    |
| 6   | No stray files                    | `unzip -l function.zip \| grep -c Dockerfile`                      | 0 ✅                                  |
| 7   | Lambda handler matches            | `--handler app.lambda_handler` with `app.py` at root               | Consistent ✅                         |

The zip satisfies the contract. **Only at this point is deployment (`create-function`) safe** — deploying a broken zip means debugging at the _invocation_ level rather than at the _build_ level, which is far harder.

---

## 10. Broader Takeaway

The `function.zip` pattern is a recurring architectural theme: **frozen, self-contained deployment artifacts**. It appears throughout cloud-native development:

| Pattern              | Artifact                 | Contract                                      |
| -------------------- | ------------------------ | --------------------------------------------- |
| AWS Lambda           | `function.zip`           | Unpacks to `/var/task/`, handler matches path |
| Docker               | Image                    | Includes OS + code + libs, runs anywhere      |
| Java `.jar` / `.war` | Fat jar                  | `java -jar app.jar` runs standalone           |
| Go binary            | Statically linked binary | Runs on any Linux                             |
| npm tarball          | `.tgz`                   | `npm install` reconstructs `node_modules`     |

Each has the same engineering benefits: **atomicity, reproducibility, traceability, offline runtime**. They differ only in what boundary the artifact assumes responsibility for:

- **Docker image** = code + libs + OS + system tools → biggest, most portable
- **Lambda zip** = code + libs → medium, portable within a runtime
- **Go binary** = code + libs (statically linked) → portable within an OS/arch family
- **`.jar`** = code + libs (in JVM) → portable within a JVM version

The choice of deployment artifact is fundamentally a choice of _how much of the environment to freeze_. `function.zip` freezes the minimum required for Lambda — user code + third-party libraries — because Lambda itself provides everything else.
