/**
 * SceneManager.js
 * Handles Three.js scene setup, camera, renderer, controls, environment, and animation loop.
 */

import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { RectAreaLightUniformsLib } from 'RectAreaLightUniformsLib';
import { RectAreaLightHelper } from 'RectAreaLightHelper';
import { CSM } from 'CSM';

// We'll export scene, camera, renderer, controls so other modules can access
export let scene, camera, renderer, controls;

// Optional post-processing setup (disabled in original code)
export let composer = null;

// Environment map for PBR
export let envMap = null;

// Cascaded Shadow Maps for improved shadow quality
export let csm = null;

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

  // Initialize renderer with WebGL2
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
    alpha: false,
    stencil: false
  });
  
  // Check if WebGL2 is supported
  if (renderer.capabilities.isWebGL2) {
    console.log('Using WebGL2');
  } else {
    console.warn('WebGL2 not supported, falling back to WebGL1');
  }
  
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.useLegacyLights = false; // Use physically correct lighting (replaces physicallyCorrectLights)
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace; // Updated from outputEncoding
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

  // Initialize Cascaded Shadow Maps
  setupCSM();

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

  // Update CSM for camera position
  if (csm) {
    csm.update();
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
  
  if (csm) {
    csm.updateFrustums();
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
  // No need to call compileCubemapShader() in newer Three.js versions
  
  // Create an enhanced procedural environment with a gradient sky
  const environmentTexture = generateEnvironmentTexture();
  const envRT = pmremGenerator.fromEquirectangular(environmentTexture);
  envMap = envRT.texture;

  scene.environment = envMap;
  scene.background = envMap;
  
  environmentTexture.dispose();
  pmremGenerator.dispose(); // Properly dispose of the generator
}

function generateEnvironmentTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048; // Higher resolution for WebGL2
  canvas.height = 1024;
  const context = canvas.getContext('2d');

  // Enhanced gradient for sky - more luxurious feel
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#2c3e50'); // Darker blue at top
  gradient.addColorStop(0.3, '#4287f5'); // Mid blue
  gradient.addColorStop(0.6, '#a7c5f9'); // Light blue
  gradient.addColorStop(1, '#f5f5f5');   // Almost white at bottom
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Some subtle clouds
  context.fillStyle = 'rgba(255, 255, 255, 0.3)';
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height * 0.4;
    const radius = 30 + Math.random() * 80;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  // Add a subtle glow near horizon
  const horizonGlow = context.createRadialGradient(
    canvas.width / 2, canvas.height * 0.7, 0,
    canvas.width / 2, canvas.height * 0.7, canvas.width * 0.8
  );
  horizonGlow.addColorStop(0, 'rgba(255, 240, 220, 0.3)'); // Warm glow
  horizonGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');   // Fade out
  context.fillStyle = horizonGlow;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace; // Set proper color space
  return texture;
}

function setupPBRLighting() {
  RectAreaLightUniformsLib.init();

  // Ambient - slight reduction in intensity for more contrast
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
  scene.add(ambientLight);

  // Note: Main directional light is now managed by CSM
  // Keep other lights that aren't part of CSM

  // Enhanced fill lights - reduced shadow casting to work alongside CSM
  const fillLight1 = new THREE.PointLight(0xffffee, 0.3);
  fillLight1.position.set(-70, 80, -70);
  fillLight1.castShadow = false; // Disable shadows for fill light (CSM will handle main shadows)
  scene.add(fillLight1);

  const fillLight2 = new THREE.PointLight(0xeeeeff, 0.3);
  fillLight2.position.set(120, 60, -70);
  scene.add(fillLight2);

  // Spotlights for highlights - reduced shadow casting to work alongside CSM
  const spotLight1 = new THREE.SpotLight(0xffffff, 0.5);
  spotLight1.position.set(100, 150, 50);
  spotLight1.angle = Math.PI / 6; // Narrow beam
  spotLight1.penumbra = 0.5; // Soft edge
  spotLight1.decay = 1.5; // Physical light falloff
  spotLight1.distance = 500;
  spotLight1.castShadow = false; // Disable shadows (CSM will handle main shadows)
  
  // Optional: Adjust the spot light target
  const spotTarget1 = new THREE.Object3D();
  spotTarget1.position.set(0, 30, 0);
  scene.add(spotTarget1);
  spotLight1.target = spotTarget1;
  scene.add(spotLight1);
}

/**
 * Sets up Cascaded Shadow Maps for improved shadow quality and performance
 */
function setupCSM() {
  csm = new CSM({
    maxFar: 1000,
    cascades: 3, // Reduce from 4 to 3
    shadowMapSize: 1024, // Reduce from 2048 to 1024 for performance
    lightDirection: new THREE.Vector3(0.5, -1, -0.5).normalize(),
    camera: camera,
    parent: scene,
    lightIntensity: 0.9,
    shadowBias: -0.0005,
    mode: 'practical',
    fade: true
  });
  
  // Only apply to objects that need shadows
  csm.fade = true;
}