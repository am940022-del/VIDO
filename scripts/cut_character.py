"""Cut the character views out of the reference sheet and remove the background.

Usage: python scripts/cut_character.py <sheet.jpg> <out_dir>
Requires: pip install "rembg[cpu]"
"""
import sys
from PIL import Image
from rembg import new_session, remove

src, out_dir = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
# Horizontal extents (in px) of each view on the 2400x1792 sheet.
views = {"front": (98, 510), "right": (565, 940), "left": (1065, 1430), "back": (1456, 1869)}
session = new_session("isnet-general-use")
for name, (x0, x1) in views.items():
    crop = im.crop((x0 - 30, 270, x1 + 30, 1670))
    cut = remove(crop, session=session, post_process_mask=True)
    cut = cut.crop(cut.getbbox())
    cut.save(f"{out_dir}/{name}.png")
    print(name, cut.size)
