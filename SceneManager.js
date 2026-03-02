/**
 * SceneManager.js
 * Handles Three.js scene setup, camera, renderer, controls, environment, and animation loop.
 */

import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { RectAreaLightUniformsLib } from 'RectAreaLightUniformsLib';
import { CSM } from 'CSM';

// We'll export scene, camera, renderer, controls so other modules can access
export let scene, camera, renderer, controls;

// Environment map for PBR
export let envMap = null;

// Cascaded Shadow Maps for improved shadow quality
export let csm = null;

// Weather condition for background
let weatherCondition = null;

// PMREMGenerator kept alive for weather updates
let pmremGenerator = null;

// --- Named Constants ---
const BG_CANVAS_WIDTH = 2;
const BG_CANVAS_HEIGHT = 512;
const ENV_CANVAS_WIDTH = 2048;
const ENV_CANVAS_HEIGHT = 1024;
const CAMERA_INITIAL_POSITION = [3, 180, 220];
const CONTROLS_TARGET = [0, 50, 0];

// --- Weather gradient data (data-driven replacement for switch statements) ---
const WEATHER_BG_GRADIENTS = {
  'clear':        [[0, '#3a7bd5'], [0.5, '#93b7e7'], [1, '#f5f7fa']],
  'clouds':       [[0, '#757F9A'], [0.5, '#9EADC8'], [1, '#D7DDE8']],
  'rain':         [[0, '#4B6CB7'], [0.5, '#6D83AB'], [1, '#8A9EAF']],
  'drizzle':      [[0, '#4B6CB7'], [0.5, '#6D83AB'], [1, '#8A9EAF']],
  'thunderstorm': [[0, '#293036'], [0.5, '#4A545D'], [1, '#6D767F']],
  'snow':         [[0, '#C9D6FF'], [0.5, '#E2E9F0'], [1, '#FFFFFF']],
  'mist':         [[0, '#ABB8CD'], [0.5, '#C5D0DB'], [1, '#E0E5EB']],
  'fog':          [[0, '#ABB8CD'], [0.5, '#C5D0DB'], [1, '#E0E5EB']],
  'haze':         [[0, '#ABB8CD'], [0.5, '#C5D0DB'], [1, '#E0E5EB']],
  '_default':     [[0, '#f3e9f9'], [0.5, '#f0f0f6'], [1, '#fff9f2']],
};

const WEATHER_ENV_GRADIENTS = {
  'clear':        [[0, '#1e3c72'], [0.3, '#2a5298'], [0.6, '#79a7ff'], [1, '#f5f7fa']],
  'clouds':       [[0, '#4B6584'], [0.3, '#627A97'], [0.6, '#A1BBCE'], [1, '#D9E2EC']],
  'rain':         [[0, '#3A506B'], [0.3, '#5D7793'], [0.6, '#7D92A9'], [1, '#A5B5C5']],
  'drizzle':      [[0, '#3A506B'], [0.3, '#5D7793'], [0.6, '#7D92A9'], [1, '#A5B5C5']],
  'thunderstorm': [[0, '#16222A'], [0.3, '#33444F'], [0.6, '#4D646F'], [1, '#7B8C96']],
  'snow':         [[0, '#8C9EFF'], [0.3, '#A5BFF9'], [0.6, '#D4E0F0'], [1, '#ffffff']],
  'mist':         [[0, '#8B9CAB'], [0.3, '#A1B6C7'], [0.6, '#C8D6E0'], [1, '#E0E8F0']],
  'fog':          [[0, '#8B9CAB'], [0.3, '#A1B6C7'], [0.6, '#C8D6E0'], [1, '#E0E8F0']],
  'haze':         [[0, '#8B9CAB'], [0.3, '#A1B6C7'], [0.6, '#C8D6E0'], [1, '#E0E8F0']],
  '_default':     [[0, '#2c3e50'], [0.3, '#4287f5'], [0.6, '#a7c5f9'], [1, '#f5f5f5']],
};

// Main initialization function
export async function initScene() {
  scene = new THREE.Scene();

  // Try to fetch weather data first
  try {
    const response = await fetch('/api/weather');
    if (response.ok) {
      const weatherData = await response.json();
      weatherCondition = weatherData.condition;
      console.log('Current weather:', weatherData);

      // Update weather display in UI
      updateWeatherDisplay(weatherData);
    }
  } catch (err) {
    console.warn('Failed to fetch weather data:', err);
  }

  // Create a gradient background based on weather
  const bgTexture = createGradientBackground(weatherCondition);
  scene.background = bgTexture;

  // Initialize camera
  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
  );
  camera.position.set(...CAMERA_INITIAL_POSITION);

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
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace; // Updated from outputEncoding
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  document.body.appendChild(renderer.domElement);

  // OrbitControls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...CONTROLS_TARGET);
  controls.update();

  // Create environment map for reflections
  setupEnvironmentMap();

  // Create PBR-compatible lighting
  setupPBRLighting();

  // Initialize Cascaded Shadow Maps
  setupCSM();
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

  if (csm) {
    csm.updateFrustums();
  }
}

