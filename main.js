import * as THREE from 'https://unpkg.com/three@0.158.0/build/three.module.js';
import { STLExporter } from 'https://unpkg.com/three@0.158.0/examples/jsm/exporters/STLExporter.js?module';
import { SVGLoader } from 'https://unpkg.com/three@0.158.0/examples/jsm/loaders/SVGLoader.js?module';
import { BufferGeometryUtils } from 'https://unpkg.com/three@0.158.0/examples/jsm/utils/BufferGeometryUtils.js?module';

const form = document.getElementById('generator-form');
const fileInput = document.getElementById('svg-file');
const thicknessInput = document.getElementById('thickness');
const targetWidthInput = document.getElementById('target-width');
const removeStrokesInput = document.getElementById('remove-strokes');
const enableColorFilterInput = document.getElementById('enable-color-filter');
const filterColorInput = document.getElementById('filter-color');
const statusEl = document.getElementById('status');

const colorCtx = document.createElement('canvas').getContext('2d');

enableColorFilterInput.addEventListener('change', () => {
  const enabled = enableColorFilterInput.checked;
  filterColorInput.disabled = !enabled;
  if (!enabled) {
    filterColorInput.value = '#ffffff';
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearStatus();

  const file = fileInput.files?.[0];
  if (!file) {
    setStatus('SVGファイルを選択してください。', true);
    return;
  }

  const thickness = Number(thicknessInput.value);
  if (!Number.isFinite(thickness) || thickness <= 0) {
    setStatus('厚みには0より大きい数値を入力してください。', true);
    return;
  }

  const widthValue = targetWidthInput.value.trim();
  const targetWidth = widthValue ? Number(widthValue) : null;
  if (widthValue && (!Number.isFinite(targetWidth) || targetWidth <= 0)) {
    setStatus('仕上がり幅には0より大きい数値を入力してください。', true);
    return;
  }

  const removeStrokes = removeStrokesInput.checked;
  const targetColor = enableColorFilterInput.checked
    ? normalizeColor(filterColorInput.value)
    : null;

  try {
    setStatus('SVGを解析しています…');
    const svgText = await file.text();
    const processedSvg = transformSvg(svgText, { removeStrokes, targetColor });

    setStatus('3Dモデルを生成しています…');
    const geometry = await svgToExtrudedGeometry(processedSvg, {
      thickness,
      targetWidth,
    });

    if (!geometry) {
      throw new Error('図形の抽出に失敗しました。SVGに塗りつぶされた図形が含まれているか確認してください。');
    }

    const exporter = new STLExporter();
    const stlString = exporter.parse(geometry, { binary: false });
    downloadStl(stlString, file.name.replace(/\.svg$/i, '') || 'model');
    setStatus('STLファイルを生成しました。ダウンロードが開始されます。');
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : '変換中に予期しないエラーが発生しました。', true);
  }
});

function transformSvg(svgText, options) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;

  if (!svg || svg.nodeName.toLowerCase() !== 'svg') {
    throw new Error('SVGファイルの読み込みに失敗しました。');
  }

  const elements = Array.from(svg.querySelectorAll('*'));
  for (const el of elements) {
    // skip elements already removed
    if (!el.parentNode) continue;

    let styleObject = null;
    const styleAttr = el.getAttribute('style');
    if (styleAttr) {
      styleObject = parseStyle(styleAttr);
    }

    if (options.removeStrokes) {
      const strokeAttrs = [
        'stroke',
        'stroke-width',
        'stroke-linecap',
        'stroke-linejoin',
        'stroke-miterlimit',
        'stroke-dasharray',
        'stroke-dashoffset',
      ];
      for (const attr of strokeAttrs) {
        el.removeAttribute(attr);
        if (styleObject && attr in styleObject) {
          delete styleObject[attr];
        }
      }
    }

    if (options.targetColor) {
      const fillAttr = el.getAttribute('fill');
      const normalizedFill = normalizeColor(fillAttr);
      if (normalizedFill && normalizedFill !== 'none' && normalizedFill === options.targetColor) {
        el.remove();
        continue;
      }

      if (styleObject && styleObject.fill) {
        const normalizedStyleFill = normalizeColor(styleObject.fill);
        if (normalizedStyleFill && normalizedStyleFill !== 'none' && normalizedStyleFill === options.targetColor) {
          el.remove();
          continue;
        }
      }
    }

    if (styleObject) {
      const serialized = serializeStyle(styleObject);
      if (serialized) {
        el.setAttribute('style', serialized);
      } else {
        el.removeAttribute('style');
      }
    }
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(svg);
}

async function svgToExtrudedGeometry(svgText, options) {
  const loader = new SVGLoader();
  const data = loader.parse(svgText);
  const paths = data.paths ?? [];

  const allShapes = [];
  for (const path of paths) {
    const fillStyle = path.userData?.style?.fill;
    if (fillStyle === 'none') {
      continue;
    }
    const shapes = SVGLoader.createShapes(path);
    for (const shape of shapes) {
      allShapes.push(shape);
    }
  }

  if (allShapes.length === 0) {
    return null;
  }

  const baseBox = new THREE.Box2();
  baseBox.makeEmpty();
  for (const shape of allShapes) {
    const shapeBox = shape.getBoundingBox(new THREE.Box2());
    baseBox.union(shapeBox);
  }

  const originalWidth = baseBox.max.x - baseBox.min.x;
  const scaleXY = options.targetWidth && originalWidth > 0
    ? options.targetWidth / originalWidth
    : 1;

  const extrudeSettings = {
    depth: 1,
    bevelEnabled: false,
  };

  const geometries = [];
  for (const shape of allShapes) {
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometries.push(geometry);
  }

  const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
  if (!merged) {
    return null;
  }

  merged.scale(scaleXY, -scaleXY, options.thickness);

  merged.computeBoundingBox();
  const bbox = merged.boundingBox;
  if (bbox) {
    merged.translate(-bbox.min.x, -bbox.min.y, -bbox.min.z);
  }

  return merged;
}

function downloadStl(content, baseName) {
  const blob = new Blob([content], { type: 'model/stl' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${baseName || 'model'}.stl`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function parseStyle(style) {
  const declarations = style
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);

  const styleObject = {};
  for (const declaration of declarations) {
    const [property, value] = declaration.split(':');
    if (property && value) {
      styleObject[property.trim()] = value.trim();
    }
  }
  return styleObject;
}

function serializeStyle(styleObject) {
  return Object.entries(styleObject)
    .map(([key, value]) => `${key}: ${value}`)
    .join('; ');
}

function normalizeColor(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === 'none') {
    return 'none';
  }
  try {
    if (!colorCtx) {
      return trimmed.toLowerCase();
    }
    colorCtx.fillStyle = '#000000';
    colorCtx.fillStyle = trimmed;
    let normalized = colorCtx.fillStyle;
    if (typeof normalized === 'string' && normalized.startsWith('#') && normalized.length === 9) {
      normalized = normalized.slice(0, 7);
    }
    return normalized.toLowerCase();
  } catch (error) {
    return trimmed.toLowerCase();
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', Boolean(isError));
  if (isError) {
    statusEl.style.color = '#b91c1c';
  } else {
    statusEl.style.color = '#2563eb';
  }
}

function clearStatus() {
  statusEl.textContent = '';
  statusEl.classList.remove('error');
}
