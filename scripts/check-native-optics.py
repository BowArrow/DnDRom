"""Check the controlled native optics captures; does not launch a viewport."""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "artifacts/research-tools311"))
from PIL import Image, ImageChops, ImageStat

folder = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "artifacts/optics-037/release")
before = ROOT / "artifacts/optics-037/before"
def picture(base, name):
    return Image.open(base / (name + ".png")).convert("RGB")

# Fixed camera/projection in smoke-native-water.mjs. This is the area occupied
# by the delayed wall, including a small margin. Animation outside it is ignored.
roi = (460, 300, 690, 332)
hidden = picture(folder, "fog-loading").crop(roi)
added = picture(folder, "fog-tile-added").crop(roi)
revealed = picture(folder, "fog-tile-revealed").crop(roi)
hidden_delta = sum(ImageStat.Stat(ImageChops.difference(hidden, added)).mean) / 3
revealed_delta = sum(ImageStat.Stat(ImageChops.difference(added, revealed)).mean) / 3
assert hidden_delta < 3, f"Added tile showed through loading fog: {hidden_delta}"
assert revealed_delta > 15, f"Completed reveal did not uncover the tile: {revealed_delta}"

def black_horizon(base):
    image = picture(base, "below-horizon")
    return sum(1 for y in range(440,600) for x in range(image.width) if max(image.getpixel((x,y))) < 8)
black_before, black_after = black_horizon(before), black_horizon(folder)
assert black_after == 0, f"Black underwater horizon streaks remain: {black_after}"
views = json.loads((folder / "underwater.json").read_text(encoding="utf-8"))
by_name = {v["name"]: v for v in views}
for name in ("below-down", "below-up", "below-horizon"):
    assert by_name[name]["water"]["underwater"]
    assert by_name[name]["water"]["environmentTextureBytes"] == 786432
assert not by_name["above"]["water"]["underwater"]
assert not by_name["above-again"]["water"]["underwater"]
assert by_name["below-up"]["water"]["environmentCaptures"] == by_name["below-down"]["water"]["environmentCaptures"]
assert all(v["missingMaterials"] == 0 for v in views)
report = {"hiddenTileMeanPixelChange": hidden_delta, "revealedTileMeanPixelChange": revealed_delta,
          "blackHorizonPixelsBefore": black_before, "blackHorizonPixelsAfter": black_after,
          "environmentTextureBytes": 786432, "nativeOpticalViews": len(views),
          "checks": {"tileHiddenUntilReveal": True, "noBlackHorizon": True,
                     "submersionAndEmergence": True, "rotationReusesEnvironment": True,
                     "noMissingMaterials": True},
          "limitation": "Controlled fixture only; not a complex-world or minimum-hardware benchmark."}
(folder / "visual-checks.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
