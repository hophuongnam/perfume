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

// Weather condition for background
let weatherCondition = null;

// We keep references to help with environment creation
let pmremGenerator = null;

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
  canvas.width = 2;
  canvas.height = 512;
  const context = canvas.getContext('2d');

  // Vertical gradient - varies based on weather
  const gradient = context.createLinearGradient(0, 0, 0, 512);
  
  // Apply different gradients based on weather condition
  if (weatherCondition) {
    switch(weatherCondition.toLowerCase()) {
      case 'clear':
        // Sunny blue sky
        gradient.addColorStop(0, '#3a7bd5');
        gradient.addColorStop(0.5, '#93b7e7');
        gradient.addColorStop(1, '#f5f7fa');
        break;
      case 'clouds':
        // Cloudy gray-blue
        gradient.addColorStop(0, '#757F9A');
        gradient.addColorStop(0.5, '#9EADC8');
        gradient.addColorStop(1, '#D7DDE8');
        break;
      case 'rain':
      case 'drizzle':
        // Rainy dark blue
        gradient.addColorStop(0, '#4B6CB7');
        gradient.addColorStop(0.5, '#6D83AB');
        gradient.addColorStop(1, '#8A9EAF');
        break;
      case 'thunderstorm':
        // Stormy dark grey-blue
        gradient.addColorStop(0, '#293036');
        gradient.addColorStop(0.5, '#4A545D');
        gradient.addColorStop(1, '#6D767F');
        break;
      case 'snow':
        // Snowy light blue-white
        gradient.addColorStop(0, '#C9D6FF');
        gradient.addColorStop(0.5, '#E2E9F0');
        gradient.addColorStop(1, '#FFFFFF');
        break;
      case 'mist':
      case 'fog':
      case 'haze':
        // Misty light grey
        gradient.addColorStop(0, '#ABB8CD');
        gradient.addColorStop(0.5, '#C5D0DB');
        gradient.addColorStop(1, '#E0E5EB');
        break;
      default:
        // Default clear day
        gradient.addColorStop(0, '#f3e9f9');
        gradient.addColorStop(0.5, '#f0f0f6');
        gradient.addColorStop(1, '#fff9f2');
    }
  } else {
    // Original gradient if no weather provided
    gradient.addColorStop(0, '#f3e9f9');
    gradient.addColorStop(0.5, '#f0f0f6');
    gradient.addColorStop(1, '#fff9f2');
  }

  context.fillStyle = gradient;
  context.fillRect(0, 0, 2, 512);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  return texture;
}

function setupEnvironmentMap() {
  pmremGenerator = new THREE.PMREMGenerator(renderer);
  // No need to call compileCubemapShader() in newer Three.js versions
  
  // Create an enhanced procedural environment with a gradient sky based on weather
  const environmentTexture = generateEnvironmentTexture(weatherCondition);
  const envRT = pmremGenerator.fromEquirectangular(environmentTexture);
  envMap = envRT.texture;

  scene.environment = envMap;
  scene.background = envMap;
  
  environmentTexture.dispose();
  pmremGenerator.dispose(); // Properly dispose of the generator
}

