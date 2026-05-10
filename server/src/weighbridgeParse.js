/**
 * 根据 OCR/识别文本解析磅单中的重量与品种（启发式，可配合前端 OCR 结果上传）。
 * 重量：取文本中出现的正数中较大者（常见为净重）；品种：按 materials 名称、编码子串匹配。
 */
export function parseWeighbridgeText(ocrText, materials) {
  if (typeof ocrText !== 'string' || !ocrText.trim()) {
    return {
      recognized: false,
      suggestedMaterialId: null,
      suggestedWeight: null,
      candidates: [],
      hint: '请传入 ocrText（磅单识别文本）；仅传 imageUrl 时无法解析重量与品种',
    };
  }
  const text = ocrText.trim();
  const nums = [];
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) nums.push(n);
  }
  const suggestedWeight =
    nums.length > 0 ? Number(Math.max(...nums).toFixed(2)) : null;

  const candidates = [];
  let suggestedMaterialId = null;
  for (const mat of materials) {
    const hitName = mat.name && text.includes(mat.name);
    const hitCode = mat.code && text.includes(mat.code);
    if (hitName || hitCode) {
      candidates.push({
        materialId: mat.id,
        code: mat.code,
        name: mat.name,
        matchBy: hitName && hitCode ? 'name+code' : hitName ? 'name' : 'code',
      });
      if (suggestedMaterialId === null) suggestedMaterialId = mat.id;
    }
  }

  return {
    recognized: Boolean(suggestedMaterialId || suggestedWeight != null),
    suggestedMaterialId,
    suggestedWeight,
    numbersFound: nums,
    candidates,
  };
}
