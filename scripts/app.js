import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.161/examples/jsm/controls/OrbitControls.js';
import { STLExporter } from 'https://cdn.jsdelivr.net/npm/three@0.161/examples/jsm/exporters/STLExporter.js';
import { SVGLoader } from 'https://cdn.jsdelivr.net/npm/three@0.161/examples/jsm/loaders/SVGLoader.js';

const svgInput = document.getElementById('svgFile');
const thicknessInput = document.getElementById('thickness');
const maxSizeInput = document.getElementById('maxSize');
const removeStrokesInput = document.getElementById('removeStrokes');
const updateButton = document.getElementById('updatePreview');
const downloadButton = document.getElementById('downloadStl');
const statusLabel = document.getElementById('status');
const colorOptions = document.getElementById('colorOptions');
const colorList = document.getElementById('colorList');

let originalSvgDoc = null;
let currentMeshGroup = null;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
const viewer = document.getElementById('viewer');
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(viewer.clientWidth, viewer.clientHeight);
viewer.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(45, viewer.clientWidth / viewer.clientHeight, 0.1, 1000);
camera.position.set(80, 80, 120);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.65);
directionalLight.position.set(60, 120, 80);
scene.add(directionalLight);

const gridHelper = new THREE.GridHelper(200, 20, 0x4b6cb7, 0xadb7d4);
gridHelper.position.y = -0.01;
scene.add(gridHelper);

window.addEventListener('resize', () => {
  renderer.setSize(viewer.clientWidth, viewer.clientHeight);
  camera.aspect = viewer.clientWidth / viewer.clientHeight;
  camera.updateProjectionMatrix();
});

function setStatus(message, isError = false) {
  statusLabel.textContent = message;
  statusLabel.style.color = isError ? '#d7263d' : '#202431';
}

function clearPreview() {
  if (currentMeshGroup) {
    scene.remove(currentMeshGroup);
    currentMeshGroup.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    currentMeshGroup = null;
  }
  downloadButton.disabled = true;
}

function parseSvgColors(doc) {
  const fills = new Set();
  const elements = doc.querySelectorAll('*');
  elements.forEach((el) => {
    const fill = el.getAttribute('fill');
    if (!fill) return;
    const normalized = fill.trim().toLowerCase();
    if (!normalized || normalized === 'none' || normalized.startsWith('url(')) return;
    fills.add(normalized);
  });
  return Array.from(fills);
}

function renderColorOptions(colors) {
  colorList.innerHTML = '';
  if (!colors.length) {
    colorOptions.classList.add('hidden');
    return;
  }

  colorOptions.classList.remove('hidden');

  colors.forEach((color) => {
    const id = `color-${color.replace(/[^a-z0-9]/gi, '-')}`;
    const wrapper = document.createElement('label');
    wrapper.className = 'color-item';

    const swatch = document.createElement('span');
    swatch.className = 'color-swatch';
    swatch.style.background = color;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = color;
    checkbox.id = id;

    const text = document.createElement('span');
    text.textContent = color;

    wrapper.appendChild(checkbox);
    wrapper.appendChild(swatch);
    wrapper.appendChild(text);
    colorList.appendChild(wrapper);
  });
}

