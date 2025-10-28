import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { STLExporter } from 'https://unpkg.com/three@0.160.0/examples/jsm/exporters/STLExporter.js';
import { SVGLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/SVGLoader.js';

const fileInput = document.getElementById('svg-file');
const thicknessInput = document.getElementById('thickness');
const targetSizeInput = document.getElementById('target-size');
const removeStrokesCheckbox = document.getElementById('remove-strokes');
const colorOptionsContainer = document.getElementById('color-options');
const processButton = document.getElementById('process-button');
const downloadButton = document.getElementById('download-button');
const rendererContainer = document.getElementById('renderer');
const previewInfo = document.getElementById('preview-info');

const loader = new SVGLoader();
const exporter = new STLExporter();

const state = {
  originalSvgText: '',
  processedGroup: null,
  colorOptions: [],
  selectedColors: new Set(),
};

const normalizerElement = document.createElement('span');
normalizerElement.style.display = 'none';
document.body.appendChild(normalizerElement);

// Three.js scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf5f7fb);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
rendererContainer.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
camera.position.set(0, -120, 120);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.65);
directionalLight.position.set(120, -80, 160);
scene.add(directionalLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.45);
fillLight.position.set(-80, 120, 100);
scene.add(fillLight);

const gridHelper = new THREE.GridHelper(400, 20, 0xa0aec0, 0xe2e8f0);
gridHelper.rotation.x = Math.PI / 2;
gridHelper.position.z = 0;
scene.add(gridHelper);

directionallightFollowCamera();

function directionallightFollowCamera() {
  // Keep the key light roughly aligned with the camera to avoid dark faces.
  controls.addEventListener('change', () => {
    const offset = new THREE.Vector3().copy(camera.position).normalize().multiplyScalar(160);
    directionalLight.position.copy(offset);
  });
}

function resizeRenderer() {
  const width = rendererContainer.clientWidth || rendererContainer.offsetWidth || 400;
  const height = rendererContainer.clientHeight || rendererContainer.offsetHeight || 400;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener('resize', resizeRenderer);
resizeRenderer();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

animate();

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました。'));
    reader.readAsText(file);
  });
}

function normalizeColor(value) {
  if (!value) return null;
  normalizerElement.style.color = '';
  normalizerElement.style.color = value.trim();
  const computed = getComputedStyle(normalizerElement).color;
  if (!computed || computed === 'rgba(0, 0, 0, 0)' || computed === 'transparent') {
    return null;
  }
  return computed;
}

function extractFillValue(element) {
  const fillAttr = element.getAttribute('fill');
  if (fillAttr && fillAttr.toLowerCase() !== 'none') {
    return fillAttr;
  }

  const styleAttr = element.getAttribute('style');
  if (styleAttr) {
    const match = styleAttr.match(/fill\s*:\s*([^;]+)/i);
    if (match && match[1] && match[1].toLowerCase() !== 'none') {
      return match[1];
    }
  }

  return null;
}

function collectFillColors(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('SVGの解析に失敗しました。内容を確認してください。');
  }

  const colorMap = new Map();
  doc.querySelectorAll('*').forEach((el) => {
    const fill = extractFillValue(el);
    if (!fill) return;
    const normalized = normalizeColor(fill);
    if (!normalized) return;

    if (!colorMap.has(normalized)) {
      colorMap.set(normalized, {
        normalized,
        originals: new Set(),
        count: 0,
      });
    }
    const entry = colorMap.get(normalized);
    entry.originals.add(fill);
    entry.count += 1;
  });

  return Array.from(colorMap.values())
    .sort((a, b) => b.count - a.count)
    .map((entry) => ({
      normalized: entry.normalized,
      label: `${entry.normalized} (${entry.count})`,
      originals: Array.from(entry.originals),
    }));
}