// Update scene based on new weather condition
export function updateSceneWeather(newWeatherCondition) {
  if (weatherCondition === newWeatherCondition) {
    return; // No change needed
  }

  weatherCondition = newWeatherCondition;

  // Update the background texture
  const bgTexture = createGradientBackground(weatherCondition);
  scene.background = bgTexture;

  // Update the environment map if pmremGenerator is available
  if (pmremGenerator) {
    const environmentTexture = generateEnvironmentTexture(weatherCondition);
    const envRT = pmremGenerator.fromEquirectangular(environmentTexture);
    const newEnvMap = envRT.texture;

    scene.environment = newEnvMap;

    // Dispose old envMap if it exists
    if (envMap) envMap.dispose();
    envMap = newEnvMap;

    environmentTexture.dispose();
  }
}

// Update the weather display in the UI
function updateWeatherDisplay(weatherData) {
  const weatherIcon = document.getElementById('weatherIcon');
  const weatherInfo = document.getElementById('weatherInfo');

  if (!weatherIcon || !weatherInfo) return;

  // Set weather icon
  if (weatherData.icon) {
    weatherIcon.style.backgroundImage = `url(https://openweathermap.org/img/wn/${weatherData.icon}@2x.png)`;
  }

  // Set weather info text
  weatherInfo.innerHTML = `
    <div>${weatherData.description}</div>
    <div>${Math.round(weatherData.temp)}°C | ${weatherData.location}</div>
  `;
}

// --------------------------------------------
// Private helper functions
// --------------------------------------------
function createGradientBackground(weatherCondition = null) {
  const canvas = document.createElement('canvas');
  canvas.width = BG_CANVAS_WIDTH;
  canvas.height = BG_CANVAS_HEIGHT;
  const context = canvas.getContext('2d');

  const gradient = context.createLinearGradient(0, 0, 0, BG_CANVAS_HEIGHT);

  const condition = weatherCondition ? weatherCondition.toLowerCase() : null;
  const stops = (condition && WEATHER_BG_GRADIENTS[condition]) || WEATHER_BG_GRADIENTS._default;
  stops.forEach(([position, color]) => gradient.addColorStop(position, color));

  context.fillStyle = gradient;
  context.fillRect(0, 0, BG_CANVAS_WIDTH, BG_CANVAS_HEIGHT);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  return texture;
}

function setupEnvironmentMap() {
  pmremGenerator = new THREE.PMREMGenerator(renderer);

  // Create an enhanced procedural environment with a gradient sky based on weather
  const environmentTexture = generateEnvironmentTexture(weatherCondition);
  const envRT = pmremGenerator.fromEquirectangular(environmentTexture);
  envMap = envRT.texture;

  scene.environment = envMap;
  scene.background = envMap;

  environmentTexture.dispose();
  // Note: pmremGenerator is NOT disposed here — it's reused by updateSceneWeather()
}

function generateEnvironmentTexture(weatherCondition = null) {
  const canvas = document.createElement('canvas');
  canvas.width = ENV_CANVAS_WIDTH;
  canvas.height = ENV_CANVAS_HEIGHT;
  const context = canvas.getContext('2d');

  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);

  const condition = weatherCondition ? weatherCondition.toLowerCase() : null;
  const stops = (condition && WEATHER_ENV_GRADIENTS[condition]) || WEATHER_ENV_GRADIENTS._default;
  stops.forEach(([position, color]) => gradient.addColorStop(position, color));

  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Add weather-specific effects
  drawWeatherEffects(context, canvas.width, canvas.height, weatherCondition);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace; // Set proper color space
  return texture;
}

// --- Individual weather effect drawing functions ---

function drawDefaultEffects(context, width, height) {
  // Subtle clouds
  context.fillStyle = 'rgba(255, 255, 255, 0.3)';
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height * 0.4;
    const radius = 30 + Math.random() * 80;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  // Subtle glow near horizon
  const horizonGlow = context.createRadialGradient(
    width / 2, height * 0.7, 0,
    width / 2, height * 0.7, width * 0.8
  );
  horizonGlow.addColorStop(0, 'rgba(255, 240, 220, 0.3)');
  horizonGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = horizonGlow;
  context.fillRect(0, 0, width, height);
}