function generateEnvironmentTexture(weatherCondition = null) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048; // Higher resolution for WebGL2
  canvas.height = 1024;
  const context = canvas.getContext('2d');

  // Enhanced gradient for sky based on weather
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  
  // Apply different gradients based on weather condition
  if (weatherCondition) {
    switch(weatherCondition.toLowerCase()) {
      case 'clear':
        // Sunny blue sky
        gradient.addColorStop(0, '#1e3c72');
        gradient.addColorStop(0.3, '#2a5298');
        gradient.addColorStop(0.6, '#79a7ff');
        gradient.addColorStop(1, '#f5f7fa');
        break;
      case 'clouds':
        // Cloudy gray-blue
        gradient.addColorStop(0, '#4B6584');
        gradient.addColorStop(0.3, '#627A97');
        gradient.addColorStop(0.6, '#A1BBCE');
        gradient.addColorStop(1, '#D9E2EC');
        break;
      case 'rain':
      case 'drizzle':
        // Rainy dark blue
        gradient.addColorStop(0, '#3A506B');
        gradient.addColorStop(0.3, '#5D7793');
        gradient.addColorStop(0.6, '#7D92A9');
        gradient.addColorStop(1, '#A5B5C5');
        break;
      case 'thunderstorm':
        // Stormy dark grey-blue
        gradient.addColorStop(0, '#16222A');
        gradient.addColorStop(0.3, '#33444F');
        gradient.addColorStop(0.6, '#4D646F');
        gradient.addColorStop(1, '#7B8C96');
        break;
      case 'snow':
        // Snowy light blue-white
        gradient.addColorStop(0, '#8C9EFF');
        gradient.addColorStop(0.3, '#A5BFF9');
        gradient.addColorStop(0.6, '#D4E0F0');
        gradient.addColorStop(1, '#ffffff');
        break;
      case 'mist':
      case 'fog':
      case 'haze':
        // Misty light grey
        gradient.addColorStop(0, '#8B9CAB');
        gradient.addColorStop(0.3, '#A1B6C7');
        gradient.addColorStop(0.6, '#C8D6E0');
        gradient.addColorStop(1, '#E0E8F0');
        break;
      default:
        // Default gradient
        gradient.addColorStop(0, '#2c3e50'); // Darker blue at top
        gradient.addColorStop(0.3, '#4287f5'); // Mid blue
        gradient.addColorStop(0.6, '#a7c5f9'); // Light blue
        gradient.addColorStop(1, '#f5f5f5');   // Almost white at bottom
    }
  } else {
    // Original gradient if no weather provided
    gradient.addColorStop(0, '#2c3e50'); // Darker blue at top
    gradient.addColorStop(0.3, '#4287f5'); // Mid blue
    gradient.addColorStop(0.6, '#a7c5f9'); // Light blue
    gradient.addColorStop(1, '#f5f5f5');   // Almost white at bottom
  }
  
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Add weather-specific effects
  drawWeatherEffects(context, canvas.width, canvas.height, weatherCondition);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace; // Set proper color space
  return texture;
}

// Add weather-specific effects to the environment
function drawWeatherEffects(context, width, height, weatherCondition) {
  if (!weatherCondition) {
    // Default subtle clouds
    context.fillStyle = 'rgba(255, 255, 255, 0.3)';
    for (let i = 0; i < 20; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height * 0.4;
      const radius = 30 + Math.random() * 80;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    
    // Add a subtle glow near horizon
    const horizonGlow = context.createRadialGradient(
      width / 2, height * 0.7, 0,
      width / 2, height * 0.7, width * 0.8
    );
    horizonGlow.addColorStop(0, 'rgba(255, 240, 220, 0.3)'); // Warm glow
    horizonGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');   // Fade out
    context.fillStyle = horizonGlow;
    context.fillRect(0, 0, width, height);
    return;
  }
  
  switch(weatherCondition.toLowerCase()) {
    case 'clear':
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
      break;
      
    case 'clouds':
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
      break;
      
    case 'rain':
    case 'drizzle':
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
      break;
      
    case 'thunderstorm':
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
      break;
      
    case 'snow':
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
      break;
      
    case 'mist':
    case 'fog':
    case 'haze':
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
      break;
      
    default:
      // Default subtle clouds
      context.fillStyle = 'rgba(255, 255, 255, 0.3)';
      for (let i = 0; i < 20; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height * 0.4;
        const radius = 30 + Math.random() * 80;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }
      
      // Add a subtle glow near horizon
      const defaultGlow = context.createRadialGradient(
        width / 2, height * 0.7, 0,
        width / 2, height * 0.7, width * 0.8
      );
      defaultGlow.addColorStop(0, 'rgba(255, 240, 220, 0.3)');
      defaultGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
      context.fillStyle = defaultGlow;
      context.fillRect(0, 0, width, height);
  }
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