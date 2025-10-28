import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';
import { SVGLoader } from 'https://unpkg.com/three@0.161.0/examples/jsm/loaders/SVGLoader.js?module';
import { STLExporter } from 'https://unpkg.com/three@0.161.0/examples/jsm/exporters/STLExporter.js?module';
import { mergeGeometries } from 'https://unpkg.com/three@0.161.0/examples/jsm/utils/BufferGeometryUtils.js?module';

const form = document.getElementById('options-form');
const logContainer = document.getElementById('log');
const logTemplate = document.getElementById('log-entry-template');

const hiddenColorElement = document.createElement('div');
hiddenColorElement.style.display = 'none';
document.body.appendChild(hiddenColorElement);

const addLog = (message, type = 'info') => {
  const entry = logTemplate.content.firstElementChild.cloneNode(true);
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  entry.dataset.type = type;
  logContainer.prepend(entry);
};

const rgbToHex = (rgbString) => {
  const match = rgbString
    .replace(/\s+/g, '')
    .match(/^rgba?\((\d+),(\d+),(\d+)(?:,(\d+(?:\.\d+)?))?\)$/i);
  if (!match) return null;
  const [r, g, b] = match.slice(1, 4).map((value) => {
    const n = Number.parseInt(value, 10);
    return Math.max(0, Math.min(255, n));
  });
  return `#${[r, g, b]
    .map((component) => component.toString(16).padStart(2, '0'))
    .join('')}`;
};

const normalizeColor = (color) => {
  if (!color) return null;
  const trimmed = color.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === 'none') return 'none';
  hiddenColorElement.style.color = '';
  hiddenColorElement.style.color = trimmed;
  const resolved = getComputedStyle(hiddenColorElement).color;
  if (!resolved || resolved === 'rgba(0, 0, 0, 0)') {
    return trimmed.startsWith('#') ? trimmed.toLowerCase() : null;
  }
  const hex = rgbToHex(resolved);
  return hex ? hex.toLowerCase() : null;
};

const parseColorList = (value) => {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => normalizeColor(entry))
    .filter(Boolean);
};

const removeStrokeFromStyle = (style) => {
  if (!style) return null;
  const declarations = style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .filter((declaration) => !declaration.startsWith('stroke'));
  return declarations.length ? `${declarations.join(';')};` : null;
};

const getStyleObject = (style) => {
  if (!style) return {};
  return style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .reduce((acc, declaration) => {
      const [key, value] = declaration.split(':');
      if (key && value) {
        acc[key.trim()] = value.trim();
      }
      return acc;
    }, {});
};

const getFillValue = (element) => {
  const fillAttr = element.getAttribute('fill');
  const style = getStyleObject(element.getAttribute('style'));
  const fillStyle = style.fill;
  const candidate = fillStyle ?? fillAttr;
  if (!candidate || candidate.startsWith('url(')) {
    return null;
  }
  return normalizeColor(candidate);
};

const sanitizeSvg = (svgText, options) => {
  const parser = new DOMParser();
  const documentRoot = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = documentRoot.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') {
    throw new Error('正しいSVGファイルではありません。');
  }

  documentRoot.querySelectorAll('script, foreignObject').forEach((element) => {
    element.remove();
  });

  const removeFillColors = new Set(options.removeFillColors ?? []);
  const toRemove = [];
  documentRoot.querySelectorAll('*').forEach((element) => {
    if (options.removeStrokes) {
      if (element.hasAttribute('stroke')) {
        element.removeAttribute('stroke');
      }
      const cleanedStyle = removeStrokeFromStyle(element.getAttribute('style'));
      if (cleanedStyle !== null) {
        if (cleanedStyle) {
          element.setAttribute('style', cleanedStyle);
        } else {
          element.removeAttribute('style');
        }
      }
    }

    if (removeFillColors.size > 0) {
      const fillValue = getFillValue(element);
      if (fillValue && removeFillColors.has(fillValue)) {
        toRemove.push(element);
      }
    }
  });

  toRemove.forEach((element) => element.remove());

  return new XMLSerializer().serializeToString(svg);
};