function applySvgFilters() {
  if (!originalSvgDoc) return null;

  const clone = originalSvgDoc.cloneNode(true);

  if (removeStrokesInput.checked) {
    clone.querySelectorAll('*').forEach((el) => {
      el.removeAttribute('stroke');
      el.removeAttribute('stroke-width');
      el.removeAttribute('stroke-linejoin');
      el.removeAttribute('stroke-linecap');
    });
  }

  const selectedColors = Array.from(colorList.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
  if (selectedColors.length) {
    const normalizedSet = new Set(selectedColors.map((c) => c.toLowerCase()));
    clone.querySelectorAll('*').forEach((el) => {
      const fill = el.getAttribute('fill');
      if (!fill) return;
      if (normalizedSet.has(fill.trim().toLowerCase())) {
        el.remove();
      }
    });
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(clone.documentElement);
}

function buildMeshFromSvg(svgString, thickness, maxSize) {
  const loader = new SVGLoader();
  const svgData = loader.parse(svgString);
  const group = new THREE.Group();

  svgData.paths.forEach((path) => {
    const shapes = SVGLoader.createShapes(path);
    shapes.forEach((shape) => {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: thickness,
        bevelEnabled: false,
      });

      geometry.scale(1, -1, 1);

      const meshMaterial = new THREE.MeshStandardMaterial({
        color: path.color && path.color !== 'none' ? path.color : 0xf0f3ff,
        metalness: 0.1,
        roughness: 0.65,
      });

      const mesh = new THREE.Mesh(geometry, meshMaterial);
      group.add(mesh);
    });
  });

  if (!group.children.length) {
    throw new Error('SVGから形状を抽出できませんでした。');
  }

  let boundingBox = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  boundingBox.getSize(size);

  if (maxSize && maxSize > 0) {
    const currentMax = Math.max(size.x, size.y);
    if (currentMax > 0) {
      const scale = maxSize / currentMax;
      group.children.forEach((child) => {
        child.geometry.scale(scale, scale, 1);
      });
      boundingBox = new THREE.Box3().setFromObject(group);
    }
  }

  const center = new THREE.Vector3();
  boundingBox.getCenter(center);
  const minZ = boundingBox.min.z;

  group.children.forEach((child) => {
    child.geometry.translate(-center.x, -center.y, -minZ);
  });

  group.rotation.x = -Math.PI / 2;

  return group;
}

function frameCameraOnObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = (camera.fov * Math.PI) / 180;
  let distance = maxDim / (2 * Math.tan(fov / 2));
  distance *= 1.6;

  const direction = new THREE.Vector3(1, 1, 1).normalize();
  camera.position.copy(center).addScaledVector(direction, distance);
  controls.target.copy(center);
  controls.update();
}

async function updatePreview() {
  if (!originalSvgDoc) return;
  setStatus('STL用のメッシュを生成しています...');
  clearPreview();

  try {
    const thickness = parseFloat(thicknessInput.value) || 3;
    const maxSize = parseFloat(maxSizeInput.value);

    if (thickness <= 0) {
      throw new Error('厚みは0より大きい値を指定してください。');
    }

    const processedSvg = applySvgFilters();
    if (!processedSvg) {
      throw new Error('SVGの処理に失敗しました。');
    }

    const meshGroup = buildMeshFromSvg(processedSvg, thickness, maxSize);
    currentMeshGroup = meshGroup;
    scene.add(meshGroup);
    frameCameraOnObject(meshGroup);

    downloadButton.disabled = false;
    setStatus('プレビューを更新しました。STLをダウンロードできます。');
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'プレビューの生成に失敗しました。', true);
  }
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

animate();

function downloadStl() {
  if (!currentMeshGroup) return;
  const exporter = new STLExporter();
  const stlString = exporter.parse(currentMeshGroup);
  const blob = new Blob([stlString], { type: 'application/vnd.ms-pki.stl' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'kirimoji-model.stl';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

svgInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  clearPreview();
  renderColorOptions([]);
  setStatus('');

  if (!file) {
    updateButton.disabled = true;
    return;
  }

  if (!file.name.toLowerCase().endsWith('.svg')) {
    setStatus('SVGファイルを選択してください。', true);
    updateButton.disabled = true;
    return;
  }

  try {
    const text = await file.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'image/svg+xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      throw new Error('SVGの読み込みに失敗しました。');
    }
    originalSvgDoc = doc;
    const colors = parseSvgColors(doc);
    renderColorOptions(colors);
    updateButton.disabled = false;
    setStatus('SVGを読み込みました。必要なオプションを設定してプレビューを生成してください。');
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'SVGの読み込みに失敗しました。', true);
    updateButton.disabled = true;
  }
});

updateButton.addEventListener('click', () => {
  updatePreview();
});

downloadButton.addEventListener('click', () => {
  downloadStl();
});
