import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { SVGLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/SVGLoader.js';
import { STLExporter } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/exporters/STLExporter.js';

const fileInput = document.getElementById('svgFile');
const thicknessInput = document.getElementById('thickness');
const targetWidthInput = document.getElementById('targetWidth');
const targetHeightInput = document.getElementById('targetHeight');
const removeStrokesInput = document.getElementById('removeStrokes');
const colorOptionsContainer = document.getElementById('colorOptions');
const updateButton = document.getElementById('updatePreview');
const downloadButton = document.getElementById('downloadStl');
const statusEl = document.getElementById('status');
const rendererContainer = document.getElementById('rendererContainer');

const svgLoader = new SVGLoader();
const exporter = new STLExporter();
let originalSvgDocument = null;
let currentObject3D = null;
let currentFileName = 'model';

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
rendererContainer.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111827);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);

const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);
const directional = new THREE.DirectionalLight(0xffffff, 0.8);
directional.position.set(200, 300, 400);
scene.add(directional);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
fillLight.position.set(-200, -150, -400);
scene.add(fillLight);

const colorContext = document.createElement('canvas').getContext('2d');

function resizeRenderer() {
  const { clientWidth, clientHeight } = rendererContainer;
  if (clientWidth === 0 || clientHeight === 0) return;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resizeRenderer);
resizeRenderer();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

function setStatus(message, type = 'info') {
  statusEl.textContent = message;
  statusEl.dataset.type = type;
}

function normalizeColor(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none' || trimmed.toLowerCase() === 'transparent') {
    return null;
  }
  if (!colorContext) {
    return trimmed.toLowerCase();
  }
  try {
    colorContext.fillStyle = trimmed;
    const normalized = colorContext.fillStyle;
    return normalized.toUpperCase();
  } catch (error) {
    return trimmed.toLowerCase();
  }
}

function collectFillColors(svgDocument) {
  const colors = new Map();
  const walker = svgDocument.createTreeWalker(svgDocument.documentElement, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (!(el instanceof Element)) continue;
    const fillAttr = el.getAttribute('fill');
    const styleFill = el.style && el.style.fill ? el.style.fill : null;
    const fills = [fillAttr, styleFill].filter(Boolean);
    if (fills.length === 0) continue;
    for (const fill of fills) {
      const normalized = normalizeColor(fill);
      if (!normalized) continue;
      if (!colors.has(normalized)) {
        colors.set(normalized, { count: 1 });
      } else {
        colors.get(normalized).count += 1;
      }
    }
  }
  return colors;
}

