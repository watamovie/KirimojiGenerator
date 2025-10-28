import * as THREE from 'https://unpkg.com/three@0.158.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.158.0/examples/jsm/controls/OrbitControls.js?module';
import { SVGLoader } from 'https://unpkg.com/three@0.158.0/examples/jsm/loaders/SVGLoader.js?module';
import { STLExporter } from 'https://unpkg.com/three@0.158.0/examples/jsm/exporters/STLExporter.js?module';
import { mergeGeometries } from 'https://unpkg.com/three@0.158.0/examples/jsm/utils/BufferGeometryUtils.js?module';

const fileInput = document.getElementById('svgFile');
const thicknessInput = document.getElementById('thickness');
const widthInput = document.getElementById('targetWidth');
const heightInput = document.getElementById('targetHeight');
const removeStrokesInput = document.getElementById('removeStrokes');
const colorOptionsContainer = document.getElementById('colorOptions');
const generateButton = document.getElementById('generateButton');
const downloadLink = document.getElementById('downloadLink');
const statusMessage = document.getElementById('statusMessage');

let originalSvgText = null;
let selectedColors = new Set();
let currentObjectUrl = null;
const svgLoader = new SVGLoader();
const stlExporter = new STLExporter();
const colorConverterContext = document.createElement('canvas').getContext('2d');

let renderer;
let scene;
let camera;
let controls;
let previewMesh = null;

initThree();
setupEventListeners();
updateDownloadState(false);

function initThree() {
  const container = document.getElementById('rendererContainer');
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf9fafb);

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(80, 80, 120);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.target.set(0, 0, 0);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.7);
  directionalLight1.position.set(60, 100, 80);
  scene.add(directionalLight1);

  const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
  directionalLight2.position.set(-60, -80, -60);
  scene.add(directionalLight2);

  const grid = new THREE.GridHelper(200, 20, 0x93c5fd, 0xe0f2fe);
  grid.position.y = -40;
  scene.add(grid);

  animate();

  window.addEventListener('resize', () => {
    const { clientWidth, clientHeight } = container;
    renderer.setSize(clientWidth, clientHeight);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  });
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function setupEventListeners() {
  fileInput.addEventListener('change', handleFileChange);
  generateButton.addEventListener('click', () => {
    if (!originalSvgText) return;
    generateModel().catch((error) => {
      console.error(error);
      setStatus('モデルの生成に失敗しました。SVGの内容をご確認ください。', 'error');
      generateButton.disabled = false;
    });
  });
}

async function handleFileChange(event) {
  const file = event.target.files?.[0];
  resetState();
  if (!file) {
    setStatus('SVGファイルを選択してください。');
    return;
  }
  if (!file.name.toLowerCase().endsWith('.svg')) {
    setStatus('SVGファイルを選択してください。', 'error');
    return;
  }

  try {
    setStatus('SVGを読み込んでいます…');
    const text = await file.text();
    originalSvgText = text;
    populateColorOptions(text);
    generateButton.disabled = false;
    setStatus('SVGを読み込みました。オプションを設定してモデルを生成してください。', 'success');
  } catch (error) {
    console.error(error);
    setStatus('SVGの読み込みに失敗しました。', 'error');
  }
}

function resetState() {
  originalSvgText = null;
  selectedColors = new Set();
  colorOptionsContainer.innerHTML = '<p>SVGの読み込み後に色が表示されます。</p>';
  colorOptionsContainer.classList.add('empty');
  generateButton.disabled = true;
  updateDownloadState(false);
  setStatus('');
  if (previewMesh) {
    scene.remove(previewMesh);
    previewMesh.geometry.dispose();
    previewMesh.material.dispose();
    previewMesh = null;
  }
  revokeObjectUrl();
}

