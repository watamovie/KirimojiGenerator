import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
import { SVGLoader } from 'https://unpkg.com/three@0.152.2/examples/jsm/loaders/SVGLoader.js';
import { STLExporter } from 'https://unpkg.com/three@0.152.2/examples/jsm/exporters/STLExporter.js';
import { mergeBufferGeometries } from 'https://unpkg.com/three@0.152.2/examples/jsm/utils/BufferGeometryUtils.js';

const svgInput = document.getElementById('svgFile');
const thicknessInput = document.getElementById('thickness');
const targetSizeInput = document.getElementById('targetSize');
const removeStrokesToggle = document.getElementById('removeStrokes');
const removeColorToggle = document.getElementById('removeColorToggle');
const colorOptions = document.getElementById('colorOptions');
const colorInput = document.getElementById('colorToRemove');
const convertButton = document.getElementById('convertBtn');
const statusElement = document.getElementById('status');

const loader = new SVGLoader();
const exporter = new STLExporter();
const tmpVector = new THREE.Vector3();
const colorCanvas = document.createElement('canvas');
const colorCtx = colorCanvas.getContext('2d');

removeColorToggle.addEventListener('change', () => {
  colorOptions.hidden = !removeColorToggle.checked;
});

convertButton.addEventListener('click', async () => {
  const file = svgInput.files?.[0];
  if (!file) {
    updateStatus('SVG ファイルを選択してください。', true);
    return;
  }

  updateStatus('変換中です…');

  try {
    const svgText = await readFile(file);
    const processedSvg = processSvg(svgText, {
      removeStrokes: removeStrokesToggle.checked,
      removeFillColor: removeColorToggle.checked,
      colorToRemove: colorInput.value
    });

    const thickness = Math.max(parseFloat(thicknessInput.value) || 0, 0.01);
    const targetSize = Math.max(parseFloat(targetSizeInput.value) || 0, 0);

    const stl = await convertSvgToStl(processedSvg, thickness, targetSize);
    downloadStl(stl, file.name.replace(/\.svg$/i, '') || 'model');
    updateStatus('STL ファイルを生成しました。');
  } catch (error) {
    console.error(error);
    updateStatus(`エラーが発生しました: ${error.message ?? error}`, true);
  }
});

function updateStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.style.color = isError ? '#dc2626' : '#1e293b';
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else if (reader.result instanceof ArrayBuffer) {
        const decoder = new TextDecoder();
        resolve(decoder.decode(reader.result));
      } else {
        reject(new Error('ファイルの読み込みに失敗しました。'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function processSvg(svgText, options) {
  const parser = new DOMParser();
  const documentFragment = parser.parseFromString(svgText, 'image/svg+xml');
  const svgElement = documentFragment.documentElement;

  if (!svgElement || svgElement.nodeName.toLowerCase() === 'parsererror') {
    throw new Error('SVG の解析に失敗しました。');
  }

  if (options.removeStrokes) {
    const strokedElements = svgElement.querySelectorAll('[stroke]');
    strokedElements.forEach((element) => {
      element.removeAttribute('stroke');
      element.style?.removeProperty?.('stroke');
    });
  }

  if (options.removeFillColor) {
    const targetColor = normalizeColor(options.colorToRemove);
    if (targetColor) {
      const candidates = svgElement.querySelectorAll('*');
      candidates.forEach((element) => {
        if (element === svgElement) {
          return;
        }
        let fill = element.getAttribute('fill');
        if ((!fill || fill === 'none') && element.style?.fill) {
          fill = element.style.fill;
        }
        if (!fill || fill === 'none') {
          return;
        }
        const elementColor = normalizeColor(fill);
        if (elementColor && elementColor === targetColor) {
          element.remove();
        }
      });
    }
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(svgElement);
}

function normalizeColor(color) {
  if (!colorCtx || !color) {
    return null;
  }
  if (color === 'none') {
    return null;
  }
  colorCtx.fillStyle = '#000000';
  colorCtx.fillStyle = color;
  const normalized = colorCtx.fillStyle;
  if (normalized === '#000000' && color.toLowerCase() !== '#000000' && color.toLowerCase() !== 'black') {
    // fillStyle keeps the previous value when the color string is invalid
    return null;
  }
  return normalized.toLowerCase();
}

async function convertSvgToStl(svgText, thickness, targetSize) {
  const svgData = loader.parse(svgText);
  if (!svgData.paths.length) {
    throw new Error('有効な図形が見つかりません。');
  }

  const shapes = [];
  for (const path of svgData.paths) {
    const shapesInPath = SVGLoader.createShapes(path);
    shapes.push(...shapesInPath);
  }

  if (!shapes.length) {
    throw new Error('シェイプの生成に失敗しました。');
  }

  let scaleFactor = 1;
  if (targetSize > 0) {
    const bbox = new THREE.Box3();
    for (const shape of shapes) {
      const geometry2d = new THREE.ShapeGeometry(shape);
      geometry2d.computeBoundingBox();
      if (geometry2d.boundingBox) {
        bbox.union(geometry2d.boundingBox);
      }
    }
    if (!bbox.isEmpty()) {
      const size = bbox.getSize(tmpVector);
      const maxDimension = Math.max(size.x, size.y);
      if (maxDimension > 0) {
        scaleFactor = targetSize / maxDimension;
      }
    }
  }

  const extrudeSettings = {
    depth: thickness,
    bevelEnabled: false
  };

  const geometries = [];
  for (const shape of shapes) {
    const scaledShape = shape.clone();
    if (scaleFactor !== 1) {
      scaledShape.scale(scaleFactor, scaleFactor);
    }
    const geometry = new THREE.ExtrudeGeometry(scaledShape, extrudeSettings);
    geometries.push(geometry);
  }

  const mergedGeometry = mergeBufferGeometries(geometries, false);
  if (!mergedGeometry) {
    throw new Error('ジオメトリの結合に失敗しました。');
  }

  const stlString = exporter.parse(mergedGeometry, { binary: false });
  return stlString;
}

function downloadStl(stlString, baseName) {
  const blob = new Blob([stlString], { type: 'application/sla' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${baseName || 'model'}.stl`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
