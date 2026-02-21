#!/usr/bin/env python3
"""
Deploy cal-sync to Google Cloud Run without gcloud CLI.

Uses service account JWT auth, Cloud Build API, and Google REST APIs.
No external dependencies -- only Python standard library.

Usage:
    python3 scripts/deploy.py
    python3 scripts/deploy.py --image-tag v1.2.3
"""

import argparse
import base64
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
import time
import urllib.request
import urllib.error
import urllib.parse

# ---------------------------------------------------------------------------
# Configuration defaults
# ---------------------------------------------------------------------------
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_KEY_PATH = os.path.join(PROJECT_DIR, "service-account-key.json")
DEFAULT_ENV_PATH = os.path.join(PROJECT_DIR, ".env")

PROJECT_ID = "gtol-488006"
REGION = "asia-northeast1"
SERVICE_NAME = "cal-sync"
REPO_NAME = "cal-sync"

CLOUD_RUN_SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
]

# Cloud Run service settings
PORT = 8080
MEMORY = "512Mi"
MIN_INSTANCES = 0
MAX_INSTANCES = 3
TIMEOUT = "300s"

# ---------------------------------------------------------------------------
# Pure-Python RS256 JWT signing (no external dependencies)
# ---------------------------------------------------------------------------

def _b64url(data: bytes) -> str:
    """Base64url-encode without padding."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _parse_der_length(data: bytes, offset: int):
    """Parse a DER length field. Returns (length, next_offset)."""
    first = data[offset]
    if first < 0x80:
        return first, offset + 1
    num_bytes = first & 0x7F
    length = int.from_bytes(data[offset + 1 : offset + 1 + num_bytes], "big")
    return length, offset + 1 + num_bytes


def _parse_der_int(data: bytes, offset: int):
    """Parse a DER INTEGER. Returns (value, next_offset)."""
    if data[offset] != 0x02:
        raise ValueError(f"Expected INTEGER (0x02) at offset {offset}, got {data[offset]:#x}")
    offset += 1
    length, offset = _parse_der_length(data, offset)
    value = int.from_bytes(data[offset : offset + length], "big")
    return value, offset + length


def _parse_der_sequence(data: bytes, offset: int):
    """Skip a DER SEQUENCE header. Returns (content_end, content_start)."""
    if data[offset] != 0x30:
        raise ValueError(f"Expected SEQUENCE (0x30) at offset {offset}, got {data[offset]:#x}")
    offset += 1
    length, offset = _parse_der_length(data, offset)
    return offset + length, offset


def _extract_rsa_key(private_key_pem: str):
    """Extract RSA (n, d) from a PKCS#8 PEM private key."""
    lines = private_key_pem.strip().splitlines()
    b64_data = "".join(line for line in lines if not line.startswith("-----"))
    der = base64.b64decode(b64_data)

    # PKCS#8: SEQUENCE { INTEGER version, SEQUENCE AlgId, OCTET STRING { RSAPrivateKey } }
    _, pos = _parse_der_sequence(der, 0)
    _version, pos = _parse_der_int(der, pos)

    # Skip AlgorithmIdentifier SEQUENCE
    inner_end, _ = _parse_der_sequence(der, pos)
    pos = inner_end

    # OCTET STRING wrapping the RSAPrivateKey
    if der[pos] != 0x04:
        raise ValueError(f"Expected OCTET STRING (0x04) at offset {pos}, got {der[pos]:#x}")
    pos += 1
    _, pos = _parse_der_length(der, pos)

    # RSAPrivateKey SEQUENCE
    _, pos = _parse_der_sequence(der, pos)
    _, pos = _parse_der_int(der, pos)       # version
    n, pos = _parse_der_int(der, pos)       # modulus
    _e, pos = _parse_der_int(der, pos)      # publicExponent
    d, pos = _parse_der_int(der, pos)       # privateExponent

    return n, d


def _sign_rs256(message: bytes, private_key_pem: str) -> bytes:
    """
    RS256 signature (RSASSA-PKCS1-v1_5 + SHA-256).
    Pure Python -- no openssl, no PyJWT, no cryptography.
    """
    n, d = _extract_rsa_key(private_key_pem)

    digest = hashlib.sha256(message).digest()

    # DER-encoded DigestInfo for SHA-256
    digest_info = (
        b"\x30\x31"
        b"\x30\x0d"
        b"\x06\x09\x60\x86\x48\x01\x65\x03\x04\x02\x01"
        b"\x05\x00"
        b"\x04\x20"
    ) + digest

    k = (n.bit_length() + 7) // 8
    ps_len = k - len(digest_info) - 3
    if ps_len < 8:
        raise ValueError("RSA key too short for PKCS#1 v1.5 padding")

    em = b"\x00\x01" + (b"\xff" * ps_len) + b"\x00" + digest_info
    sig_int = pow(int.from_bytes(em, "big"), d, n)
    return sig_int.to_bytes(k, "big")


