"""Resume the exact model files used by FramePack through chunked HTTP ranges."""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import pathlib
import threading
import time
import urllib.parse

import requests

SPECS = (
    ("hunyuanvideo-community/HunyuanVideo", "hunyuanvideo", ("text_encoder/", "text_encoder_2/", "tokenizer/", "tokenizer_2/", "vae/")),
    ("lllyasviel/flux_redux_bfl", "flux_redux_bfl", ("feature_extractor/", "image_encoder/")),
    ("lllyasviel/FramePackI2V_HY", "FramePackI2V_HY", ("",)),
)


def remote_files(endpoint: str, repo: str, prefixes: tuple[str, ...]) -> list[dict]:
    url = f"{endpoint}/api/models/{repo}/tree/main?recursive=true&expand=true"
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    return [item for item in response.json() if item.get("type") == "file" and any(item["path"].startswith(p) for p in prefixes)]


def download_file(endpoint: str, repo: str, item: dict, root: pathlib.Path, chunk: int, report) -> pathlib.Path:
    target = root / item["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    expected = int(item["size"])
    if target.exists() and target.stat().st_size == expected:
        report(0, f"ready {repo}/{item['path']}")
        return target
    part = target.with_name(target.name + ".part")
    if part.exists() and part.stat().st_size > expected:
        part.unlink()
    quoted = urllib.parse.quote(item["path"], safe="/")
    url = f"{endpoint}/{repo}/resolve/main/{quoted}"
    session = requests.Session()
    while (part.stat().st_size if part.exists() else 0) < expected:
        start = part.stat().st_size if part.exists() else 0
        end = min(expected - 1, start + chunk - 1)
        for attempt in range(8):
            try:
                response = session.get(url, headers={"Range": f"bytes={start}-{end}"}, timeout=(30, 180), allow_redirects=True)
                if start == 0 and response.status_code == 200 and len(response.content) == expected:
                    part.write_bytes(response.content)
                    report(len(response.content), f"downloaded {repo}/{item['path']}")
                    break
                if response.status_code != 206 or len(response.content) != end - start + 1:
                    raise RuntimeError(f"unexpected response {response.status_code}, {len(response.content)} bytes")
                with part.open("ab") as handle:
                    handle.write(response.content)
                report(len(response.content), f"downloading {repo}/{item['path']}")
                break
            except Exception:
                if attempt == 7:
                    raise
                time.sleep(min(30, 2 ** attempt))
    if part.stat().st_size != expected:
        raise RuntimeError(f"size mismatch for {repo}/{item['path']}: {part.stat().st_size} != {expected}")
    os.replace(part, target)
    report(0, f"complete {repo}/{item['path']}")
    return target


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--endpoint", default="https://hf-mirror.com")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--chunk-mb", type=int, default=64)
    args = parser.parse_args()
    root = pathlib.Path(args.output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    jobs = []
    total = 0
    for repo, folder, prefixes in SPECS:
        for item in remote_files(args.endpoint.rstrip("/"), repo, prefixes):
            jobs.append((repo, item, root / folder))
            total += int(item["size"])
    existing = sum(min(int(item["size"]), ((folder / item["path"]).stat().st_size if (folder / item["path"]).exists() else ((folder / item["path"]).with_name((folder / item["path"]).name + ".part").stat().st_size if (folder / item["path"]).with_name((folder / item["path"]).name + ".part").exists() else 0))) for _, item, folder in jobs)
    lock = threading.Lock()
    progress = existing
    last = 0.0

    def report(delta: int, message: str) -> None:
        nonlocal progress, last
        with lock:
            progress += delta
            now = time.time()
            if delta == 0 or now - last >= 5:
                print(f"{progress / 2**30:.2f}/{total / 2**30:.2f} GB  {message}", flush=True)
                last = now

    print(json.dumps({"files": len(jobs), "totalGB": round(total / 2**30, 2), "output": str(root)}, ensure_ascii=False), flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = [executor.submit(download_file, args.endpoint.rstrip("/"), repo, item, folder, args.chunk_mb * 2**20, report) for repo, item, folder in jobs]
        for future in concurrent.futures.as_completed(futures):
            future.result()
    (root / "download-complete.json").write_text(json.dumps({"completedAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "totalBytes": total}, indent=2), encoding="utf-8")
    print("FramePack model download complete.", flush=True)


if __name__ == "__main__":
    main()
