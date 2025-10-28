import * as THREE from 'https://unpkg.com/three@0.157.0/build/three.module.js';
import { SVGLoader } from 'https://unpkg.com/three@0.157.0/examples/jsm/loaders/SVGLoader.js';
import { STLExporter } from 'https://unpkg.com/three@0.157.0/examples/jsm/exporters/STLExporter.js';
import { mergeBufferGeometries } from 'https://unpkg.com/three@0.157.0/examples/jsm/utils/BufferGeometryUtils.js';

const fileInput = document.getElementById('svg-file');
const thicknessInput = document.getElementById('thickness');
const targetSizeInput = document.getElementById('target-size');
const removeStrokesInput = document.getElementById('remove-strokes');
const removeColorToggle = document.getElementById('remove-color-toggle');
const removeColorInput = document.getElementById('remove-color');
const colorControls = document.getElementById('color-controls');
const convertButton = document.getElementById('convert-button');
const statusElement = document.getElementById('status');
const sizeHintElement = document.getElementById('size-hint');

let originalSvgText = '';
const colorParserContext = document.createElement('canvas').getContext('2d');

removeColorToggle.addEventListener('change', () => {
  colorControls.hidden = !removeColorToggle.checked;
});

fileInput.addEventListener('change', async () => {
  resetStatus();
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    originalSvgText = '';
    convertButton.disabled = true;
    sizeHintElement.textContent = '';
    return;
  }

  convertButton.disabled = true;
  updateStatus('SVGファイルを読み込んでいます…');

  try {
    const text = await file.text();
    originalSvgText = text;
    convertButton.disabled = false;
    updateStatus('SVGを読み込みました。オプションを選択して「STLを生成」を押してください。');
    const info = analyseSvg(text);
    if (info) {
      const { width, height } = info;
      sizeHintElement.textContent = `元サイズ: 幅 ${width.toFixed(2)} × 高さ ${height.toFixed(2)} (SVG単位)`;
      targetSizeInput.placeholder = Math.max(width, height).toFixed(2);
    } else {
      sizeHintElement.textContent = '塗りつぶし図形が見つかりません。';
      targetSizeInput.placeholder = '';
    }
  } catch (error) {
    convertButton.disabled = true;
    updateStatus(`SVGの読み込みに失敗しました: ${error.message}`);
  }
});

