"""Deploy the sha3.si API to Vercel over the REST API, with curl (the CLI's uploads
die on this 4G link). Pinned to Frankfurt (fra1): vercel.json "regions" alone was
ignored once, so the project setting and the deployment both name the region.

Usage (from app/):
  python -I deploy.py            deploy production
  python -I deploy.py --secrets  create CRON_SECRET, ADMIN_KEY and IP_SALT if missing
                                 (values never printed; ADMIN_KEY saved to %USERPROFILE%/keys)
Run `vercel whoami` first so the CLI token is fresh."""
import hashlib, json, os, secrets, subprocess, sys, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = "sha3si-app"
INCLUDE = ["api", "lib", "data"]
FILES = ["package.json", "package-lock.json", "vercel.json"]


def token():
    appdata = Path(os.environ["APPDATA"])
    cands = [p for p in (appdata / "xdg.data" / "com.vercel.cli" / "auth.json", appdata / "com.vercel.cli" / "Data" / "auth.json") if p.exists()]
    if not cands:
        sys.exit("no vercel credentials - run: vercel login")
    return json.loads(max(cands, key=lambda c: c.stat().st_mtime).read_text(encoding="utf-8"))["token"]


def curl(args, tok):
    r = subprocess.run(["curl", "-sS", "--retry", "20", "--retry-delay", "2", "--retry-all-errors",
                        "-H", f"Authorization: Bearer {tok}"] + args, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode("utf-8", "replace")[:300])
    return r.stdout.decode("utf-8", "replace")


def api(path, tok, method="GET", body=None, team=None):
    url = "https://api.vercel.com" + path + (("&" if "?" in path else "?") + "teamId=" + team if team else "")
    args = ["-X", method, url]
    tmp = None
    if body is not None:
        fd, tmp = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        Path(tmp).write_text(json.dumps(body), encoding="utf-8")
        args = ["-X", method, "-H", "Content-Type: application/json", "--data-binary", "@" + tmp, url]
    try:
        out = curl(args, tok)
    finally:
        if tmp:
            os.unlink(tmp)
    return json.loads(out) if out.strip() else {}


def team_id(tok):
    return next((t["id"] for t in api("/v2/teams", tok).get("teams", []) if "amranihub" in (t.get("slug") or "")), None)


def file_list():
    out = [ROOT / f for f in FILES if (ROOT / f).exists()]
    for d in INCLUDE:
        out += sorted(p for p in (ROOT / d).rglob("*") if p.is_file())
    return out


def set_secrets(tok, team):
    existing = {e["key"] for e in api(f"/v9/projects/{PROJECT}/env", tok, team=team).get("envs", [])}
    made = []
    for key in ("CRON_SECRET", "ADMIN_KEY", "IP_SALT"):
        if key in existing:
            continue
        value = secrets.token_urlsafe(32)
        r = api(f"/v10/projects/{PROJECT}/env?upsert=true", tok, "POST",
                {"key": key, "value": value, "type": "sensitive", "target": ["production", "preview"]}, team)
        if r.get("error"):
            sys.exit(f"could not set {key}: {r['error'].get('message')}")
        if key == "ADMIN_KEY":
            keys = Path(os.environ["USERPROFILE"]) / "keys"
            keys.mkdir(exist_ok=True)
            (keys / "sha3si-admin.key").write_text(value, encoding="ascii", newline="")
        made.append(key)
    print("secrets created:", made or "none (all present)")


def deploy(tok, team):
    proj = api(f"/v9/projects/{PROJECT}", tok, team=team)
    if proj.get("error"):
        created = api("/v11/projects", tok, "POST", {"name": PROJECT, "framework": None}, team)
        if created.get("error"):
            sys.exit("could not create project: " + json.dumps(created["error"]))
        print("project created")
    api(f"/v9/projects/{PROJECT}", tok, "PATCH", {"serverlessFunctionRegion": "fra1", "ssoProtection": None}, team)
    files = []
    for p in file_list():
        raw = p.read_bytes()
        sha = hashlib.sha1(raw).hexdigest()
        curl(["-X", "POST", "https://api.vercel.com/v2/files", "-H", "x-vercel-digest: " + sha,
              "-H", "Content-Type: application/octet-stream", "--data-binary", "@" + str(p)], tok)
        files.append({"file": p.relative_to(ROOT).as_posix(), "sha": sha, "size": len(raw)})
    print("uploaded", len(files), "files")
    dep = api("/v13/deployments", tok, "POST", {"name": PROJECT, "project": PROJECT, "target": "production", "files": files,
              "regions": ["fra1"], "projectSettings": {"framework": None}}, team)
    if dep.get("error"):
        sys.exit("refused: " + json.dumps(dep["error"]))
    for _ in range(90):
        time.sleep(4)
        st = api(f"/v13/deployments/{dep['id']}", tok, team=team)
        state = st.get("readyState")
        if state == "READY":
            print("READY", dep["url"], st.get("alias") or [])
            return
        if state in ("ERROR", "CANCELED"):
            sys.exit("build failed: " + str(st.get("errorMessage") or state))
    sys.exit("timed out")


if __name__ == "__main__":
    tok = token()
    team = team_id(tok)
    if "--secrets" in sys.argv:
        set_secrets(tok, team)
    else:
        deploy(tok, team)
