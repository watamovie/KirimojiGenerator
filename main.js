import * as THREE from "https://unpkg.com/three@0.157.0/build/three.module.js";
import { STLExporter } from "https://unpkg.com/three@0.157.0/examples/jsm/exporters/STLExporter.js";
import { SVGLoader } from "https://unpkg.com/three@0.157.0/examples/jsm/loaders/SVGLoader.js";
import { BufferGeometryUtils } from "https://unpkg.com/three@0.157.0/examples/jsm/utils/BufferGeometryUtils.js";

const form = document.getElementById("options-form");
const fileInput = document.getElementById("svg-file");
const thicknessInput = document.getElementById("thickness");
const targetSizeInput = document.getElementById("target-size");
const removeStrokeInput = document.getElementById("remove-strokes");
const removeFillCheckbox = document.getElementById("enable-fill-removal");
const removeFillColorInput = document.getElementById("remove-fill-color");
const statusElement = document.getElementById("status");
const downloadLink = document.getElementById("download-link");

let currentDownloadUrl = null;

const canvasForColor = document.createElement("canvas");
canvasForColor.width = canvasForColor.height = 1;
const colorContext = canvasForColor.getContext("2d");

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}

function normalizeColor(color) {
  if (!color || color === "none") {
    return null;
  }

  try {
    colorContext.fillStyle = "#000";
    colorContext.fillStyle = color.trim();
    return colorContext.fillStyle.toLowerCase();
  } catch (error) {
    return null;
  }
}

function parseStyleAttribute(styleAttribute) {
  if (!styleAttribute) return {};
  const declarations = styleAttribute.split(";");
  const result = {};

  for (const declaration of declarations) {
    if (!declaration.trim()) continue;
    const [property, value] = declaration.split(":");
    if (!property || value === undefined) continue;
    result[property.trim().toLowerCase()] = value.trim();
  }

  return result;
}

function stringifyStyle(styleObject) {
  return Object.entries(styleObject)
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
}

function removeStrokeAttributes(element) {
  const strokeAttributes = [
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-opacity",
    "stroke-miterlimit",
  ];

  for (const attribute of strokeAttributes) {
    if (element.hasAttribute(attribute)) {
      element.removeAttribute(attribute);
    }
  }

  if (element.hasAttribute("style")) {
    const styleObject = parseStyleAttribute(element.getAttribute("style"));
    let dirty = false;

    for (const attribute of strokeAttributes) {
      const key = attribute.toLowerCase();
      if (styleObject[key] !== undefined) {
        delete styleObject[key];
        dirty = true;
      }
    }

    if (dirty) {
      const newStyle = stringifyStyle(styleObject);
      if (newStyle) {
        element.setAttribute("style", newStyle);
      } else {
        element.removeAttribute("style");
      }
    }
  }
}