const svgToStlBlob = (svgText, { thickness, targetSize }) => {
  const loader = new SVGLoader();
  const svgData = loader.parse(svgText);

  const shapes = [];
  svgData.paths.forEach((path) => {
    const fill = path.userData?.style?.fill;
    if (fill !== undefined && fill !== 'none') {
      const pathShapes = path.toShapes(true);
      shapes.push(...pathShapes);
    }
  });

  if (!shapes.length) {
    throw new Error('塗りつぶされた形状が見つかりませんでした。');
  }

  const combinedBounds = new THREE.Box2();
  combinedBounds.makeEmpty();

  shapes.forEach((shape) => {
    const box = shape.getBoundingBox(new THREE.Box2());
    combinedBounds.union(box);
  });

  const width = combinedBounds.max.x - combinedBounds.min.x;
  const height = combinedBounds.max.y - combinedBounds.min.y;
  const majorDimension = Math.max(width, height);
  const scaleXY = targetSize && majorDimension > 0 ? targetSize / majorDimension : 1;

  const geometries = shapes.map((shape) => {
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: false,
    });
    return geometry;
  });

  const merged = mergeGeometries(geometries, true);
  if (!merged) {
    throw new Error('ジオメトリの統合に失敗しました。');
  }

  merged.scale(scaleXY, -scaleXY, 1);
  merged.computeBoundingBox();
  const bbox = merged.boundingBox;
  if (bbox) {
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    merged.translate(-center.x, -center.y, -bbox.min.z);
  }

  merged.computeVertexNormals();

  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial());
  const exporter = new STLExporter();
  const arrayBuffer = exporter.parse(mesh, { binary: true });
  return new Blob([arrayBuffer], { type: 'model/stl' });
};

const handleSubmit = async (event) => {
  event.preventDefault();
  try {
    const fileInput = document.getElementById('svg-upload');
    const file = fileInput.files?.[0];
    if (!file) {
      addLog('SVGファイルを選択してください。', 'error');
      return;
    }

    const thicknessInput = document.getElementById('thickness');
    const targetSizeInput = document.getElementById('target-size');
    const removeStrokesInput = document.getElementById('remove-strokes');
    const removeFillColorsInput = document.getElementById('remove-fill-colors');

    const thickness = Number.parseFloat(thicknessInput.value);
    if (!Number.isFinite(thickness) || thickness <= 0) {
      addLog('厚みは正の数値で入力してください。', 'error');
      return;
    }

    const targetSizeValue = targetSizeInput.value.trim();
    const targetSize = targetSizeValue ? Number.parseFloat(targetSizeValue) : null;
    if (targetSize !== null && (!Number.isFinite(targetSize) || targetSize <= 0)) {
      addLog('仕上がりサイズは正の数値で入力してください。', 'error');
      return;
    }

    const removeFillColors = parseColorList(removeFillColorsInput.value);

    addLog(`${file.name} を読み込んでいます…`);
    const rawSvg = await file.text();

    addLog('SVGをサニタイズしています…');
    const sanitizedSvg = sanitizeSvg(rawSvg, {
      removeStrokes: removeStrokesInput.checked,
      removeFillColors,
    });

    addLog('STLを生成しています…');
    const stlBlob = svgToStlBlob(sanitizedSvg, {
      thickness,
      targetSize,
    });

    const suggestedName = `${file.name.replace(/\.svg$/i, '') || 'kirimoji'}.stl`;
    const downloadUrl = URL.createObjectURL(stlBlob);
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = suggestedName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);

    addLog(`STLを生成しました: ${suggestedName}`);
  } catch (error) {
    console.error(error);
    addLog(error.message || '変換中にエラーが発生しました。', 'error');
  }
};

form.addEventListener('submit', handleSubmit);