convertButton.addEventListener('click', async () => {
  if (!originalSvgText) {
    updateStatus('先にSVGファイルを選択してください。');
    return;
  }

  const thickness = Number.parseFloat(thicknessInput.value);
  if (!Number.isFinite(thickness) || thickness <= 0) {
    updateStatus('厚みを正しく入力してください (0より大きい数値)。');
    return;
  }

  convertButton.disabled = true;
  updateStatus('STLを生成しています…');

  try {
    const sanitizedSvg = sanitizeSvg(originalSvgText, { removeStrokes: removeStrokesInput.checked });
    const loader = new SVGLoader();
    const svgData = loader.parse(sanitizedSvg);

    const excludeColor = removeColorToggle.checked ? normalizeColor(removeColorInput.value) : null;

    const { shapes, bounds } = extractShapes(svgData.paths, { excludeColor });

    if (!shapes.length) {
      throw new Error('変換可能な塗りつぶし図形が見つかりません。');
    }

    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const longest = Math.max(width, height);
    const desiredSize = Number.parseFloat(targetSizeInput.value);
    let scale = 1;
    if (Number.isFinite(desiredSize) && desiredSize > 0 && longest > 0) {
      scale = desiredSize / longest;
    }

    const extrudeSettings = {
      depth: thickness,
      bevelEnabled: false
    };

    const geometries = shapes.map((shape) => {
      const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      geometry.scale(scale, scale, 1);
      geometry.translate(-bounds.minX * scale, -bounds.minY * scale, 0);
      return geometry;
    }).filter(Boolean);

    if (!geometries.length) {
      throw new Error('ジオメトリを生成できませんでした。');
    }

    const mergedGeometry = mergeBufferGeometries(geometries, false);
    mergedGeometry.computeVertexNormals();

    const mesh = new THREE.Mesh(mergedGeometry, new THREE.MeshStandardMaterial());
    const exporter = new STLExporter();
    const stlBuffer = exporter.parse(mesh, { binary: true });
    const blob = new Blob([stlBuffer], { type: 'application/octet-stream' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const outputName = fileInput.files && fileInput.files[0] ? fileInput.files[0].name.replace(/\.svg$/i, '') : 'output';
    link.href = downloadUrl;
    link.download = `${outputName || 'output'}.stl`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);

    const resultWidth = width * scale;
    const resultHeight = height * scale;

    updateStatus([
      'STLを生成し、ダウンロードを開始しました。',
      `厚み: ${thickness.toFixed(2)} mm`,
      `出力サイズ: 幅 ${resultWidth.toFixed(2)} × 高さ ${resultHeight.toFixed(2)} (mm想定)`
    ].join('\n'));
  } catch (error) {
    console.error(error);
    updateStatus(`エラー: ${error.message}`);
  } finally {
    convertButton.disabled = !originalSvgText;
  }
});

function resetStatus() {
  statusElement.textContent = '';
}

function updateStatus(message) {
  statusElement.textContent = message;
}

function sanitizeSvg(svgText, { removeStrokes }) {
  if (!removeStrokes) {
    return svgText;
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const elements = Array.from(doc.querySelectorAll('*'));
    for (const el of elements) {
      if (el.hasAttribute('stroke')) {
        el.removeAttribute('stroke');
      }
      const style = el.getAttribute('style');
      if (style && /stroke\s*:/i.test(style)) {
        const newStyle = style
          .split(';')
          .map((segment) => segment.trim())
          .filter((segment) => segment && !segment.toLowerCase().startsWith('stroke'))
          .join('; ');
        if (newStyle) {
          el.setAttribute('style', newStyle);
        } else {
          el.removeAttribute('style');
        }
      }
    }
    return new XMLSerializer().serializeToString(doc.documentElement);
  } catch (error) {
    console.warn('ストロークの削除に失敗しました。元のSVGを使用します。', error);
    return svgText;
  }
}

function extractShapes(paths, { excludeColor } = {}) {
  const shapes = [];
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };

  for (const path of paths) {
    const style = path.userData?.style ?? {};
    const fill = style.fill;
    if (!fill || fill === 'none') {
      continue;
    }

    const normalizedFill = normalizeColor(fill);
    if (excludeColor && normalizedFill && normalizedFill === excludeColor) {
      continue;
    }

    const pathShapes = path.toShapes(true);
    for (const shape of pathShapes) {
      shapes.push(shape);
      const points = shape.getPoints(32);
      for (const point of points) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
          continue;
        }
        bounds.minX = Math.min(bounds.minX, point.x);
        bounds.minY = Math.min(bounds.minY, point.y);
        bounds.maxX = Math.max(bounds.maxX, point.x);
        bounds.maxY = Math.max(bounds.maxY, point.y);
      }
    }
  }

  if (!shapes.length) {
    bounds.minX = bounds.minY = bounds.maxX = bounds.maxY = 0;
  }

  return { shapes, bounds };
}

function normalizeColor(color) {
  if (!color || color === 'none') {
    return null;
  }
  const trimmed = color.trim();
  if (!trimmed) {
    return null;
  }
  if (!colorParserContext) {
    return trimmed.toLowerCase();
  }
  try {
    colorParserContext.fillStyle = '#000';
    colorParserContext.fillStyle = trimmed;
    return colorParserContext.fillStyle.toLowerCase();
  } catch (error) {
    console.warn('カラーの正規化に失敗しました。', color, error);
    return trimmed.toLowerCase();
  }
}

function analyseSvg(svgText) {
  try {
    const loader = new SVGLoader();
    const svgData = loader.parse(svgText);
    const { bounds, shapes } = extractShapes(svgData.paths);
    if (!shapes.length) {
      return null;
    }
    return {
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY
    };
  } catch (error) {
    console.warn('SVGの解析に失敗しました。', error);
    return null;
  }
}