function sanitizeSvg(svgText, options) {
  const parser = new DOMParser();
  const documentFragment = parser.parseFromString(svgText, "image/svg+xml");
  const parseError = documentFragment.querySelector("parsererror");

  if (parseError) {
    throw new Error("SVGの解析に失敗しました。ファイルの形式を確認してください。");
  }

  const svgElement = documentFragment.documentElement;

  if (!svgElement || svgElement.nodeName.toLowerCase() !== "svg") {
    throw new Error("SVGファイルではないデータが指定されました。");
  }

  if (!svgElement.hasAttribute("viewBox")) {
    const width = parseFloat(svgElement.getAttribute("width"));
    const height = parseFloat(svgElement.getAttribute("height"));
    if (Number.isFinite(width) && Number.isFinite(height)) {
      svgElement.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }
  }

  if (options.removeStrokes) {
    const strokedElements = svgElement.querySelectorAll("[stroke], [style*='stroke']");
    strokedElements.forEach((element) => removeStrokeAttributes(element));
  }

  if (options.removeFill) {
    const targetColor = normalizeColor(options.removeFillColor);
    if (targetColor) {
      const elements = svgElement.querySelectorAll("*");
      elements.forEach((element) => {
        const fillAttribute = normalizeColor(element.getAttribute("fill"));
        const styleAttribute = element.hasAttribute("style")
          ? parseStyleAttribute(element.getAttribute("style"))
          : null;

        const styleFill = styleAttribute ? normalizeColor(styleAttribute.fill) : null;

        if (fillAttribute === targetColor || styleFill === targetColor) {
          element.remove();
        }
      });
    }
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(svgElement);
}

function createStlFromSvg(svgContent, { thickness, targetSize }) {
  const loader = new SVGLoader();
  const svgData = loader.parse(svgContent);
  const geometries = [];

  svgData.paths.forEach((path) => {
    const fillStyle = path.userData.style?.fill;
    if (!fillStyle || fillStyle === "none") {
      return;
    }

    const shapes = SVGLoader.createShapes(path);
    shapes.forEach((shape) => {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 1,
        bevelEnabled: false,
      });
      geometries.push(geometry);
    });
  });

  if (geometries.length === 0) {
    throw new Error("塗りつぶされた図形が存在しないため、立体を生成できません。");
  }

  const mergedGeometry = BufferGeometryUtils.mergeBufferGeometries(geometries, true);

  mergedGeometry.computeBoundingBox();
  const boundingBox = mergedGeometry.boundingBox;
  const size = new THREE.Vector3();
  boundingBox.getSize(size);

  const maxDimension = Math.max(size.x, size.y);
  if (maxDimension <= 0) {
    throw new Error("SVGのサイズを取得できませんでした。");
  }

  const scaleXY = targetSize / maxDimension;
  if (!Number.isFinite(scaleXY) || scaleXY <= 0) {
    throw new Error("最大寸法が正しくありません。");
  }

  mergedGeometry.scale(scaleXY, scaleXY, thickness);
  mergedGeometry.computeBoundingBox();
  const scaledBox = mergedGeometry.boundingBox;
  mergedGeometry.translate(-scaledBox.min.x, -scaledBox.min.y, -scaledBox.min.z);

  const exporter = new STLExporter();
  const mesh = new THREE.Mesh(mergedGeometry, new THREE.MeshStandardMaterial());
  return exporter.parse(mesh, { binary: false });
}

function validateNumericInput(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("STLを生成しています…");
  downloadLink.classList.add("hidden");

  if (currentDownloadUrl) {
    URL.revokeObjectURL(currentDownloadUrl);
    currentDownloadUrl = null;
  }

  const file = fileInput.files?.[0];
  if (!file) {
    setStatus("SVGファイルを選択してください。", true);
    return;
  }

  const thickness = validateNumericInput(thicknessInput.value, 3);
  const targetSize = validateNumericInput(targetSizeInput.value, 50);
  const removeStrokes = removeStrokeInput.checked;
  const removeFill = removeFillCheckbox.checked;
  const removeFillColor = removeFillColorInput.value;

  try {
    const svgText = await file.text();
    const sanitizedSvg = sanitizeSvg(svgText, {
      removeStrokes,
      removeFill,
      removeFillColor,
    });

    const stlString = createStlFromSvg(sanitizedSvg, {
      thickness,
      targetSize,
    });

    const blob = new Blob([stlString], { type: "model/stl" });
    currentDownloadUrl = URL.createObjectURL(blob);

    downloadLink.href = currentDownloadUrl;
    downloadLink.classList.remove("hidden");
    setStatus("STLの生成が完了しました。ダウンロードしてください。");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "STLの生成中にエラーが発生しました。", true);
  }
});

fileInput.addEventListener("change", () => {
  if (fileInput.files?.length) {
    setStatus(`${fileInput.files[0].name} を読み込みます。`);
  } else {
    setStatus("SVGファイルを選択してください。");
  }
  downloadLink.classList.add("hidden");
  if (currentDownloadUrl) {
    URL.revokeObjectURL(currentDownloadUrl);
    currentDownloadUrl = null;
  }
});