def _create_jwt(service_account_email: str, private_key_pem: str, scopes: list) -> str:
    """Build a signed JWT for Google OAuth2 service-account token exchange."""
    now = int(time.time())

    header = json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode()
    payload = json.dumps({
        "iss": service_account_email,
        "scope": " ".join(scopes),
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
    }, separators=(",", ":")).encode()

    signing_input = _b64url(header) + "." + _b64url(payload)
    signature = _sign_rs256(signing_input.encode("ascii"), private_key_pem)
    return signing_input + "." + _b64url(signature)


# ---------------------------------------------------------------------------
# Google API helpers
# ---------------------------------------------------------------------------

def get_access_token(key_path: str) -> str:
    """Exchange a service-account JWT for a Google OAuth2 access token."""
    with open(key_path) as f:
        sa = json.load(f)

    jwt = _create_jwt(sa["client_email"], sa["private_key"], CLOUD_RUN_SCOPES)

    data = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": jwt,
    }).encode()

    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req) as resp:
        body = json.loads(resp.read())

    print("[OK] Obtained access token")
    return body["access_token"]


def api_request(method: str, url: str, token: str, body=None,
                expected_statuses=(200,)):
    """Make an authenticated Google REST API call. Returns parsed JSON or None."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        if e.code in expected_statuses:
            raw = e.read()
            return json.loads(raw) if raw else None
        error_body = e.read().decode(errors="replace")
        print(f"[ERROR] {method} {url} -> HTTP {e.code}\n{error_body}", file=sys.stderr)
        raise


# ---------------------------------------------------------------------------
# .env file parser
# ---------------------------------------------------------------------------

def parse_env_file(env_path: str) -> dict:
    """Parse a .env file into a dict. Skips comments and blank lines."""
    env_vars = {}
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            env_vars[key] = value
    return env_vars


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def run_cmd(cmd, check=True, capture=False, **kwargs):
    """Run a command, printing it first."""
    print(f"  $ {' '.join(cmd)}")
    return subprocess.run(cmd, check=check, capture_output=capture, text=True, **kwargs)


# ---------------------------------------------------------------------------
# Cloud Build (remote build + push via API)
# ---------------------------------------------------------------------------

def _create_source_tarball() -> bytes:
    """Create an in-memory .tar.gz of the project source for Cloud Build."""
    buf = io.BytesIO()
    include = {
        "Dockerfile", "package.json", "package-lock.json",
        "tsconfig.json", "tsconfig.build.json",
    }
    include_dirs = {"src"}

    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name in include:
            full = os.path.join(PROJECT_DIR, name)
            if os.path.exists(full):
                tar.add(full, arcname=name)
        for d in include_dirs:
            full = os.path.join(PROJECT_DIR, d)
            if os.path.isdir(full):
                tar.add(full, arcname=d)

    return buf.getvalue()


def _upload_to_gcs(token: str, bucket: str, obj_name: str, data: bytes) -> None:
    """Upload bytes to GCS via JSON API."""
    url = (
        f"https://storage.googleapis.com/upload/storage/v1/b/{bucket}"
        f"/o?uploadType=media&name={urllib.parse.quote(obj_name, safe='')}"
    )
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/gzip",
    })
    with urllib.request.urlopen(req) as resp:
        resp.read()
    print(f"  Uploaded gs://{bucket}/{obj_name} ({len(data)} bytes)")


def _ensure_gcs_bucket(token: str, bucket: str) -> None:
    """Create GCS bucket if it doesn't exist."""
    check_url = f"https://storage.googleapis.com/storage/v1/b/{bucket}"
    try:
        api_request("GET", check_url, token)
        return
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise

    create_url = f"https://storage.googleapis.com/storage/v1/b?project={PROJECT_ID}"
    api_request("POST", create_url, token, {
        "name": bucket,
        "location": REGION,
    })
    print(f"  Created bucket gs://{bucket}")