function populateColorOptions(svgText) {
  const doc = parseSvg(svgText);
  if (!doc) {
    setStatus('SVGを解析できませんでした。', 'error');
    return;
  }
  const colorMap = extractFillColors(doc.documentElement);
  colorOptionsContainer.innerHTML = '';
  colorOptionsContainer.classList.toggle('empty', colorMap.size === 0);

  if (colorMap.size === 0) {
    colorOptionsContainer.innerHTML = '<p>塗り色が検出されませんでした。</p>';
    return;
  }

  const sortedColors = Array.from(colorMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  sortedColors.forEach(([color, count]) => {
    const id = `color-${color.replace(/[^a-z0-9]/gi, '')}`;
    const wrapper = document.createElement('label');
    wrapper.className = 'color-option';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.value = color;
    checkbox.addEventListener('change', (event) => {
      const checked = event.target.checked;
      if (checked) {
        selectedColors.add(color);
      } else {
        selectedColors.delete(color);
      }
    });

    const swatch = document.createElement('span');
    swatch.className = 'color-swatch';
    swatch.style.backgroundColor = color;

    const label = document.createElement('span');
    label.textContent = `${color} (${count})`;

    wrapper.appendChild(checkbox);
    wrapper.appendChild(swatch);
    wrapper.appendChild(label);
    colorOptionsContainer.appendChild(wrapper);
  });
}

async function generateModel() {
  setStatus('モデルを生成しています…');
  generateButton.disabled = true;

  const processedSvg = applySvgOptions(originalSvgText);
  const svgData = svgLoader.parse(processedSvg);
  if (!svgData.paths || svgData.paths.length === 0) {
    throw new Error('SVGに形状が含まれていません。');
  }

  const depth = Math.max(parseFloat(thicknessInput.value) || 3, 0.1);
  const geometries = [];
  const material = new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.1, roughness: 0.6 });

  svgData.paths.forEach((path) => {
    const shapes = SVGLoader.createShapes(path);
    shapes.forEach((shape) => {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: false,
      });
      geometries.push(geometry);
    });
  });

  if (geometries.length === 0) {
    throw new Error('SVGから形状を生成できませんでした。');
  }

  const combinedGeometry = mergeGeometries(geometries, true);
  geometries.forEach((geo) => geo.dispose());

  const scale = computeScale(combinedGeometry);
  combinedGeometry.scale(scale.x, scale.y, 1);

  centerGeometry(combinedGeometry);
  combinedGeometry.computeBoundingSphere();

  if (previewMesh) {
    scene.remove(previewMesh);
    previewMesh.geometry.dispose();
    previewMesh.material.dispose();
  }

  previewMesh = new THREE.Mesh(combinedGeometry, material);
  scene.add(previewMesh);

  updateCameraForGeometry(combinedGeometry);

  const stlString = stlExporter.parse(previewMesh);
  const blob = new Blob([stlString], { type: 'application/sla' });
  const objectUrl = URL.createObjectURL(blob);
  revokeObjectUrl();
  currentObjectUrl = objectUrl;
  downloadLink.href = objectUrl;
  updateDownloadState(true);

  setStatus('モデルを生成しました。プレビューを確認し、STLをダウンロードできます。', 'success');
  generateButton.disabled = false;
}

function computeScale(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const currentWidth = box.max.x - box.min.x;
  const currentHeight = box.max.y - box.min.y;

  const widthValue = parseFloat(widthInput.value);
  const heightValue = parseFloat(heightInput.value);

  let scaleX = 1;
  let scaleY = 1;

  if (widthValue > 0 && currentWidth > 0) {
    scaleX = widthValue / currentWidth;
  }
  if (heightValue > 0 && currentHeight > 0) {
    scaleY = heightValue / currentHeight;
  }

  let scale = 1;
  if (widthValue > 0 && heightValue > 0) {
    scale = Math.min(scaleX, scaleY);
  } else if (widthValue > 0) {
    scale = scaleX;
  } else if (heightValue > 0) {
    scale = scaleY;
  }

  return new THREE.Vector3(scale, scale, 1);
}

function centerGeometry(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const center = new THREE.Vector3();
  box.getCenter(center);
  geometry.translate(-center.x, -center.y, -box.min.z - (box.max.z - box.min.z) / 2);
}

function updateCameraForGeometry(geometry) {
  const boundingSphere = geometry.boundingSphere;
  if (!boundingSphere) {
    return;
  }
  const radius = Math.max(boundingSphere.radius, 1);
  const distance = radius * 3;
  camera.position.set(distance, distance, distance);
  controls.target.copy(boundingSphere.center);
  controls.update();
}

