/**
 * SceneManager.js
 * Handles Three.js scene setup, camera, renderer, controls, environment, and animation loop.
 */

import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { RectAreaLightUniformsLib } from 'RectAreaLightUniformsLib';
import { RectAreaLightHelper } from 'RectAreaLightHelper';

// We'll export scene, camera, renderer, controls so other modules can access
export let scene, camera, renderer, controls;

// Optional post-processing setup (disabled in original code)
export let composer = null;

// Environment map for PBR
export let envMap = null;

// We keep references to help with environment creation
let pmremGenerator = null;

// Main initialization function
export function initScene() {
  scene = new THREE.Scene();
  
  // Create a gradient background
  const bgTexture = createGradientBackground();
  scene.background = bgTexture;
  
  // Initialize camera
  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
  );
  camera.position.set(3, 180, 220);

  // Initialize renderer
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance"
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.physicallyCorrectLights = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  
  document.body.appendChild(renderer.domElement);

  // OrbitControls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 50, 0);
  controls.update();

  // Create environment map for reflections
  setupEnvironmentMap();

  // Create PBR-compatible lighting
  setupPBRLighting();

  // (Optional) Setup post-processing - disabled in the original code
  composer = null;
}

// Create the animation loop
export function animate(updateBottles) {
  requestAnimationFrame(() => animate(updateBottles));

  // Let the BottleManager update all bottle states (flying, etc.)
  if (updateBottles) {
    updateBottles();
  }

  renderer.render(scene, camera);
}

// Update on window resize
export function onWindowResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  if (composer) {
    composer.setSize(window.innerWidth, window.innerHeight);
  }
}

// --------------------------------------------
// Private helper functions
// --------------------------------------------
function createGradientBackground() {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 512;
  const context = canvas.getContext('2d');

  // Vertical gradient
  const gradient = context.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#f3e9f9');
  gradient.addColorStop(0.5, '#f0f0f6');
  gradient.addColorStop(1, '#fff9f2');

  context.fillStyle = gradient;
  context.fillRect(0, 0, 2, 512);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  return texture;
}

function setupEnvironmentMap() {
  pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileCubemapShader();

  // Create a procedural environment with a gradient sky
  const environmentTexture = generateEnvironmentTexture();
  const envRT = pmremGenerator.fromEquirectangular(environmentTexture);
  envMap = envRT.texture;

  scene.environment = envMap;
  environmentTexture.dispose();
}

function generateEnvironmentTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext('2d');

  // Gradient for sky
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#4287f5');
  gradient.addColorStop(0.5, '#a7c5f9');
  gradient.addColorStop(1, '#ffffff');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Some clouds
  context.fillStyle = 'rgba(255, 255, 255, 0.4)';
  for (let i = 0; i < 15; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height * 0.5;
    const radius = 20 + Math.random() * 60;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

function setupPBRLighting() {
  RectAreaLightUniformsLib.init();

  // Ambient
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
  scene.add(ambientLight);

  // Main directional (sun) light
  const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
  mainLight.position.set(50, 100, 50);
  mainLight.castShadow = true;
  mainLight.shadow.mapSize.width = 1024;
  mainLight.shadow.mapSize.height = 1024;
  mainLight.shadow.camera.near = 0.5;
  mainLight.shadow.camera.far = 500;
  mainLight.shadow.camera.left = -100;
  mainLight.shadow.camera.right = 100;
  mainLight.shadow.camera.top = 100;
  mainLight.shadow.camera.bottom = -100;
  scene.add(mainLight);

  // Fill lights
  const fillLight1 = new THREE.PointLight(0xffffee, 0.4);
  fillLight1.position.set(-50, 100, -50);
  scene.add(fillLight1);

  const fillLight2 = new THREE.PointLight(0xeeeeff, 0.4);
  fillLight2.position.set(100, 50, -50);
  scene.add(fillLight2);
}