def cloud_build(token: str, image_tag: str, image_latest: str) -> None:
    """Build and push Docker image using Cloud Build API."""
    print(f"\n=== Cloud Build: building {image_tag} ===")

    # 1. Create tarball
    print("  Creating source tarball ...")
    tarball = _create_source_tarball()

    # 2. Upload to GCS staging bucket
    bucket = f"{PROJECT_ID}_cloudbuild"
    _ensure_gcs_bucket(token, bucket)
    obj_name = f"source/cal-sync-{int(time.time())}.tar.gz"
    _upload_to_gcs(token, bucket, obj_name, tarball)

    # 3. Submit build
    build_body = {
        "source": {
            "storageSource": {
                "bucket": bucket,
                "object": obj_name,
            }
        },
        "steps": [
            {
                "name": "gcr.io/cloud-builders/docker",
                "args": ["build", "-t", image_tag, "-t", image_latest, "."],
            },
        ],
        "images": [image_tag, image_latest],
        "timeout": "600s",
    }

    build_url = f"https://cloudbuild.googleapis.com/v1/projects/{PROJECT_ID}/builds"
    result = api_request("POST", build_url, token, build_body)

    op_name = result.get("name", "")
    build_id = result.get("metadata", {}).get("build", {}).get("id", "unknown")
    print(f"  Build submitted: {build_id}")
    print(f"  Logs: https://console.cloud.google.com/cloud-build/builds/{build_id}?project={PROJECT_ID}")

    # 4. Poll until done
    if op_name:
        op_url = f"https://cloudbuild.googleapis.com/v1/{op_name}"
        print("  Waiting for build ...")
        for i in range(120):  # up to 10 min
            time.sleep(5)
            try:
                op = api_request("GET", op_url, token)
                if op and op.get("done"):
                    if op.get("error"):
                        print(f"  [ERROR] Build failed: {json.dumps(op['error'])}",
                              file=sys.stderr)
                        sys.exit(1)
                    print("  [OK] Build completed successfully!")
                    return
                if i > 0 and i % 12 == 0:
                    print(f"    Still building ... ({(i + 1) * 5}s)")
            except urllib.error.HTTPError:
                pass
        print("  [WARN] Build did not finish in 10 min.", file=sys.stderr)
        sys.exit(1)


# ---------------------------------------------------------------------------
# Artifact Registry
# ---------------------------------------------------------------------------

def ensure_artifact_registry_repo(token: str, region: str, repo_name: str) -> None:
    """Create the Artifact Registry Docker repository if it doesn't already exist."""
    print(f"\n=== Ensuring Artifact Registry repo: {repo_name} ===")

    get_url = (
        f"https://artifactregistry.googleapis.com/v1/"
        f"projects/{PROJECT_ID}/locations/{region}/repositories/{repo_name}"
    )

    try:
        api_request("GET", get_url, token)
        print(f"[OK] Repository '{repo_name}' already exists")
        return
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise

    create_url = (
        f"https://artifactregistry.googleapis.com/v1/"
        f"projects/{PROJECT_ID}/locations/{region}/repositories"
        f"?repositoryId={repo_name}"
    )
    result = api_request(
        "POST", create_url, token,
        {"format": "DOCKER", "description": f"Docker images for {repo_name}"},
        expected_statuses=(200, 409),
    )
    print(f"[OK] Repository '{repo_name}' create request sent")

    # Poll the long-running operation if one was returned
    if result and "name" in result and not result.get("done", False):
        op_name = result["name"]
        print(f"  Waiting for operation: {op_name}")
        for _ in range(30):
            time.sleep(2)
            op = api_request("GET",
                             f"https://artifactregistry.googleapis.com/v1/{op_name}",
                             token)
            if op and op.get("done"):
                print("  Operation completed.")
                return
        print("  [WARN] Operation did not finish in 60s -- proceeding anyway.")


# ---------------------------------------------------------------------------
# Cloud Run deployment (v2 Admin API)
# ---------------------------------------------------------------------------

def deploy_cloud_run(token: str, image_tag: str, env_vars: dict,
                     region: str, service_name: str) -> str:
    """Deploy (create or update) a Cloud Run service."""
    print(f"\n=== Deploying to Cloud Run: {service_name} ({region}) ===")

    parent = f"projects/{PROJECT_ID}/locations/{region}"
    service_resource = f"{parent}/services/{service_name}"
    services_url = f"https://run.googleapis.com/v2/{parent}/services"

    # Build env var list, skipping keys that Cloud Run manages automatically
    skip_keys = {"GOOGLE_APPLICATION_CREDENTIALS", "PORT"}
    env_list = [{"name": k, "value": v}
                for k, v in env_vars.items() if k not in skip_keys]

    service_body = {
        "launchStage": "GA",
        "template": {
            "scaling": {
                "minInstanceCount": MIN_INSTANCES,
                "maxInstanceCount": MAX_INSTANCES,
            },
            "containers": [{
                "image": image_tag,
                "ports": [{"containerPort": PORT}],
                "resources": {
                    "limits": {"memory": MEMORY, "cpu": "1"},
                },
                "env": env_list,
            }],
            "timeout": TIMEOUT,
            "serviceAccount": f"cal-sync@{PROJECT_ID}.iam.gserviceaccount.com",
        },
    }

    # Check whether the service already exists
    get_url = f"https://run.googleapis.com/v2/{service_resource}"
    existing = None
    try:
        existing = api_request("GET", get_url, token)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise

    if existing:
        print("  Service exists -- updating ...")
        result = api_request("PATCH", get_url, token, service_body)
    else:
        print("  Service does not exist -- creating ...")
        result = api_request("POST",
                             f"{services_url}?serviceId={service_name}",
                             token, service_body)

    # Poll the long-running operation returned by create/update
    if result and result.get("name") and not result.get("uri"):
        op_name = result["name"]
        if op_name.startswith("projects/") or op_name.startswith("operations/"):
            op_url = f"https://run.googleapis.com/v2/{op_name}"
            print("  Waiting for deployment ...")
            for i in range(60):
                time.sleep(5)
                try:
                    op = api_request("GET", op_url, token)
                    if op and op.get("done"):
                        if op.get("error"):
                            print(f"  [ERROR] {json.dumps(op['error'])}", file=sys.stderr)
                            sys.exit(1)
                        print("  Deployment operation completed.")
                        break
                    if i > 0 and i % 6 == 0:
                        print(f"    Still waiting ... ({(i + 1) * 5}s)")
                except urllib.error.HTTPError:
                    pass
            else:
                print("  [WARN] Deployment did not finish in 5 min.")

    # Retrieve the final service URL
    try:
        svc = api_request("GET", get_url, token)
        service_url = svc.get("uri", "(URL not available yet)")
    except Exception:
        service_url = "(could not retrieve URL)"

    print(f"\n[OK] Service deployed!")
    print(f"     URL: {service_url}")

    # Attempt to allow unauthenticated access
    _set_public_access(token, service_resource)

    return service_url