function drawClearEffects(context, width, height) {
  // Subtle sun glow
  const sunGlow = context.createRadialGradient(
    width * 0.7, height * 0.2, 0,
    width * 0.7, height * 0.2, width * 0.2
  );
  sunGlow.addColorStop(0, 'rgba(255, 230, 150, 0.5)');
  sunGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = sunGlow;
  context.fillRect(0, 0, width, height);

  // Few tiny clouds
  context.fillStyle = 'rgba(255, 255, 255, 0.2)';
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height * 0.3;
    const radius = 20 + Math.random() * 50;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
}

function drawCloudEffects(context, width, height) {
  // More and denser clouds
  context.fillStyle = 'rgba(255, 255, 255, 0.4)';
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height * 0.5;
    const radius = 50 + Math.random() * 100;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  // Add darker cloud shadows
  context.fillStyle = 'rgba(100, 100, 100, 0.1)';
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height * 0.4 + 10;
    const radius = 40 + Math.random() * 90;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
}

function drawRainEffects(context, width, height) {
  // Dark clouds
  context.fillStyle = 'rgba(120, 140, 160, 0.4)';
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height * 0.4;
    const radius = 60 + Math.random() * 120;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  // Rain streaks
  context.strokeStyle = 'rgba(200, 225, 255, 0.6)';
  context.lineWidth = 1;
  for (let i = 0; i < 100; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height * 0.7;
    const length = 10 + Math.random() * 20;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x - 5, y + length);
    context.stroke();
  }
}

function drawThunderstormEffects(context, width, height) {
  // Dark clouds
  context.fillStyle = 'rgba(70, 80, 90, 0.5)';
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height * 0.4;
    const radius = 70 + Math.random() * 130;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  // Lightning flashes
  for (let i = 0; i < 3; i++) {
    const x = width * 0.3 + Math.random() * width * 0.4;
    const y = height * 0.2;

    context.strokeStyle = 'rgba(255, 255, 200, 0.8)';
    context.lineWidth = 2 + Math.random() * 2;
    context.beginPath();
    context.moveTo(x, y);

    // Create zigzag path for lightning
    let currentX = x;
    let currentY = y;
    const segments = 3 + Math.floor(Math.random() * 3);

    for (let j = 0; j < segments; j++) {
      currentX += (Math.random() * 30) - 15;
      currentY += height * 0.1;
      context.lineTo(currentX, currentY);
    }

    context.stroke();

    // Add glow
    context.shadowColor = 'rgba(255, 255, 150, 0.8)';
    context.shadowBlur = 15;
    context.stroke();
    context.shadowBlur = 0;
  }
}

function drawSnowEffects(context, width, height) {
  // Light clouds
  context.fillStyle = 'rgba(220, 230, 240, 0.4)';
  for (let i = 0; i < 25; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height * 0.4;
    const radius = 50 + Math.random() * 100;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  // Snowflakes
  context.fillStyle = 'rgba(255, 255, 255, 0.8)';
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height * 0.7;
    const size = 1 + Math.random() * 3;
    context.beginPath();
    context.arc(x, y, size, 0, Math.PI * 2);
    context.fill();
  }
}

function drawMistEffects(context, width, height) {
  // Misty overlay
  context.fillStyle = 'rgba(200, 215, 225, 0.5)';
  context.fillRect(0, 0, width, height);

  // Foggy patches
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height * 0.8;
    const radius = 100 + Math.random() * 200;

    const gradient = context.createRadialGradient(
      x, y, 0,
      x, y, radius
    );
    gradient.addColorStop(0, 'rgba(200, 215, 225, 0.6)');
    gradient.addColorStop(1, 'rgba(200, 215, 225, 0)');

    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
}

// Dispatch map for weather effects
const WEATHER_EFFECTS = {
  'clear': drawClearEffects,
  'clouds': drawCloudEffects,
  'rain': drawRainEffects,
  'drizzle': drawRainEffects,
  'thunderstorm': drawThunderstormEffects,
  'snow': drawSnowEffects,
  'mist': drawMistEffects,
  'fog': drawMistEffects,
  'haze': drawMistEffects,
};

function drawWeatherEffects(context, width, height, weatherCondition) {
  const condition = weatherCondition ? weatherCondition.toLowerCase() : null;
  const drawFn = condition ? WEATHER_EFFECTS[condition] : null;
  (drawFn || drawDefaultEffects)(context, width, height);
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
