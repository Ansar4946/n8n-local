// One output item per downloaded picture (the old code used $input.first() and silently dropped every picture but the first)
const cfg = $('⚙️ Config').first().json;
const width = Number(cfg.image_width || 1600);
const height = Number(cfg.image_height || 900);
const quality = Number(cfg.image_jpeg_quality || 85);
const maxImages = Math.max(1, Number(cfg.max_images || 4));
const selected = $('🖼️ Select Google Image').all();
const out = [];
$input.all().forEach((item, i) => {
  const binary = item.binary;
  if (!binary || !binary.data) return; // this download failed: skip the picture, keep the others
  if (out.length >= maxImages) return;
  const sel = (selected[i] && selected[i].json) || {};
  out.push({
    json: { ...item.json, imageIndex: sel.imageIndex != null ? sel.imageIndex : i, filename: sel.filename, crop_width: width, crop_height: height, crop_quality: quality, crop_ok: true },
    binary,
    pairedItem: { item: i }
  });
});
if (!out.length) return [{ json: { crop_ok: false, crop_error: 'no downloaded picture has binary data' } }];
return out;