def _set_public_access(token: str, service_resource: str) -> None:
    """Allow unauthenticated (public) invocations of the Cloud Run service."""
    print("\n=== Setting IAM policy (allow unauthenticated) ===")
    url = f"https://run.googleapis.com/v2/{service_resource}:setIamPolicy"
    body = {
        "policy": {
            "bindings": [{
                "role": "roles/run.invoker",
                "members": ["allUsers"],
            }]
        }
    }
    try:
        api_request("POST", url, token, body)
        print("[OK] Service is publicly accessible")
    except urllib.error.HTTPError as e:
        print(f"[WARN] Could not set IAM policy (HTTP {e.code}). "
              f"Service may require authentication to invoke.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Deploy to Google Cloud Run (no gcloud required)")
    parser.add_argument("--key", default=DEFAULT_KEY_PATH,
                        help="Service account key JSON (default: %(default)s)")
    parser.add_argument("--env-file", default=DEFAULT_ENV_PATH,
                        help=".env file path (default: %(default)s)")
    parser.add_argument("--image-tag", default=None,
                        help="Docker image tag (default: git short SHA or 'latest')")
    parser.add_argument("--service-name", default=SERVICE_NAME,
                        help="Cloud Run service name (default: %(default)s)")
    parser.add_argument("--region", default=REGION,
                        help="GCP region (default: %(default)s)")
    parser.add_argument("--skip-build", action="store_true",
                        help="Skip Cloud Build (reuse existing image)")
    parser.add_argument("--skip-deploy", action="store_true",
                        help="Skip Cloud Run deployment")
    args = parser.parse_args()

    region = args.region
    service_name = args.service_name
    registry_host = f"{region}-docker.pkg.dev"
    image_base = f"{registry_host}/{PROJECT_ID}/{REPO_NAME}/{service_name}"

    # Determine tag (prefer git SHA, fall back to 'latest')
    if args.image_tag:
        tag = args.image_tag
    else:
        try:
            r = run_cmd(["git", "rev-parse", "--short", "HEAD"],
                        capture=True, check=False, cwd=PROJECT_DIR)
            tag = r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else "latest"
        except FileNotFoundError:
            tag = "latest"

    image_tag = f"{image_base}:{tag}"
    image_latest = f"{image_base}:latest"

    print(f"Project:   {PROJECT_ID}")
    print(f"Region:    {region}")
    print(f"Service:   {service_name}")
    print(f"Image:     {image_tag}")
    print(f"Key file:  {args.key}")
    print(f"Env file:  {args.env_file}")
    print()

    # 1. Get access token via service-account JWT
    print("=== Step 1: Obtaining access token ===")
    token = get_access_token(args.key)

    # 2. Build & push via Cloud Build
    if not args.skip_build:
        ensure_artifact_registry_repo(token, region, REPO_NAME)
        cloud_build(token, image_tag, image_latest)
    else:
        print("\n[SKIP] Cloud Build")

    # 3. Deploy to Cloud Run
    if not args.skip_deploy:
        env_vars = parse_env_file(args.env_file)
        deploy_cloud_run(token, image_tag, env_vars, region, service_name)
    else:
        print("\n[SKIP] Cloud Run deploy")

    print("\n=== All done! ===")


if __name__ == "__main__":
    main()