function applySvgOptions(svgText) {
  const doc = parseSvg(svgText);
  if (!doc) {
    throw new Error('SVGの解析に失敗しました。');
  }
  const svgElement = doc.documentElement;
  const colorsToRemove = new Set(Array.from(selectedColors));

  const elements = Array.from(svgElement.querySelectorAll('*'));
  const shapeTags = new Set([
    'path',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'g',
    'text',
    'use',
  ]);

  elements.forEach((element) => {
    if (removeStrokesInput.checked) {
      element.removeAttribute('stroke');
      element.removeAttribute('stroke-width');
      element.removeAttribute('stroke-linecap');
      element.removeAttribute('stroke-linejoin');
      const style = element.getAttribute('style');
      if (style) {
        const cleaned = removeStyleProperties(style, ['stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']);
        if (cleaned) {
          element.setAttribute('style', cleaned);
        } else {
          element.removeAttribute('style');
        }
      }
    }

    if (colorsToRemove.size > 0 && shapeTags.has(element.tagName.toLowerCase())) {
      const fillAttr = element.getAttribute('fill');
      const style = element.getAttribute('style');
      const styleFill = style ? extractFillFromStyle(style) : null;
      const fillColor = normalizeColor(fillAttr) || normalizeColor(styleFill);
      if (fillColor && colorsToRemove.has(fillColor)) {
        element.remove();
      }
    }
  });

  const serializer = new XMLSerializer();
  return serializer.serializeToString(svgElement);
}

function parseSvg(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    return null;
  }
  return doc;
}

function extractFillColors(svgElement) {
  const colorMap = new Map();
  const elements = Array.from(svgElement.querySelectorAll('*'));
  elements.forEach((element) => {
    const fillAttr = element.getAttribute('fill');
    const style = element.getAttribute('style');
    const styleFill = style ? extractFillFromStyle(style) : null;
    const normalized = normalizeColor(fillAttr) || normalizeColor(styleFill);
    if (normalized) {
      const count = colorMap.get(normalized) ?? 0;
      colorMap.set(normalized, count + 1);
    }
  });
  return colorMap;
}

function extractFillFromStyle(style) {
  const match = style.match(/fill\s*:\s*([^;]+)/i);
  return match ? match[1].trim() : null;
}

function removeStyleProperties(style, properties) {
  const declarations = style
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((declaration) => {
      return !properties.some((prop) => declaration.toLowerCase().startsWith(prop.toLowerCase()));
    });
  return declarations.join('; ');
}

function normalizeColor(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') return null;
  if (trimmed.startsWith('#')) {
    return normalizeHexColor(trimmed);
  }
  if (/^rgba?\(/i.test(trimmed)) {
    const rgba = trimmed
      .replace(/^rgba?\(/i, '')
      .replace(/\)$/i, '')
      .split(',')
      .map((component) => component.trim());
    if (rgba.length >= 3) {
      const [r, g, b, a] = rgba;
      if (typeof a !== 'undefined' && parseFloat(a) === 0) {
        return null;
      }
      const color = `rgb(${parseFloat(r)}, ${parseFloat(g)}, ${parseFloat(b)})`;
      return normalizeColor(color);
    }
    return null;
  }

  if (!colorConverterContext) {
    return null;
  }

  try {
    colorConverterContext.fillStyle = '#000000';
    colorConverterContext.fillStyle = trimmed;
    const computed = colorConverterContext.fillStyle;
    return normalizeHexColor(computed);
  } catch (error) {
    return null;
  }
}

function normalizeHexColor(value) {
  let hex = value.trim().toLowerCase();
  if (!hex.startsWith('#')) return null;
  if (hex.length === 4) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  if (hex.length !== 7) return null;
  return hex;
}

function revokeObjectUrl() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

function updateDownloadState(enabled) {
  if (enabled) {
    downloadLink.classList.remove('disabled');
  } else {
    downloadLink.classList.add('disabled');
    downloadLink.removeAttribute('href');
  }
}

function setStatus(message, type = '') {
  statusMessage.textContent = message;
  statusMessage.dataset.type = type;
}
