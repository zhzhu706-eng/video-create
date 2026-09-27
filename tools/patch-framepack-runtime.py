from __future__ import annotations

import pathlib
import sys

demo = pathlib.Path(sys.argv[1]).resolve()
text = demo.read_text(encoding="utf-8")
if "FRAMEPACK_HUNYUAN_PATH" not in text:
    text = text.replace('"hunyuanvideo-community/HunyuanVideo"', 'os.environ.get("FRAMEPACK_HUNYUAN_PATH", "hunyuanvideo-community/HunyuanVideo")')
    text = text.replace('"lllyasviel/flux_redux_bfl"', 'os.environ.get("FRAMEPACK_FLUX_PATH", "lllyasviel/flux_redux_bfl")')
    text = text.replace("'lllyasviel/FramePackI2V_HY'", 'os.environ.get("FRAMEPACK_I2V_PATH", "lllyasviel/FramePackI2V_HY")')
    demo.write_text(text, encoding="utf-8")
    print(f"Patched {demo}")
else:
    print(f"Already patched {demo}")