function renderColorOptions(colors) {
  colorOptionsContainer.innerHTML = '';
  if (!colors.length) {
    const message = document.createElement('p');
    message.className = 'hint';
    message.textContent = '塗りの色は見つかりませんでした。';
    colorOptionsContainer.appendChild(message);
    state.selectedColors.clear();
    return;
  }

  colors.forEach((color, index) => {
    const optionId = `color-option-${index}`;
    const wrapper = document.createElement('label');
    wrapper.className = 'color-option';
    wrapper.setAttribute('for', optionId);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = optionId;
    checkbox.value = color.normalized;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        state.selectedColors.add(color.normalized);
      } else {
        state.selectedColors.delete(color.normalized);
      }
      processSvg();
    });

    const swatch = document.createElement('span');
    swatch.className = 'color-swatch';
    swatch.style.background = color.normalized;

    const label = document.createElement('span');
    label.textContent = color.label;

    wrapper.appendChild(checkbox);
    wrapper.appendChild(swatch);
    wrapper.appendChild(label);
    colorOptionsContainer.appendChild(wrapper);
  });
}

function stripStrokeProperties(element) {
  if (element.hasAttribute('stroke')) {
    element.removeAttribute('stroke');
  }
  if (element.hasAttribute('stroke-width')) {
    element.removeAttribute('stroke-width');
  }
  if (element.hasAttribute('stroke-linejoin')) {
    element.removeAttribute('stroke-linejoin');
  }
  if (element.hasAttribute('stroke-linecap')) {
    element.removeAttribute('stroke-linecap');
  }

  const styleAttr = element.getAttribute('style');
  if (!styleAttr) return;

  const filtered = styleAttr
    .split(';')
    .map((item) => item.trim())
    .filter((item) => item && !item.toLowerCase().startsWith('stroke'));

  if (filtered.length) {
    element.setAttribute('style', filtered.join(';'));
  } else {
    element.removeAttribute('style');
  }
}

function createProcessedSvgText(svgText) {
  if (!removeStrokesCheckbox.checked) {
    return svgText;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('SVGの解析に失敗しました。内容を確認してください。');
  }

  doc.querySelectorAll('*').forEach(stripStrokeProperties);
  const serializer = new XMLSerializer();
  return serializer.serializeToString(doc.documentElement);
}

function clearCurrentGroup() {
  if (!state.processedGroup) return;
  scene.remove(state.processedGroup);
  state.processedGroup.traverse((child) => {
    if (child.isMesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else if (child.material) {
        child.material.dispose();
      }
    }
  });
  state.processedGroup = null;
}

function focusCameraOnObject(object) {
  const boundingBox = new THREE.Box3().setFromObject(object);
  const size = boundingBox.getSize(new THREE.Vector3());
  const center = boundingBox.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fitHeightDistance = maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  const fitWidthDistance = fitHeightDistance / camera.aspect;
  const distance = Math.max(fitHeightDistance, fitWidthDistance) * 1.4;

  camera.position.set(center.x, center.y - distance, center.z + distance * 0.7);
  controls.target.copy(center);
  controls.update();
}

function updatePreviewInfo(info) {
  const { width, height, thickness, removedColors, targetSize } = info;
  const lines = [];
  if (width && height) {
    lines.push(`サイズ: 幅 ${width.toFixed(2)}mm × 高さ ${height.toFixed(2)}mm`);
  }
  if (thickness) {
    lines.push(`厚み: ${thickness.toFixed(2)}mm`);
  }
  if (targetSize) {
    lines.push(`最大サイズ指定: ${targetSize.toFixed(2)}mm`);
  }
  if (removedColors && removedColors.length) {
    lines.push(`削除した色: ${removedColors.join(', ')}`);
  }

  previewInfo.textContent = lines.length ? lines.join('\n') : 'プレビューできるモデルがありません。';
}