function renderColorOptions(colorMap) {
  colorOptionsContainer.innerHTML = '';
  if (colorMap.size === 0) {
    const empty = document.createElement('p');
    empty.textContent = '塗り色は検出されませんでした。';
    empty.className = 'note';
    colorOptionsContainer.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  colorMap.forEach((info, color) => {
    const id = `color-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
    const wrapper = document.createElement('label');
    wrapper.className = 'color-option';
    wrapper.setAttribute('for', id);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.value = color;

    const swatch = document.createElement('span');
    swatch.className = 'color-swatch';
    swatch.style.backgroundColor = color;

    const text = document.createElement('span');
    text.textContent = `${color} (${info.count})`;

    wrapper.appendChild(checkbox);
    wrapper.appendChild(swatch);
    wrapper.appendChild(text);
    fragment.appendChild(wrapper);
  });

  colorOptionsContainer.appendChild(fragment);
}

function getSelectedColors() {
  const selected = new Set();
  const checkboxes = colorOptionsContainer.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach((checkbox) => {
    if (checkbox.checked) {
      selected.add(checkbox.value);
    }
  });
  return selected;
}

function applyStrokeRemoval(svgDocument) {
  const elementsWithStroke = svgDocument.querySelectorAll('[stroke]');
  elementsWithStroke.forEach((el) => {
    el.removeAttribute('stroke');
    el.removeAttribute('stroke-width');
    el.removeAttribute('stroke-linecap');
    el.removeAttribute('stroke-linejoin');
    el.removeAttribute('stroke-miterlimit');
    if (el.style) {
      el.style.stroke = null;
    }
  });
}

function removeElementsByFill(svgDocument, colorsToRemove) {
  if (!colorsToRemove || colorsToRemove.size === 0) return;
  const walker = svgDocument.createTreeWalker(svgDocument.documentElement, NodeFilter.SHOW_ELEMENT);
  const toRemove = [];
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (!(el instanceof Element)) continue;
    const fills = [];
    const attrFill = el.getAttribute('fill');
    if (attrFill) fills.push(attrFill);
    if (el.style && el.style.fill) fills.push(el.style.fill);
    if (fills.length === 0) continue;
    const shouldRemove = fills.some((fill) => {
      const normalized = normalizeColor(fill);
      return normalized && colorsToRemove.has(normalized);
    });
    if (shouldRemove && el !== svgDocument.documentElement) {
      toRemove.push(el);
    }
  }
  toRemove.forEach((el) => {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  });
}

function cleanSvg(svgDocument) {
  const clone = svgDocument.documentElement.cloneNode(true);
  const newDoc = document.implementation.createDocument(clone.namespaceURI, 'svg', null);
  newDoc.replaceChild(clone, newDoc.documentElement);
  return newDoc;
}

function buildObjectFromSvg(svgText, thickness, targetWidth, targetHeight) {
  const svgData = svgLoader.parse(svgText);
  if (!svgData || !svgData.paths || svgData.paths.length === 0) {
    throw new Error('SVGに有効なパスが含まれていません。');
  }

  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    metalness: 0.15,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });

  svgData.paths.forEach((path) => {
    const shapes = SVGLoader.createShapes(path);
    shapes.forEach((shape) => {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: thickness,
        bevelEnabled: false,
        curveSegments: 16,
      });
      geometry.translate(0, 0, -thickness / 2);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
  });

  if (group.children.length === 0) {
    throw new Error('立体化できる図形がありませんでした。');
  }

  // 初期の反転（SVG座標系に合わせる）
  group.scale.y = -1;

  // サイズ計算とスケール調整
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  group.position.set(-center.x, -center.y, -center.z);

  const width = size.x;
  const height = size.y;
  const hasWidth = Number.isFinite(targetWidth) && targetWidth > 0;
  const hasHeight = Number.isFinite(targetHeight) && targetHeight > 0;

  let scaleFactor = 1;
  if (hasWidth && hasHeight) {
    scaleFactor = Math.min(targetWidth / width, targetHeight / height);
  } else if (hasWidth) {
    scaleFactor = targetWidth / width;
  } else if (hasHeight) {
    scaleFactor = targetHeight / height;
  }

  group.scale.set(scaleFactor, -scaleFactor, 1);
  group.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(group);
  const scaledSize = scaledBox.getSize(new THREE.Vector3());
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
  group.position.sub(scaledCenter);

  return { group, size: scaledSize };
}

function fitCameraToObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const distance = (maxDim / 2) / Math.tan(fov / 2);

  camera.position.set(center.x + distance * 0.45, center.y + distance * 0.45, center.z + distance * 1.1);
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

function clearSceneObject() {
  if (currentObject3D) {
    scene.remove(currentObject3D);
    currentObject3D.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => material.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    currentObject3D = null;
  }
}

function updateDimensionPlaceholders(size) {
  if (!size) return;
  targetWidthInput.placeholder = `${size.x.toFixed(2)}`;
  targetHeightInput.placeholder = `${size.y.toFixed(2)}`;
}

function updatePreview() {
  if (!originalSvgDocument) {
    setStatus('SVGファイルを読み込んでください。', 'warning');
    return;
  }

  setStatus('SVGを処理しています…');
  updateButton.disabled = true;
  downloadButton.disabled = true;

  requestAnimationFrame(() => {
    try {
      const svgDocClone = cleanSvg(originalSvgDocument);
      if (removeStrokesInput.checked) {
        applyStrokeRemoval(svgDocClone);
      }
      const colorsToRemove = getSelectedColors();
      removeElementsByFill(svgDocClone, colorsToRemove);

      const thickness = Number.parseFloat(thicknessInput.value) || 3;
      const targetWidth = Number.parseFloat(targetWidthInput.value);
      const targetHeight = Number.parseFloat(targetHeightInput.value);
      const svgText = new XMLSerializer().serializeToString(svgDocClone.documentElement);
      const { group, size } = buildObjectFromSvg(svgText, Math.max(0.01, thickness), targetWidth, targetHeight);

      clearSceneObject();
      currentObject3D = group;
      scene.add(group);
      fitCameraToObject(group);
      updateDimensionPlaceholders(size);

      setStatus(`プレビューを更新しました。幅 ${size.x.toFixed(2)} mm × 高さ ${size.y.toFixed(2)} mm × 厚み ${thickness.toFixed(2)} mm`);
      downloadButton.disabled = false;
    } catch (error) {
      console.error(error);
      clearSceneObject();
      setStatus(`エラー: ${error.message}`, 'error');
    } finally {
      updateButton.disabled = false;
    }
  });
}

fileInput.addEventListener('change', (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }

  if (!file.name.toLowerCase().endsWith('.svg')) {
    setStatus('SVGファイルを選択してください。', 'error');
    return;
  }

  setStatus('SVGを読み込み中…');
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = reader.result;
      const svgText = typeof text === 'string' ? text : new TextDecoder().decode(text);
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, 'image/svg+xml');
      const parserError = doc.querySelector('parsererror');
      if (parserError) {
        throw new Error('SVGの解析に失敗しました。');
      }
      originalSvgDocument = doc;
      currentFileName = file.name.replace(/\.svg$/i, '');

      const colors = collectFillColors(doc);
      renderColorOptions(colors);

      updateButton.disabled = false;
      downloadButton.disabled = true;
      setStatus('オプションを設定してプレビューを更新してください。');

      targetWidthInput.value = '';
      targetHeightInput.value = '';
      updatePreview();
    } catch (error) {
      console.error(error);
      setStatus(`エラー: ${error.message}`, 'error');
      originalSvgDocument = null;
      renderColorOptions(new Map());
      clearSceneObject();
      updateButton.disabled = true;
      downloadButton.disabled = true;
    }
  };
  reader.onerror = () => {
    console.error(reader.error);
    setStatus('SVGファイルの読み込みに失敗しました。', 'error');
  };
  reader.readAsText(file);
});

updateButton.addEventListener('click', updatePreview);

[thicknessInput, targetWidthInput, targetHeightInput, removeStrokesInput].forEach((input) => {
  input.addEventListener('change', () => {
    if (originalSvgDocument) {
      updatePreview();
    }
  });
});

colorOptionsContainer.addEventListener('change', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.type === 'checkbox') {
    if (originalSvgDocument) {
      updatePreview();
    }
  }
});

downloadButton.addEventListener('click', () => {
  if (!currentObject3D) return;
  try {
    const binaryData = exporter.parse(currentObject3D, { binary: true });
    const blob = new Blob([binaryData], { type: 'model/stl' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const thickness = Number.parseFloat(thicknessInput.value) || 3;
    anchor.href = url;
    anchor.download = `${currentFileName || 'model'}_${thickness.toFixed(1)}mm.stl`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setStatus('STLファイルをダウンロードしました。');
  } catch (error) {
    console.error(error);
    setStatus(`STLの書き出しに失敗しました: ${error.message}`, 'error');
  }
});

// 初期カメラ位置
camera.position.set(0, 0, 300);
controls.update();
