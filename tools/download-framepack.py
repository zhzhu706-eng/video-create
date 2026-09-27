"""Download the official FramePack Windows package with resume support."""
import json
import pathlib
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEST = ROOT / "runtime" / "framepack_cu126_torch26.7z"
META = "https://api.github.com/repos/lllyasviel/FramePack/releases/tags/windows"

def request(url, headers=None, timeout=60):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent":"article-video-studio", **(headers or {})}), timeout=timeout)

release=json.load(request(META))
asset=next(a for a in release["assets"] if a["name"] == DEST.name)
size=asset["size"]
DEST.parent.mkdir(parents=True, exist_ok=True)
failures=0
while (DEST.stat().st_size if DEST.exists() else 0) < size:
    have=DEST.stat().st_size if DEST.exists() else 0
    headers={"Accept":"application/octet-stream"}
    if have: headers["Range"]=f"bytes={have}-"
    try:
        with request(asset["url"],headers,120) as response:
            if have and response.status != 206:
                raise RuntimeError("Server did not honor resume request")
            with DEST.open("ab" if have else "wb") as output:
                while True:
                    chunk=response.read(1024*1024)
                    if not chunk:break
                    output.write(chunk)
                    have+=len(chunk)
                    if have%(64*1024*1024)<len(chunk):print(f"{have/1024**3:.2f}/{size/1024**3:.2f} GiB",flush=True)
        failures=0
    except Exception as exc:
        print(f"Retry after: {exc}",flush=True)
        failures+=1
        if failures>=6:raise
        time.sleep(min(failures*2,10))
        continue
assert DEST.stat().st_size==size,(DEST.stat().st_size,size)
print(f"Downloaded {DEST} ({size} bytes)")