function generateMeshFromSvg(svgText, removalColors, thickness, targetSize) {
  const group = new THREE.Group();
  const data = loader.parse(svgText);
  const paths = data.paths || [];

  const normalizedRemovalSet = new Set(
    Array.from(removalColors).map((color) => normalizeColor(color) || color)
  );

  const extrudeSettings = {
    depth: 1,
    bevelEnabled: false,
  };

  paths.forEach((path) => {
    const fillStyle = path.userData?.style?.fill;
    const normalizedFill = normalizeColor(fillStyle);
    if (fillStyle && fillStyle.toLowerCase() !== 'none' && normalizedFill && normalizedRemovalSet.has(normalizedFill)) {
      return;
    }

    const shapes = SVGLoader.createShapes(path);
    shapes.forEach((shape) => {
      const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      const materialColor = path.color ? path.color.getStyle() : '#8fa3c8';
      const material = new THREE.MeshStandardMaterial({
        color: materialColor,
        metalness: 0.15,
        roughness: 0.65,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
  });

  if (!group.children.length) {
    throw new Error('生成できる図形がありません。塗りの色の設定を確認してください。');
  }

  const originalBox = new THREE.Box3().setFromObject(group);
  const originalSize = originalBox.getSize(new THREE.Vector3());
  const maxOriginal = Math.max(originalSize.x, originalSize.y);
  const scaleXY = targetSize > 0 && maxOriginal > 0 ? targetSize / maxOriginal : 1;

  group.scale.set(scaleXY, scaleXY, thickness);

  const finalBox = new THREE.Box3().setFromObject(group);
  const finalSize = finalBox.getSize(new THREE.Vector3());
  const center = finalBox.getCenter(new THREE.Vector3());

  group.position.set(-center.x, -center.y, -finalBox.min.z);

  return {
    group,
    dimensions: {
      width: finalSize.x,
      height: finalSize.y,
      thickness: finalSize.z,
    },
  };
}

async function processSvg() {
  if (!state.originalSvgText) {
    previewInfo.textContent = 'SVGファイルを選択してください。';
    return;
  }

  const thickness = Number.parseFloat(thicknessInput.value);
  const targetSize = Number.parseFloat(targetSizeInput.value);

  if (!Number.isFinite(thickness) || thickness <= 0) {
    previewInfo.textContent = '厚みには0より大きい値を入力してください。';
    return;
  }

  if (!Number.isFinite(targetSize) || targetSize <= 0) {
    previewInfo.textContent = '最大サイズには0より大きい値を入力してください。';
    return;
  }

  try {
    const processedSvg = createProcessedSvgText(state.originalSvgText);

    clearCurrentGroup();
    const { group, dimensions } = generateMeshFromSvg(
      processedSvg,
      state.selectedColors,
      thickness,
      targetSize
    );

    state.processedGroup = group;
    scene.add(group);
    focusCameraOnObject(group);
    updatePreviewInfo({
      ...dimensions,
      thickness,
      targetSize,
      removedColors: Array.from(state.selectedColors),
    });
    downloadButton.disabled = false;
  } catch (error) {
    clearCurrentGroup();
    previewInfo.textContent = error.message || '処理中にエラーが発生しました。';
    downloadButton.disabled = true;
  }
}

function prepareDownload() {
  if (!state.processedGroup) return;
  const binary = exporter.parse(state.processedGroup, { binary: true });
  const blob = new Blob([binary], { type: 'model/stl' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'kirimoji_model.stl';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

fileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await readFileAsText(file);
    state.originalSvgText = text;
    const colors = collectFillColors(text);
    state.colorOptions = colors;
    state.selectedColors.clear();
    renderColorOptions(colors);
    processButton.disabled = false;
    downloadButton.disabled = true;
    previewInfo.textContent = '設定を調整してプレビューしてください。';
    processSvg();
  } catch (error) {
    previewInfo.textContent = error.message || 'SVGの読み込みに失敗しました。';
    state.originalSvgText = '';
    processButton.disabled = true;
    downloadButton.disabled = true;
    colorOptionsContainer.innerHTML = '';
  }
});

thicknessInput.addEventListener('change', processSvg);
targetSizeInput.addEventListener('change', processSvg);
removeStrokesCheckbox.addEventListener('change', processSvg);
processButton.addEventListener('click', processSvg);
downloadButton.addEventListener('click', prepareDownload);

