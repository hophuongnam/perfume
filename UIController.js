/**
 * UIController.js
 * Loads config from server, sets up loading screen, handles user input (drag/filter/help),
 * plus has the main entry point that orchestrates the entire app.
 */

import * as THREE from 'three';
import { initScene, animate, onWindowResize, camera, updateSceneWeather } from './SceneManager.js';
import { buildAllPlanes, parseSingleRack, planeLayouts, slotOccupants } from './RackBuilder.js';
import { fetchAllNotionBottles, createBottleFromNotion, clickableBottles,
         updateBottleSlotOnServer, setCapColor, updateBottleCapColorOnServer,
         updateBottles } from './BottleManager.js';

// Shared config object
export let config = {
  rackR1: "",
  rackR2: "",
  rackR3: "",
  rackR4: "",
  planeP1: "",
  planeP2: "",
  planeP3: "",
  planeP4: "",
  planeVerticalOffset: "2",
  offsetRack: "1",
  capColorDefault: "Gold"
};

// We'll keep track of user interaction states
let dragMode = false;
let draggingBottle = null;
let dragPlane = null;
let dragPlaneIntersect = null;
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();
let weatherUpdateInterval = null;

let sourceBottle = null;
let targetBottle = null;
let activeBottle = null;
let hoveredBottle = null;
let lastFilterMatches = [];
let suggestedBottles = []; // Track bottles suggested for the weather
let layeringSuggestions = []; // Track perfume layering suggestions
let suggestionActive = false; // Track if suggestion mode is active
let layeringActive = false; // Track if layering suggestion mode is active
const hoverIntensity = 0.15; // Brightness increase for hover effect

// A minimal class from original code for a multi-step loading UI
class LoadingManager {
  constructor() {
    this.steps = {
      'config': { weight: 10, status: 'pending', element: 'loadingStepConfig' },
      'scene':  { weight: 15, status: 'pending', element: 'loadingStepScene' },
      'planes': { weight: 15, status: 'pending', element: 'loadingStepPlanes' },
      'notion': { weight: 30, status: 'pending', element: 'loadingStepNotion' },
      'bottles':{ weight: 30, status: 'pending', element: 'loadingStepBottles' }
    };
    this.totalWeight = Object.values(this.steps).reduce((sum, s) => sum + s.weight, 0);
    this.completedWeight = 0;
    this.progressBar = document.getElementById('loadingProgressBar');
    this.bottleFill = document.getElementById('bottleFillAnimation');
    this.overlay = document.getElementById('loadingOverlay');
    this.updateProgressBar();
  }
  startStep(stepName) {
    if (!this.steps[stepName]) return;
    this.steps[stepName].status = 'active';
    const el = document.getElementById(this.steps[stepName].element);
    if (el) {
      el.innerText = 'In Progress';
      el.className = 'loadingStepStatus loadingStepActive';
    }
    this.updateProgressBar();
  }
  completeStep(stepName) {
    if (!this.steps[stepName]) return;
    const step = this.steps[stepName];
    if (step.status !== 'complete') {
      step.status = 'complete';
      this.completedWeight += step.weight;
      const el = document.getElementById(step.element);
      if (el) {
        el.innerText = 'Complete';
        el.className = 'loadingStepStatus loadingStepComplete';
      }
      this.updateProgressBar();
    }
  }
  updateProgressBar() {
    const progressPercent = (this.completedWeight / this.totalWeight) * 100;
    if (this.progressBar) {
      this.progressBar.style.width = `${progressPercent}%`;
    }
    if (this.bottleFill) {
      this.bottleFill.style.height = `${progressPercent}%`;
    }
    if (progressPercent >= 100) {
      setTimeout(() => {
        this.hideOverlay();
      }, 500);
    }
  }
  hideOverlay() {
    if (this.overlay) {
      this.overlay.style.opacity = '0';
      setTimeout(() => {
        this.overlay.style.display = 'none';
      }, 500);
    }
  }
  forceComplete() {
    Object.keys(this.steps).forEach(k => {
      this.completeStep(k);
    });
  }
}

// We store a reference so we can mark steps from inside initApp
let loadingManager = null;

/**
 * The main entry point to initialize the entire app
 */
export async function initApp() {
  try {
    loadingManager = new LoadingManager();

    // 1) Fetch config
    loadingManager.startStep('config');
    await fetchConfig();
    parseRackConfigs();
    loadingManager.completeStep('config');

    // 2) Init Scene
    loadingManager.startStep('scene');
    initScene();
    window.addEventListener('resize', onWindowResize);
    loadingManager.completeStep('scene');

    // 3) Build planes
    loadingManager.startStep('planes');
    buildAllPlanes(config);
    loadingManager.completeStep('planes');

    // 4) Fetch Notion data
    loadingManager.startStep('notion');
    const notionBottles = await fetchAllNotionBottles();
    loadingManager.completeStep('notion');

    // 5) Place bottles
    loadingManager.startStep('bottles');
    if (notionBottles && notionBottles.length > 0) {
      notionBottles.forEach(bData => {
        createBottleFromNotion(bData);
      });
    }
    loadingManager.completeStep('bottles');

    // Setup UI events after scene is built
    setupEventListeners();
    
    // Setup weather updates
    setupWeatherUpdates();

    // Start animation
    animate(() => {
      updateBottles(activeBottle);
      handleActiveBottleNotice();
    });
  } catch (err) {
    console.error("Error in initApp:", err);
    const loadingTitle = document.getElementById('loadingTitle');
    if (loadingTitle) {
      loadingTitle.innerText = "Error Loading Application";
      loadingTitle.style.color = "#ff6b6b";
    }
    if (loadingManager) {
      setTimeout(() => loadingManager.forceComplete(), 2000);
    }
  }
}

/**
 * Load config from server
 */
async function fetchConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) {
      throw new Error(`Failed to load config. Status: ${response.status}`);
    }
    config = await response.json();
  } catch (err) {
    console.error('Error fetching config:', err);
    const configStep = document.getElementById('loadingStepConfig');
    if (configStep) {
      configStep.innerText = 'Error';
      configStep.style.color = '#ff6b6b';
    }
    throw err;
  }
}

/**
 * Parse environment-based rack definitions
 */
function parseRackConfigs() {
  parseSingleRack("R1", config.rackR1);
  parseSingleRack("R2", config.rackR2);
  parseSingleRack("R3", config.rackR3);
  parseSingleRack("R4", config.rackR4);
}

/**
 * Debounce utility function to limit the frequency of function calls
 */
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/**
 * Update the weather data and scene
 */
async function updateWeather() {
  try {
    const response = await fetch('/api/weather');
    if (response.ok) {
      const weatherData = await response.json();
      console.log('Weather updated:', weatherData);
      
      // Update the scene background based on weather
      if (weatherData.condition) {
        handleWeatherChange(weatherData.condition);
      }
      
      // Update the UI weather display
      updateWeatherDisplay(weatherData);
    }
  } catch (err) {
    console.warn('Failed to update weather:', err);
  }
}

/**
 * Update scene based on new weather condition
 */
function handleWeatherChange(newWeatherCondition) {
  // Update the scene weather using the imported function
  updateSceneWeather(newWeatherCondition);
  
  // Clear any existing suggestions as weather has changed
  if (suggestionActive) {
    clearSuggestions();
  }
}

/**
 * Update the UI with weather information
 */
function updateWeatherDisplay(weatherData) {
  const weatherInfo = document.getElementById('weatherInfo');
  if (!weatherInfo) return;
  
  // Format the weather information
  let weatherText = '';
  
  if (weatherData.condition) {
    // Capitalize first letter of condition
    const condition = weatherData.condition.charAt(0).toUpperCase() +
                     weatherData.condition.slice(1);
    weatherText += condition;
  }
  
  // Check for temperature (server sends as "temp" but we handle both names)
  const temperature = weatherData.temp !== undefined ? weatherData.temp : weatherData.temperature;
  if (temperature !== undefined) {
    weatherText += weatherText ? ', ' : '';
    weatherText += `${temperature}°`;
    
    // Add unit if provided
    if (weatherData.unit) {
      weatherText += weatherData.unit;
    } else {
      weatherText += 'C'; // Default to Celsius
    }
  }
  
  // Add humidity if available
  if (weatherData.humidity !== undefined) {
    weatherText += weatherText ? ', ' : '';
    weatherText += `Humidity: ${weatherData.humidity}%`;
  }
  
  // Add location
  if (weatherData.location) {
    weatherText += weatherText ? ' | ' : '';
    weatherText += `Location: ${weatherData.location}`;
  }
  
  // Update the weather info element
  weatherInfo.textContent = weatherText || 'Weather data unavailable';
  
  // You might want to add weather icons or classes based on condition
  const weatherIcon = document.getElementById('weatherIcon');
  if (weatherIcon) {
    // Remove existing classes
    weatherIcon.className = 'weather-icon';
    
    // Add class based on condition
    if (weatherData.condition) {
      weatherIcon.classList.add(`weather-${weatherData.condition.toLowerCase()}`);
    }
  }
}

/**
 * Set up periodic weather updates
 */
function setupWeatherUpdates() {
  // Initial weather update
  updateWeather();
  
  // Update weather every 15 minutes (900000 ms)
  weatherUpdateInterval = setInterval(updateWeather, 900000);
}

/**
 * Hook up event listeners for interactions
 */
function setupEventListeners() {
  dragPlaneIntersect = new THREE.Vector3();

  const canvas = document.querySelector('canvas');
  if (!canvas) return;

  canvas.addEventListener('mousedown', onCanvasMouseDown);
  
  // Debounced mouse move handler (~60fps)
  const debouncedMouseMove = debounce(onCanvasMouseMove, 16);
  canvas.addEventListener('mousemove', debouncedMouseMove);
  
  canvas.addEventListener('mouseup', onCanvasMouseUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // Filter input
  const filterInput = document.getElementById('filterInput');
  if (filterInput) {
    filterInput.addEventListener('input', ev => {
      applyFilter(ev.target.value);
    });
  }
  
  // Add help about layering in the help window
  const helpWindow = document.getElementById('helpWindow');
  if (helpWindow) {
    const helpList = helpWindow.querySelector('ul');
    if (helpList) {
      const layeringHelpItem = document.createElement('li');
      layeringHelpItem.innerHTML = '<strong>l</strong>: Toggle perfume layering suggestions';
      helpList.appendChild(layeringHelpItem);
    }
  }
}

/**
 * Helper function to get the top-level bottle from any object in the hierarchy
 */
function getTopLevelBottle(object) {
  let current = object;
  while (current.parent && !clickableBottles.includes(current)) {
    current = current.parent;
  }
  return clickableBottles.includes(current) ? current : null;
}

/**
 * Determines if a bottle can be highlighted (not already selected/flying)
 */
function canHighlightBottle(bottle) {
  return bottle &&
         bottle !== sourceBottle &&
         bottle !== targetBottle &&
         !bottle.userData.flying;
}

/**
 * MOUSE / DRAG LOGIC
 */
function onCanvasMouseDown(event) {
  event.preventDefault();
  
  // If in suggestion mode or layering mode, ignore regular bottle interactions
  // except for those initiated from the suggestion board
  if (suggestionActive || layeringActive) {
    return;
  }
  
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  if (dragMode) {
    const intersects = raycaster.intersectObjects(clickableBottles, true);
    if (intersects.length > 0) {
      let clickedGroup = intersects[0].object;
      while (clickedGroup.parent && !clickableBottles.includes(clickedGroup)) {
        clickedGroup = clickedGroup.parent;
      }
      draggingBottle = clickedGroup;

      const dragBottleLabel = document.getElementById('dragBottleLabel');
      const dragSlotLabel = document.getElementById('dragSlotLabel');
      dragBottleLabel.style.display = 'block';
      dragBottleLabel.innerText = `Dragging: ${draggingBottle.userData.notionData.name}`;
      dragSlotLabel.style.display = 'block';
      dragSlotLabel.innerText = '';

      const oldKey = `${draggingBottle.userData.plane}-${draggingBottle.userData.row}-${draggingBottle.userData.column}`;
      if (slotOccupants[oldKey] === draggingBottle) {
        delete slotOccupants[oldKey];
      }
      dragPlane = new THREE.Plane(new THREE.Vector3(0,1,0), -draggingBottle.position.y);
    }
    return;
  }

  // Normal mode
  const intersects = raycaster.intersectObjects(clickableBottles, true);
  if (intersects.length > 0) {
    let clickedGroup = intersects[0].object;
    while (clickedGroup.parent && !clickableBottles.includes(clickedGroup)) {
      clickedGroup = clickedGroup.parent;
    }
    if (activeBottle && activeBottle !== clickedGroup) {
      activeBottle.userData.flying = false;
    }
    if (clickedGroup) {
      if (activeBottle !== clickedGroup) {
        activeBottle = clickedGroup;
        activeBottle.userData.flying = true;
      } else {
        activeBottle.userData.flying = !activeBottle.userData.flying;
      }
    }
  } else {
    // clicked on empty space
    if (activeBottle) {
      activeBottle.userData.flying = false;
      activeBottle = null;
    }
  }
}

function onCanvasMouseMove(event) {
  // Update mouse coordinates for raycasting
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  
  // Skip hover effects if filter box is visible, suggestion mode, or layering mode
  if (isFilterBoxVisible() || suggestionActive || layeringActive) return;
  
  // Handle drag mode
  if (dragMode && draggingBottle) {
    event.preventDefault();
    raycaster.setFromCamera(mouse, window._cameraOverride || camera);

    if (dragPlane) {
      if (raycaster.ray.intersectPlane(dragPlane, dragPlaneIntersect)) {
        draggingBottle.position.x = dragPlaneIntersect.x;
        draggingBottle.position.z = dragPlaneIntersect.z;

        const dragPlaneNum = (draggingBottle.userData.dragPlaneNum !== undefined)
          ? draggingBottle.userData.dragPlaneNum
          : draggingBottle.userData.plane;
        const nearest = findNearestSlotInPlane(dragPlaneNum, draggingBottle.position.x, draggingBottle.position.z);
        const dragSlotLabel = document.getElementById('dragSlotLabel');
        if (nearest) {
          const key = `${nearest.plane}-${nearest.row}-${nearest.column}`;
          const occupant = slotOccupants[key];
          if (occupant && occupant !== draggingBottle) {
            dragSlotLabel.innerText = `Slot occupant: ${occupant.userData.notionData.name}`;
          } else {
            dragSlotLabel.innerText = `Slot: row=${nearest.row}, col=${nearest.column}`;
          }
        } else {
          dragSlotLabel.innerText = '(No nearest slot in this plane)';
        }
      }
    }
    return;
  }
  
  // Handle hover highlighting in normal mode
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(clickableBottles, true);
  
  // Determine which bottle (if any) should be hovered
  let newHoveredBottle = null;
  if (intersects.length > 0) {
    const topLevelBottle = getTopLevelBottle(intersects[0].object);
    if (canHighlightBottle(topLevelBottle)) {
      newHoveredBottle = topLevelBottle;
    }
  }
  
  // Handle unhover if needed (restore original color)
  if (hoveredBottle && hoveredBottle !== newHoveredBottle) {
    const highlightables = hoveredBottle.userData.highlightables || [];
    highlightables.forEach(h => {
      h.mesh.material.color.copy(h.originalColor);
    });
  }
  
  // Handle new hover (apply highlight color)
  if (newHoveredBottle && hoveredBottle !== newHoveredBottle) {
    const highlightables = newHoveredBottle.userData.highlightables || [];
    highlightables.forEach(h => {
      const hoverColor = h.originalColor.clone();
      hoverColor.r = Math.min(1, hoverColor.r + hoverIntensity);
      hoverColor.g = Math.min(1, hoverColor.g + hoverIntensity);
      hoverColor.b = Math.min(1, hoverColor.b + hoverIntensity);
      h.mesh.material.color.copy(hoverColor);
    });
  }
  
  // Update the hoveredBottle reference
  hoveredBottle = newHoveredBottle;
}

function onCanvasMouseUp(event) {
  // Reset hover state if we're ending a drag operation
  if (hoveredBottle) {
    const highlightables = hoveredBottle.userData.highlightables || [];
    highlightables.forEach(h => {
      h.mesh.material.color.copy(h.originalColor);
    });
    hoveredBottle = null;
  }

  // Skip if filter box visible, suggestion mode, or layering mode
  if (isFilterBoxVisible() || suggestionActive || layeringActive) return;
  if (!dragMode || !draggingBottle) return;

  event.preventDefault();
  const finalPlane = (draggingBottle.userData.dragPlaneNum !== undefined)
    ? draggingBottle.userData.dragPlaneNum
    : draggingBottle.userData.plane;

  const nearest = findNearestSlotInPlane(finalPlane, draggingBottle.position.x, draggingBottle.position.z);
  if (nearest) {
    const newKey = `${nearest.plane}-${nearest.row}-${nearest.column}`;
    const occupant = slotOccupants[newKey];
    if (occupant && occupant !== draggingBottle) {
      // swapping occupant
      const occupantData = occupant.userData;
      const oldPlane = draggingBottle.userData.plane;
      const oldRow   = draggingBottle.userData.row;
      const oldCol   = draggingBottle.userData.column;
      const oldKey   = `${oldPlane}-${oldRow}-${oldCol}`;

      const oldSlot = planeLayouts[oldPlane].find(s => s.row === oldRow && s.column === oldCol);
      if (oldSlot) {
        occupant.position.set(oldSlot.x, oldSlot.y, oldSlot.z);
        occupant.userData.plane = oldPlane;
        occupant.userData.row   = oldRow;
        occupant.userData.column= oldCol;
        occupant.userData.initialY = oldSlot.y;
      }
      slotOccupants[oldKey] = occupant;

      draggingBottle.position.set(nearest.x, nearest.y, nearest.z);
      draggingBottle.userData.plane = nearest.plane;
      draggingBottle.userData.row   = nearest.row;
      draggingBottle.userData.column= nearest.column;
      draggingBottle.userData.initialY = nearest.y;
      slotOccupants[newKey] = draggingBottle;

      updateBottleSlotOnServer(draggingBottle.userData.notionData.id, nearest.plane, nearest.row, nearest.column);
      updateBottleSlotOnServer(occupantData.notionData.id, oldPlane, oldRow, oldCol);

    } else {
      // occupant empty
      draggingBottle.position.set(nearest.x, nearest.y, nearest.z);
      draggingBottle.userData.plane = nearest.plane;
      draggingBottle.userData.row   = nearest.row;
      draggingBottle.userData.column= nearest.column;
      draggingBottle.userData.initialY = nearest.y;
      slotOccupants[newKey] = draggingBottle;

      updateBottleSlotOnServer(draggingBottle.userData.notionData.id, nearest.plane, nearest.row, nearest.column);
    }
  } else {
    // revert
    const p = draggingBottle.userData;
    const oldSlot = planeLayouts[p.plane].find(s => s.row === p.row && s.column === p.column);
    if (oldSlot) {
      draggingBottle.position.set(oldSlot.x, p.initialY, oldSlot.z);
    }
  }

  const dragBottleLabel = document.getElementById('dragBottleLabel');
  const dragSlotLabel = document.getElementById('dragSlotLabel');
  dragBottleLabel.style.display = 'none';
  dragSlotLabel.style.display = 'none';
  const dragPlaneMoveLabel = document.getElementById('dragPlaneMoveLabel');
  dragPlaneMoveLabel.style.display = 'none';

  draggingBottle = null;
}

function findNearestSlotInPlane(plane, x, z) {
  let nearest = null;
  let minDist = Infinity;
  const slots = planeLayouts[plane];
  if (!slots) return null;
  for (const s of slots) {
    const dx = s.x - x;
    const dz = s.z - z;
    const distSq = dx*dx + dz*dz;
    if (distSq < minDist) {
      minDist = distSq;
      nearest = s;
    }
  }
  return nearest;
}

/**
 * KEYBOARD LOGIC
 */
function onKeyDown(e) {
  const key = e.key.toLowerCase();
  if (isFilterBoxVisible()) {
    if (key === 'escape') {
      if (lastFilterMatches.length === 1) {
        const singleMatch = lastFilterMatches[0];
        const { highlightables } = singleMatch.userData;
        highlightables.forEach(h => {
          h.mesh.material.color.copy(h.originalColor);
        });
        const filterInput = document.getElementById('filterInput');
        if (filterInput) filterInput.value = '';
        toggleFilterBox();
      } else {
        const filterInput = document.getElementById('filterInput');
        if (filterInput) filterInput.value = '';
        applyFilter('');
        toggleFilterBox();
      }
    }
    return;
  }

  if (!dragMode && key === 'h') {
    toggleHelpWindow();
    return;
  }

  if (key === 'd') {
    dragMode = !dragMode;
    const dragIndicator = document.getElementById('dragIndicator');
    if (dragMode) {
      // Reset hover state when entering drag mode
      if (hoveredBottle) {
        const highlightables = hoveredBottle.userData.highlightables || [];
        highlightables.forEach(h => {
          h.mesh.material.color.copy(h.originalColor);
        });
        hoveredBottle = null;
      }
      // Clear suggestions when entering drag mode
      if (suggestionActive) {
        clearSuggestions();
      }
      // Hide info board when drag mode is activated
      hideInfoBoard();
      dragIndicator.style.display = 'block';
    } else {
      dragIndicator.style.display = 'none';
    }
  } else if (!dragMode && key === 'f') {
    e.preventDefault();
    hideInfoBoard();
    toggleFilterBox();
  } else if (dragMode && draggingBottle) {
    if (key === 'escape') {
      cancelDrag();
    } else if (key === 'q') {
      moveDraggingBottleToPlane(-1);
    } else if (key === 'a') {
      moveDraggingBottleToPlane(1);
    }
  } else if (!dragMode) {
    if (key === 'escape') {
      if (sourceBottle) revertMark(sourceBottle);
      if (targetBottle) revertMark(targetBottle);
      sourceBottle = null;
      targetBottle = null;
      hideInfoBoard();
      // Also clear suggestions if active
      if (suggestionActive) {
        clearSuggestions();
      }
    } else if (key === '1') {
      if (activeBottle && activeBottle.userData.flying) {
        markAsSource(activeBottle);
      }
    } else if (key === '2') {
      if (activeBottle && activeBottle.userData.flying) {
        markAsTarget(activeBottle);
      }
    } else if (key === 's') {
      if (sourceBottle && targetBottle) {
        swapBottlePositions(sourceBottle, targetBottle);
        revertMark(sourceBottle);
        revertMark(targetBottle);
        sourceBottle = null;
        targetBottle = null;
      }
    } else if (key === '3') {
      if (activeBottle && activeBottle.userData.flying) {
        setCapColor(activeBottle, 'Gold');
      }
    } else if (key === '4') {
      if (activeBottle && activeBottle.userData.flying) {
        setCapColor(activeBottle, 'Silver');
      }
    } else if (key === '5') {
      if (activeBottle && activeBottle.userData.flying) {
        setCapColor(activeBottle, 'Black');
      }
    } else if (key === 'w') {
      if (activeBottle && activeBottle.userData.flying) {
        const url = activeBottle.userData.notionData.url;
        if (url) {
          window.open(url, '_blank');
        }
      }
    } else if (key === 'x') {
      // Toggle suggestions mode
      if (suggestionActive) {
        clearSuggestions();
      } else {
        suggestPerfumesForWeather();
      }
    } else if (key === 'l') {
      // Toggle layering suggestions mode
      if (layeringActive) {
        clearLayeringSuggestions();
      } else {
        suggestPerfumeLayering();
      }
    }
  }
}

function onKeyUp(e) {
  if (dragMode && (e.key.toLowerCase() === 'a' || e.key.toLowerCase() === 'q')) {
    const dragPlaneMoveLabel = document.getElementById('dragPlaneMoveLabel');
    dragPlaneMoveLabel.style.display = 'none';
  }
}

function cancelDrag() {
  const p = draggingBottle.userData;
  const oldPlane = p.plane;
  const oldRow = p.row;
  const oldCol = p.column;
  const oldSlot = planeLayouts[`${oldPlane}`].find(s => s.row === oldRow && s.column === oldCol);
  if (oldSlot) {
    draggingBottle.position.set(oldSlot.x, p.initialY, oldSlot.z);
    slotOccupants[`${oldPlane}-${oldRow}-${oldCol}`] = draggingBottle;
  }
  const dragBottleLabel = document.getElementById('dragBottleLabel');
  const dragSlotLabel = document.getElementById('dragSlotLabel');
  dragBottleLabel.style.display = 'none';
  dragSlotLabel.style.display = 'none';

  draggingBottle = null;
}

function moveDraggingBottleToPlane(delta) {
  if (!draggingBottle) return;
  const p = draggingBottle.userData;
  const oldPlane = (p.dragPlaneNum !== undefined) ? p.dragPlaneNum : p.plane;
  let newPlane = oldPlane + delta;
  if (newPlane < 1) newPlane = 1;
  if (newPlane > 4) newPlane = 4;
  p.dragPlaneNum = newPlane;
  const planeSlots = planeLayouts[newPlane];
  if (planeSlots && planeSlots.length > 0) {
    const planeY = planeSlots[0].y;
    dragPlane.constant = -planeY;
    draggingBottle.position.y = planeY;
    p.initialY = planeY;
  }
  const dragPlaneMoveLabel = document.getElementById('dragPlaneMoveLabel');
  dragPlaneMoveLabel.style.display = 'block';
  if (delta < 0) {
    dragPlaneMoveLabel.innerText = "Move up";
  } else {
    dragPlaneMoveLabel.innerText = "Move down";
  }
}

/**
 * Mark / revert utility for source/target
 */
function markAsSource(bottle) {
  if (sourceBottle) revertMark(sourceBottle);
  sourceBottle = bottle;
  if (bottle) {
    const highlightables = bottle.userData.highlightables || [];
    highlightables.forEach(h => {
      h.mesh.material.color.set(0x00ff00);
    });
  }
}

function markAsTarget(bottle) {
  if (targetBottle) revertMark(targetBottle);
  targetBottle = bottle;
  if (bottle) {
    const highlightables = bottle.userData.highlightables || [];
    highlightables.forEach(h => {
      h.mesh.material.color.set(0x0000ff);
    });
  }
}

function revertMark(bottle) {
  if (!bottle) return;
  const highlightables = bottle.userData.highlightables || [];
  highlightables.forEach(h => {
    h.mesh.material.color.copy(h.originalColor);
  });
  if (bottle === sourceBottle) sourceBottle = null;
  if (bottle === targetBottle) targetBottle = null;
}

/**
 * Swap occupant positions
 */
function swapBottlePositions(bottleA, bottleB) {
  const Aplane = bottleA.userData.plane;
  const Arow   = bottleA.userData.row;
  const Acol   = bottleA.userData.column;
  const Bplane = bottleB.userData.plane;
  const Brow   = bottleB.userData.row;
  const Bcol   = bottleB.userData.column;

  const Akey = `${Aplane}-${Arow}-${Acol}`;
  const Bkey = `${Bplane}-${Brow}-${Bcol}`;

  const Apos = planeLayouts[Aplane].find(s => s.row === Arow && s.column === Acol);
  const Bpos = planeLayouts[Bplane].find(s => s.row === Brow && s.column === Bcol);

  if (Apos && Bpos) {
    slotOccupants[Akey] = bottleB;
    slotOccupants[Bkey] = bottleA;

    bottleA.position.set(Bpos.x, Bpos.y, Bpos.z);
    bottleB.position.set(Apos.x, Apos.y, Apos.z);

    bottleA.userData.plane = Bplane;
    bottleA.userData.row   = Brow;
    bottleA.userData.column= Bcol;
    bottleA.userData.initialY = Bpos.y;

    bottleB.userData.plane = Aplane;
    bottleB.userData.row   = Arow;
    bottleB.userData.column= Acol;
    bottleB.userData.initialY = Apos.y;

    updateBottleSlotOnServer(bottleA.userData.notionData.id, Bplane, Brow, Bcol);
    updateBottleSlotOnServer(bottleB.userData.notionData.id, Aplane, Arow, Acol);
  }
}

/**
 * FILTER
 */
function applyFilter(searchText) {
  function fold(str) {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }
  const trimmed = fold(searchText.trim());
  if (!trimmed) {
    clickableBottles.forEach(bg => {
      const { highlightables } = bg.userData;
      if (!highlightables) return;
      const isSource = (bg === sourceBottle);
      const isTarget = (bg === targetBottle);
      highlightables.forEach(h => {
        if (!isSource && !isTarget) {
          h.mesh.material.color.copy(h.originalColor);
        }
      });
      bg.userData.flying = false;
    });
    activeBottle = null;
    lastFilterMatches = [];
    return;
  }

  const searchTokens = trimmed.split(/\s+/);
  clickableBottles.forEach(bg => {
    bg.userData.flying = false;
  });

  const matchedBottles = [];
  clickableBottles.forEach(bg => {
    const { notionData, highlightables } = bg.userData;
    if (!highlightables) return;

    const nameTokens = fold(notionData.name || '').split(/\s+/);
    const houseTokens = fold(notionData.house || '').split(/\s+/);
    const accordsTokens = (notionData.accords || [])
      .map(a => fold(a).split(/\s+/))
      .flat();
    const seasonTokens = (notionData.seasons || [])
      .map(s => fold(s).split(/\s+/))
      .flat();
    const typeTokens = fold(notionData.type || '').split(/\s+/);
    const baseNotesTokens = (notionData.baseNotes || [])
      .map(note => fold(note).split(/\s+/))
      .flat();
    const middleNotesTokens = (notionData.middleNotes || [])
      .map(note => fold(note).split(/\s+/))
      .flat();
    const topNotesTokens = (notionData.topNotes || [])
      .map(note => fold(note).split(/\s+/))
      .flat();
    const timeTokens = (notionData.time || [])
      .map(timeValue => fold(timeValue).split(/\s+/))
      .flat();
    const notesTokens = (notionData.notes || [])
      .map(note => fold(note).split(/\s+/))
      .flat();

    const bottleTokens = [
      ...nameTokens,
      ...houseTokens,
      ...accordsTokens,
      ...seasonTokens,
      ...typeTokens,
      ...baseNotesTokens,
      ...middleNotesTokens,
      ...topNotesTokens,
      ...timeTokens,
      ...notesTokens
    ];

    const foundAll = searchTokens.every(t => bottleTokens.includes(t));
    if (foundAll) {
      matchedBottles.push(bg);
    }
    const isSource = (bg === sourceBottle);
    const isTarget = (bg === targetBottle);
    highlightables.forEach(entry => {
      if (foundAll) {
        if (!isSource && !isTarget) {
          entry.mesh.material.color.set(0xff0000);
        }
      } else {
        if (!isSource && !isTarget) {
          entry.mesh.material.color.copy(entry.originalColor);
        }
      }
    });
  });

  lastFilterMatches = matchedBottles;
  if (matchedBottles.length === 1) {
    const singleMatch = matchedBottles[0];
    if (activeBottle && activeBottle !== singleMatch) {
      activeBottle.userData.flying = false;
    }
    if (activeBottle !== singleMatch) {
      activeBottle = singleMatch;
      activeBottle.userData.flying = true;
    } else {
      activeBottle.userData.flying = !activeBottle.userData.flying;
    }
  } else {
    if (activeBottle) {
      activeBottle.userData.flying = false;
    }
    activeBottle = null;
  }
}

/**
 * HELPER
 */
function isFilterBoxVisible() {
  const filterBox = document.getElementById('filterBox');
  if (!filterBox) return false;
  const computedDisplay = window.getComputedStyle(filterBox).display;
  return computedDisplay !== 'none';
}

function toggleFilterBox() {
  const filterBox = document.getElementById('filterBox');
  if (!filterBox) return;
  const computedDisplay = window.getComputedStyle(filterBox).display;
  if (computedDisplay === 'none') {
    // Reset hover state when opening filter box
    if (hoveredBottle) {
      const highlightables = hoveredBottle.userData.highlightables || [];
      highlightables.forEach(h => {
        h.mesh.material.color.copy(h.originalColor);
      });
      hoveredBottle = null;
    }
    
    filterBox.style.display = 'block';
    const filterInput = document.getElementById('filterInput');
    if (filterInput) {
      filterInput.value = '';
      filterInput.focus();
    }
  } else {
    filterBox.style.display = 'none';
  }
}

function toggleHelpWindow() {
  const helpWindow = document.getElementById('helpWindow');
  if (!helpWindow) return;
  const computedDisplay = window.getComputedStyle(helpWindow).display;
  if (computedDisplay === 'none' || computedDisplay === '') {
    helpWindow.style.display = 'block';
  } else {
    helpWindow.style.display = 'none';
  }
}

/**
 * Update info board when bottle is active
 */
function handleActiveBottleNotice() {
  if (activeBottle && activeBottle.userData.flying) {
    // Update the info board with bottle details
    updateInfoBoard(activeBottle);
  } else {
    // Hide the info board when no bottle is active
    hideInfoBoard();
  }
}

/**
 * Update the sliding info board with bottle information
 */
function updateInfoBoard(bottle) {
  const infoBoard = document.getElementById('infoBoard');
  const content = document.getElementById('infoBoardContent');
  if (!infoBoard || !content) return;

  const data = bottle.userData.notionData;
  if (!data) return;

  // Build simplified HTML content to match billboard style
  let html = `
    <div class="house-name">${data.house || 'Unknown House'}</div>
    <div class="bottle-name">${data.name || 'No Name'}</div>
    <div class="separator"></div>`;

  // Add volume info if available
  if (data.volume) {
    html += `<div class="info-detail">Volume: ${data.volume} ml</div>`;
  }
  
  // Start the notes section with a two-column layout
  html += `<div class="notes-container">`;
  
  // Add notes breakdown if available in a two-column format
  if (data.topNotes && data.topNotes.length > 0) {
    html += `
      <div class="notes-row">
        <div class="notes-label">Top Notes:</div>
        <div class="notes-content">${data.topNotes.join(', ')}</div>
      </div>`;
  }
  
  if (data.middleNotes && data.middleNotes.length > 0) {
    html += `
      <div class="notes-row">
        <div class="notes-label">Middle Notes:</div>
        <div class="notes-content">${data.middleNotes.join(', ')}</div>
      </div>`;
  }
  
  if (data.baseNotes && data.baseNotes.length > 0) {
    html += `
      <div class="notes-row">
        <div class="notes-label">Base Notes:</div>
        <div class="notes-content">${data.baseNotes.join(', ')}</div>
      </div>`;
  }
  
  // Add Notes if available
  if (data.notes && data.notes.length > 0) {
    html += `
      <div class="notes-row">
        <div class="notes-label">Notes:</div>
        <div class="notes-content">${data.notes.join(', ')}</div>
      </div>`;
  }
  
  // Close the notes container
  html += `</div>`;

  // Add position info (like line4 in billboard)
  html += `
    <div class="position-info">
      Plane ${bottle.userData.plane}, Row ${bottle.userData.row}, Column ${bottle.userData.column}
    </div>`;

  content.innerHTML = html;
  infoBoard.classList.add('visible');
}

/**
 * Hide the info board
 */
function hideInfoBoard() {
  const infoBoard = document.getElementById('infoBoard');
  if (infoBoard) {
    infoBoard.classList.remove('visible');
  }
}

/**
 * Suggest perfumes based on current weather
 */
function suggestPerfumesForWeather() {
  // Exit if already in suggestion mode
  if (suggestionActive) {
    clearSuggestions();
    return;
  }
  
  // If layering mode is active, clear it first
  if (layeringActive) {
    clearLayeringSuggestions();
  }
  
  // Clear all bottle status (color and flying) before entering suggestion mode
  clickableBottles.forEach(bottle => {
    const highlightables = bottle.userData.highlightables || [];
    highlightables.forEach(h => {
      h.mesh.material.color.copy(h.originalColor);
    });
    
    // Reset flying states for ALL bottles, including the active bottle
    if (bottle.userData.flying) {
      bottle.userData.flying = false;
    }
  });
  
  // Reset active bottle since we've stopped all flying bottles
  activeBottle = null;
  
  // Get current weather from the weather display
  const weatherInfo = document.getElementById('weatherInfo');
  let weatherCondition = 'clear'; // Default
  
  if (weatherInfo && weatherInfo.textContent) {
    const weatherText = weatherInfo.textContent.toLowerCase();
    
    if (weatherText.includes('cloud')) {
      weatherCondition = 'clouds';
    } else if (weatherText.includes('rain') || weatherText.includes('drizzle')) {
      weatherCondition = 'rain';
    } else if (weatherText.includes('snow')) {
      weatherCondition = 'snow';
    } else if (weatherText.includes('thunder')) {
      weatherCondition = 'thunderstorm';
    } else if (weatherText.includes('fog') || weatherText.includes('mist') || weatherText.includes('haze')) {
      weatherCondition = 'mist';
    } else if (weatherText.includes('clear')) {
      weatherCondition = 'clear';
    }
  }
  
  // Determine current season based on Northern Hemisphere (can be customized by region)
  const now = new Date();
  const month = now.getMonth(); // 0-11
  let currentSeason;
  
  if (month >= 2 && month <= 4) {
    currentSeason = 'Spring';
  } else if (month >= 5 && month <= 7) {
    currentSeason = 'Summer';
  } else if (month >= 8 && month <= 10) {
    currentSeason = 'Fall';
  } else {
    currentSeason = 'Winter';
  }
  
  // Determine current time of day - only Day and Night options
  const hour = now.getHours();
  let currentTimeOfDay;
  
  // Day is considered from 6 AM to 6 PM, Night is from 6 PM to 6 AM
  if (hour >= 6 && hour < 18) {
    currentTimeOfDay = 'Day';
  } else {
    currentTimeOfDay = 'Night';
  }
  
  // Map weather conditions to appropriate fragrance accords
  const weatherAccordMap = {
    'clear': ['fresh', 'citrus', 'fresh spicy', 'aromatic', 'fruity', 'green'],
    'clouds': ['woody', 'amber', 'musky', 'powdery', 'earthy'],
    'rain': ['marine', 'aquatic', 'ozonic', 'fresh', 'green'],
    'thunderstorm': ['woody', 'earthy', 'oud', 'smoky', 'leather'],
    'snow': ['vanilla', 'warm spicy', 'almond', 'balsamic', 'powdery'],
    'mist': ['musky', 'marine', 'ozonic', 'metallic', 'salty']
  };
  
  // Map weather conditions to preferred note types
  const weatherNoteTypePreference = {
    'clear': { top: 2, middle: 1, base: 0 },     // Prefer top notes for clear weather
    'clouds': { top: 1, middle: 2, base: 1 },    // Prefer middle notes for cloudy weather
    'rain': { top: 1, middle: 2, base: 1 },      // Prefer middle notes for rainy weather
    'thunderstorm': { top: 0, middle: 1, base: 2 }, // Prefer base notes for stormy weather
    'snow': { top: 0, middle: 1, base: 2 },      // Prefer base notes for snowy weather
    'mist': { top: 1, middle: 2, base: 1 }       // Prefer middle notes for misty weather
  };
  
  // Get the note type preference for current weather
  const notePreference = weatherNoteTypePreference[weatherCondition] ||
    { top: 1, middle: 1, base: 1 }; // Default equal preference
  
  // Get suggested accords based on weather
  const suggestedAccords = weatherAccordMap[weatherCondition] || ['fresh', 'woody', 'citrus'];
  
  // Find perfumes that match the weather condition and current season
  suggestedBottles = [];
  
  // Map time of day to preferred fragrance times - simplified for Day/Night only
  const timePreferenceMap = {
    'Day': ['Day', 'Daytime', 'Office', 'Work', 'Sport', 'Casual', 'Spring', 'Summer'],
    'Night': ['Night', 'Evening', 'Date', 'Dinner', 'Clubbing', 'Special Occasion', 'Fall', 'Winter']
  };
  
  // Get suggested times based on current time of day
  const suggestedTimes = timePreferenceMap[currentTimeOfDay] || [];
  
  clickableBottles.forEach(bottle => {
    const bottleData = bottle.userData.notionData;
    if (!bottleData) return;
    
    const bottleAccords = bottleData.accords || [];
    const bottleSeasons = bottleData.seasons || [];
    const bottleTopNotes = bottleData.topNotes || [];
    const bottleMiddleNotes = bottleData.middleNotes || [];
    const bottleBaseNotes = bottleData.baseNotes || [];
    const bottleNotes = bottleData.notes || [];
    const bottleTimes = bottleData.time || [];
    
    // Calculate match score - higher is better
    let matchScore = 0;
    
    // Accord matching
    for (const accord of bottleAccords) {
      const accordLower = accord.toLowerCase();
      if (suggestedAccords.some(sa => accordLower.includes(sa))) {
        matchScore += 3; // Strong match with weather-appropriate accord
      }
    }
    
    // Check Notes for matches with suggested accords
    if (bottleNotes.length > 0) {
      const hasMatchingNotes = bottleNotes.some(note =>
        suggestedAccords.some(sa => note.toLowerCase().includes(sa.toLowerCase())));
      if (hasMatchingNotes) {
        matchScore += 2; // Moderate boost for matching notes
      }
    }
    
    // Note type matching based on weather preference
    if (bottleTopNotes.length > 0) {
      // Consider top notes with appropriate weight
      const hasMatchingTopNotes = bottleTopNotes.some(note =>
        suggestedAccords.some(sa => note.toLowerCase().includes(sa.toLowerCase())));
      if (hasMatchingTopNotes) {
        matchScore += notePreference.top;
      }
    }
    
    if (bottleMiddleNotes.length > 0) {
      // Consider middle notes with appropriate weight
      const hasMatchingMiddleNotes = bottleMiddleNotes.some(note =>
        suggestedAccords.some(sa => note.toLowerCase().includes(sa.toLowerCase())));
      if (hasMatchingMiddleNotes) {
        matchScore += notePreference.middle;
      }
    }
    
    if (bottleBaseNotes.length > 0) {
      // Consider base notes with appropriate weight
      const hasMatchingBaseNotes = bottleBaseNotes.some(note =>
        suggestedAccords.some(sa => note.toLowerCase().includes(sa.toLowerCase())));
      if (hasMatchingBaseNotes) {
        matchScore += notePreference.base;
      }
    }
    
    // Season matching
    if (bottleSeasons.includes(currentSeason)) {
      matchScore += 5; // Strong boost for matching the current season
    }
    
    // Time of day matching
    for (const time of bottleTimes) {
      if (suggestedTimes.some(suggestedTime =>
          time.toLowerCase().includes(suggestedTime.toLowerCase()))) {
        matchScore += 4; // Boost for appropriate time of day
        break;
      }
    }
    
    // If we have a decent match, add to suggestions
    if (matchScore >= 3) {
      suggestedBottles.push({
        bottle: bottle,
        score: matchScore,
        data: bottleData
      });
    }
  });
  
  // Sort by score (highest first)
  suggestedBottles.sort((a, b) => b.score - a.score);
  
  // Limit to top 5 suggestions
  suggestedBottles = suggestedBottles.slice(0, 5);
  
  // Set active bottles from suggestions (map back to bottle objects)
  const suggestedBottleObjects = suggestedBottles.map(item => item.bottle);
  
  // No longer highlight or make suggested bottles fly out
  // Display suggestions in the board
  displaySuggestionBoard(weatherCondition, currentSeason, currentTimeOfDay);
  
  // Set suggestion mode active - this will disable regular bottle interactions
  suggestionActive = true;
  
  // Hide info board if visible
  hideInfoBoard();
}

/**
 * Placeholder for potential future customization of suggested bottles
 * Currently we don't highlight or make bottles fly per requirements
 * @param {Array} bottleObjects - Array of bottle objects
 */
function highlightSuggestedBottles(bottleObjects) {
  // No highlighting or flying as per requirements
  // Function kept as placeholder for future customization options
}

/**
 * Clear all suggestions and return bottles to original state
 */
function clearSuggestions() {
  // Reset all bottles to their original state when exiting suggestion mode
  clickableBottles.forEach(bottle => {
    const highlightables = bottle.userData.highlightables || [];
    highlightables.forEach(h => {
      // Restore original color
      if (h.originalSuggestionColor) {
        h.mesh.material.color.copy(h.originalSuggestionColor);
        delete h.originalSuggestionColor;
      } else {
        h.mesh.material.color.copy(h.originalColor);
      }
    });
    
    // Stop flying unless it's the active bottle
    if (bottle.userData.flying && bottle !== activeBottle) {
      bottle.userData.flying = false;
    }
  });
  
  // Clear the array
  suggestedBottles = [];
  suggestionActive = false;
  
  // If layering mode is active, also clear it
  if (layeringActive) {
    clearLayeringSuggestions();
  }
  
  // Hide suggestion board
  const suggestionBoard = document.getElementById('suggestionBoard');
  if (suggestionBoard) {
    suggestionBoard.style.display = 'none';
  }
}

/**
 * Suggest perfume layering combinations
 */
function suggestPerfumeLayering() {
  // Exit if already in layering mode
  if (layeringActive) {
    clearLayeringSuggestions();
    return;
  }
  
  // Clear all bottle status (color and flying) before entering layering mode
  clickableBottles.forEach(bottle => {
    const highlightables = bottle.userData.highlightables || [];
    highlightables.forEach(h => {
      h.mesh.material.color.copy(h.originalColor);
    });
    
    // Reset flying states for ALL bottles, including the active bottle
    if (bottle.userData.flying) {
      bottle.userData.flying = false;
    }
  });
  
  // Reset active bottle since we've stopped all flying bottles
  activeBottle = null;
  
  // Clear weather suggestions if active
  if (suggestionActive) {
    clearSuggestions();
  }
  
  // Get current weather from the weather display
  const weatherInfo = document.getElementById('weatherInfo');
  let weatherCondition = 'clear'; // Default
  let currentTemperature = null;
  
  if (weatherInfo && weatherInfo.textContent) {
    const weatherText = weatherInfo.textContent.toLowerCase();
    
    // Extract weather condition
    if (weatherText.includes('cloud')) {
      weatherCondition = 'clouds';
    } else if (weatherText.includes('rain') || weatherText.includes('drizzle')) {
      weatherCondition = 'rain';
    } else if (weatherText.includes('snow')) {
      weatherCondition = 'snow';
    } else if (weatherText.includes('thunder')) {
      weatherCondition = 'thunderstorm';
    } else if (weatherText.includes('fog') || weatherText.includes('mist') || weatherText.includes('haze')) {
      weatherCondition = 'mist';
    } else if (weatherText.includes('clear')) {
      weatherCondition = 'clear';
    }
    
    // Try to extract temperature
    const tempMatch = weatherText.match(/(\d+)°/);
    if (tempMatch && tempMatch[1]) {
      currentTemperature = parseInt(tempMatch[1], 10);
    }
  }
  
  // Determine current season based on Northern Hemisphere
  const now = new Date();
  const month = now.getMonth(); // 0-11
  let currentSeason;
  
  if (month >= 2 && month <= 4) {
    currentSeason = 'Spring';
  } else if (month >= 5 && month <= 7) {
    currentSeason = 'Summer';
  } else if (month >= 8 && month <= 10) {
    currentSeason = 'Fall';
  } else {
    currentSeason = 'Winter';
  }
  
  // Determine current time of day
  const hour = now.getHours();
  let currentTimeOfDay;
  
  if (hour >= 6 && hour < 12) {
    currentTimeOfDay = 'Morning';
  } else if (hour >= 12 && hour < 18) {
    currentTimeOfDay = 'Afternoon';
  } else if (hour >= 18 && hour < 22) {
    currentTimeOfDay = 'Evening';
  } else {
    currentTimeOfDay = 'Night';
  }
  
  // Initialize array with valid perfume bottles
  const validBottles = clickableBottles.filter(bottle => {
    const bottleData = bottle.userData.notionData;
    return bottleData && (
      (bottleData.accords && bottleData.accords.length > 0) ||
      (bottleData.notes && bottleData.notes.length > 0) ||
      (bottleData.topNotes && bottleData.topNotes.length > 0) ||
      (bottleData.middleNotes && bottleData.middleNotes.length > 0) ||
      (bottleData.baseNotes && bottleData.baseNotes.length > 0)
    );
  });
  
  // If we don't have enough bottles for layering, show a message
  if (validBottles.length < 2) {
    alert("Not enough perfumes with notes/accords information to suggest layering combinations.");
    return;
  }
  
  // Define complementary note categories (base pairings)
  const complementaryCategories = {
    // Fresh notes pair well with warm/sweet notes
    'fresh': ['vanilla', 'amber', 'woody', 'sweet', 'warm spicy'],
    'citrus': ['vanilla', 'woody', 'amber', 'spicy'],
    'marine': ['woody', 'amber', 'vanilla'],
    'aromatic': ['sweet', 'vanilla', 'amber'],
    'green': ['floral', 'woody', 'fruity'],
    
    // Warm/spicy notes pair well with sweet/woody notes
    'spicy': ['vanilla', 'amber', 'sweet', 'woody'],
    'warm spicy': ['vanilla', 'amber', 'sweet', 'fruity'],
    
    // Woody notes pair well with many categories
    'woody': ['floral', 'citrus', 'fresh', 'vanilla', 'spicy', 'leather'],
    'oud': ['rose', 'vanilla', 'floral', 'spicy'],
    'sandalwood': ['rose', 'vanilla', 'floral', 'citrus'],
    
    // Floral notes pair well with fruity/fresh/woody notes
    'floral': ['fruity', 'fresh', 'woody', 'green', 'citrus'],
    'rose': ['oud', 'woody', 'patchouli'],
    'jasmine': ['vanilla', 'fruity', 'woody'],
    
    // Sweet notes pair well with fresh/spicy notes
    'sweet': ['fresh', 'spicy', 'woody', 'citrus'],
    'vanilla': ['fruity', 'spicy', 'woody', 'fresh', 'floral'],
    'amber': ['citrus', 'fresh', 'floral'],
    
    // Fruity notes pair well with floral/fresh notes
    'fruity': ['floral', 'fresh', 'vanilla', 'sweet'],
    
    // Earthy notes pair well with woody/spicy notes
    'earthy': ['woody', 'spicy', 'citrus', 'leather'],
    'patchouli': ['rose', 'vanilla', 'citrus', 'woody'],
    'leather': ['spicy', 'woody', 'citrus', 'fresh']
  };
  
  // Define weather-specific preferred note pairings
  const weatherLayeringPreferences = {
    'clear': {
      baseNotes: ['citrus', 'fresh', 'light', 'green'],
      complementsTo: ['floral', 'aromatic', 'woody'],
      description: 'Fresh and bright combinations for clear weather'
    },
    'clouds': {
      baseNotes: ['amber', 'warm spicy', 'woody', 'musky'],
      complementsTo: ['vanilla', 'sweet', 'fruity'],
      description: 'Cozy layering for cloudy days'
    },
    'rain': {
      baseNotes: ['petrichor', 'green', 'woody', 'earthy'],
      complementsTo: ['marine', 'ozonic', 'aromatic'],
      description: 'Rain-amplifying combinations'
    },
    'thunderstorm': {
      baseNotes: ['woody', 'earthy', 'smoky', 'oud'],
      complementsTo: ['leather', 'incense', 'spicy'],
      description: 'Dramatic scents for stormy weather'
    },
    'snow': {
      baseNotes: ['vanilla', 'amber', 'warm spicy'],
      complementsTo: ['woody', 'balsamic', 'sweet'],
      description: 'Warming layers for cold weather'
    },
    'mist': {
      baseNotes: ['musky', 'ozonic', 'clean'],
      complementsTo: ['marine', 'dewy', 'light floral'],
      description: 'Ethereal combinations for misty days'
    }
  };
  
  // Define season-specific preferred notes
  const seasonLayeringPreferences = {
    'Spring': {
      preferred: ['floral', 'green', 'fresh', 'light', 'dewy', 'fruity'],
      description: 'Fresh Spring combinations'
    },
    'Summer': {
      preferred: ['citrus', 'aquatic', 'light', 'coconut', 'fresh', 'aromatic'],
      description: 'Refreshing Summer layers'
    },
    'Fall': {
      preferred: ['woody', 'spicy', 'amber', 'warm', 'leathery', 'smoky'],
      description: 'Cozy Autumn pairings'
    },
    'Winter': {
      preferred: ['vanilla', 'warm spicy', 'gourmand', 'balsamic', 'sweet', 'resinous'],
      description: 'Rich Winter combinations'
    }
  };
  
  // Define time of day preferences
  const timeOfDayPreferences = {
    'Morning': {
      preferred: ['citrus', 'fresh', 'green', 'aromatic', 'light'],
      description: 'Energizing morning combination'
    },
    'Afternoon': {
      preferred: ['floral', 'fruity', 'fresh', 'clean', 'bright'],
      description: 'Balanced afternoon pairing'
    },
    'Evening': {
      preferred: ['amber', 'woody', 'spicy', 'warm', 'sweet'],
      description: 'Sophisticated evening blend'
    },
    'Night': {
      preferred: ['oud', 'vanilla', 'incense', 'musky', 'sensual', 'rich'],
      description: 'Intimate nighttime layering'
    }
  };
  
  // Current context for layering suggestions
  const currentContext = {
    weather: weatherCondition,
    season: currentSeason,
    timeOfDay: currentTimeOfDay,
    temperature: currentTemperature
  };
  
  // Calculate layering score for each potential pair
  const pairs = [];
  
  for (let i = 0; i < validBottles.length; i++) {
    for (let j = i + 1; j < validBottles.length; j++) {
      const bottle1 = validBottles[i];
      const bottle2 = validBottles[j];
      const data1 = bottle1.userData.notionData;
      const data2 = bottle2.userData.notionData;
      
      // Get all notes and accords for bottle 1
      const bottle1Notes = [
        ...(data1.accords || []),
        ...(data1.notes || []),
        ...(data1.topNotes || []),
        ...(data1.middleNotes || []),
        ...(data1.baseNotes || [])
      ].map(note => note.toLowerCase());
      
      // Get all notes and accords for bottle 2
      const bottle2Notes = [
        ...(data2.accords || []),
        ...(data2.notes || []),
        ...(data2.topNotes || []),
        ...(data2.middleNotes || []),
        ...(data2.baseNotes || [])
      ].map(note => note.toLowerCase());
      
      let layeringScore = 0;
      let contextualBoost = "";
      
      // 1. Check for complementary notes (base scoring)
      for (const note1 of bottle1Notes) {
        for (const [category, complementaryList] of Object.entries(complementaryCategories)) {
          // If bottle1 has a note in this category
          if (note1.includes(category)) {
            // Check if bottle2 has any complementary notes
            for (const note2 of bottle2Notes) {
              if (complementaryList.some(comp => note2.includes(comp))) {
                layeringScore += 3;
              }
            }
          }
        }
      }
      
      // 2. Check for overlap in notes (some overlap is good, but too much is redundant)
      const commonNotes = bottle1Notes.filter(note =>
        bottle2Notes.some(n2 => n2.includes(note) || note.includes(n2))
      );
      
      // Some common notes are good for coherence
      if (commonNotes.length > 0 && commonNotes.length <= 3) {
        layeringScore += 2;
      } else if (commonNotes.length > 3) {
        // Too much overlap is redundant
        layeringScore -= (commonNotes.length - 3);
      }
      
      // 3. Weather-based scoring
      const weatherPref = weatherLayeringPreferences[weatherCondition];
      if (weatherPref) {
        // First bottle has weather-appropriate base notes
        const hasWeatherBaseNotes = bottle1Notes.some(note =>
          weatherPref.baseNotes.some(wn => note.includes(wn)));
          
        // Second bottle has weather-appropriate complements
        const hasWeatherComplements = bottle2Notes.some(note =>
          weatherPref.complementsTo.some(wc => note.includes(wc)));
          
        if (hasWeatherBaseNotes && hasWeatherComplements) {
          layeringScore += 8;
          contextualBoost = weatherPref.description;
        } else if (hasWeatherBaseNotes || hasWeatherComplements) {
          layeringScore += 4;
          contextualBoost = weatherPref.description;
        }
        
        // Also check the reverse combination (bottle2 base + bottle1 complements)
        const hasReverseBaseNotes = bottle2Notes.some(note =>
          weatherPref.baseNotes.some(wn => note.includes(wn)));
          
        const hasReverseComplements = bottle1Notes.some(note =>
          weatherPref.complementsTo.some(wc => note.includes(wc)));
          
        if (hasReverseBaseNotes && hasReverseComplements) {
          layeringScore += 8;
          contextualBoost = weatherPref.description;
        } else if (hasReverseBaseNotes || hasReverseComplements) {
          layeringScore += 4;
          contextualBoost = weatherPref.description;
        }
      }
      
      // 4. Season-based scoring
      const seasonPref = seasonLayeringPreferences[currentSeason];
      if (seasonPref) {
        // Check if either bottle has notes preferred for this season
        const bottle1SeasonMatch = bottle1Notes.some(note =>
          seasonPref.preferred.some(sp => note.includes(sp)));
          
        const bottle2SeasonMatch = bottle2Notes.some(note =>
          seasonPref.preferred.some(sp => note.includes(sp)));
          
        if (bottle1SeasonMatch && bottle2SeasonMatch) {
          layeringScore += 6;
          if (!contextualBoost) contextualBoost = seasonPref.description;
        } else if (bottle1SeasonMatch || bottle2SeasonMatch) {
          layeringScore += 3;
          if (!contextualBoost) contextualBoost = seasonPref.description;
        }
        
        // Also check against bottle data's seasons if available
        if (data1.seasons && data1.seasons.includes(currentSeason)) {
          layeringScore += 3;
        }
        
        if (data2.seasons && data2.seasons.includes(currentSeason)) {
          layeringScore += 3;
        }
      }
      
      // 5. Time of day scoring
      const timePref = timeOfDayPreferences[currentTimeOfDay];
      if (timePref) {
        // Check if either bottle has notes preferred for this time of day
        const bottle1TimeMatch = bottle1Notes.some(note =>
          timePref.preferred.some(tp => note.includes(tp)));
          
        const bottle2TimeMatch = bottle2Notes.some(note =>
          timePref.preferred.some(tp => note.includes(tp)));
          
        if (bottle1TimeMatch && bottle2TimeMatch) {
          layeringScore += 4;
          if (!contextualBoost) contextualBoost = timePref.description;
        } else if (bottle1TimeMatch || bottle2TimeMatch) {
          layeringScore += 2;
          if (!contextualBoost) contextualBoost = timePref.description;
        }
      }
      
      // 6. Temperature adjustments (if available)
      if (currentTemperature !== null) {
        // For higher temperatures, favor fresh/light combinations
        if (currentTemperature > 25) { // Above 25°C/77°F
          const hasFreshNotes = bottle1Notes.some(note =>
            ['fresh', 'citrus', 'light', 'aquatic', 'marine'].some(n => note.includes(n))) ||
            bottle2Notes.some(note =>
            ['fresh', 'citrus', 'light', 'aquatic', 'marine'].some(n => note.includes(n)));
            
          if (hasFreshNotes) {
            layeringScore += 3;
            if (!contextualBoost) contextualBoost = "Refreshing for warm temperature";
          }
        }
        // For lower temperatures, favor warm/spicy combinations
        else if (currentTemperature < 15) { // Below 15°C/59°F
          const hasWarmNotes = bottle1Notes.some(note =>
            ['warm', 'spicy', 'vanilla', 'amber', 'woody'].some(n => note.includes(n))) ||
            bottle2Notes.some(note =>
            ['warm', 'spicy', 'vanilla', 'amber', 'woody'].some(n => note.includes(n)));
            
          if (hasWarmNotes) {
            layeringScore += 3;
            if (!contextualBoost) contextualBoost = "Warming for cool temperature";
          }
        }
      }
      
      // 7. Adjust score based on perfume type contrast
      if (data1.type && data2.type) {
        // Different types often layer well (men's + women's)
        if (data1.type !== data2.type) {
          layeringScore += 2;
        }
      }
      
      // 8. If houses are different, slightly increase score for variety
      if (data1.house && data2.house && data1.house !== data2.house) {
        layeringScore += 1;
      }
      
      // 9. If both have concentrations, consider them
      if (data1.concentration && data2.concentration) {
        // EDP + EDT often layer well (different evaporation rates)
        if (
          (data1.concentration.includes('Parfum') && data2.concentration.includes('Toilette')) ||
          (data1.concentration.includes('Toilette') && data2.concentration.includes('Parfum'))
        ) {
          layeringScore += 2;
        }
      }
      
      // The contextual boost will be stored when creating the pair object
      
      // Only include pairs with positive scores
      if (layeringScore > 0) {
        // Create the pair object with all relevant information
        const pairObject = {
          bottle1,
          bottle2,
          score: layeringScore,
          commonNotes: commonNotes,
          description: generateLayeringDescription(bottle1Notes, bottle2Notes, commonNotes),
          weatherContext: {
            condition: weatherCondition,
            season: currentSeason,
            timeOfDay: currentTimeOfDay,
            temperature: currentTemperature
          }
        };
        
        // Add contextual boost if available
        if (contextualBoost) {
          pairObject.contextBoost = contextualBoost;
        }
        
        pairs.push(pairObject);
      }
    }
  }
  
  // Sort by score (highest first)
  pairs.sort((a, b) => b.score - a.score);
  
  // Store top layering suggestions
  layeringSuggestions = pairs.slice(0, 4);
  
  // Display layering suggestions in the board
  displayLayeringSuggestionBoard();
  
  // Set layering mode active
  layeringActive = true;
  
  // Hide info board if visible
  hideInfoBoard();
}

/**
 * Generate a description of why these perfumes layer well together
 */
function generateLayeringDescription(notes1, notes2, commonNotes) {
  // Categories to highlight in the description
  const categories = [
    { name: 'fresh', keywords: ['fresh', 'citrus', 'marine', 'aquatic', 'green', 'ozonic'] },
    { name: 'floral', keywords: ['floral', 'rose', 'jasmine', 'lily', 'lavender', 'violet'] },
    { name: 'woody', keywords: ['woody', 'sandalwood', 'cedar', 'vetiver', 'pine', 'oud'] },
    { name: 'sweet', keywords: ['sweet', 'vanilla', 'honey', 'caramel', 'amber', 'coconut'] },
    { name: 'spicy', keywords: ['spicy', 'warm spicy', 'cinnamon', 'pepper', 'cardamom', 'clove'] },
    { name: 'fruity', keywords: ['fruity', 'apple', 'pear', 'cherry', 'peach', 'berry'] },
    { name: 'earthy', keywords: ['earthy', 'patchouli', 'moss', 'soil', 'petrichor', 'mushroom'] }
  ];
  
  // Find categories for each perfume
  const categories1 = findCategories(notes1, categories);
  const categories2 = findCategories(notes2, categories);
  
  // Generate different kinds of descriptions
  const descriptions = [];
  
  // Common notes
  if (commonNotes.length > 0) {
    descriptions.push(`Shared ${commonNotes.length === 1 ? 'note' : 'notes'} of ${joinWithAnd(commonNotes)} creates harmony`);
  }
  
  // Complementary categories
  const uniqueCategories1 = categories1.filter(c => !categories2.includes(c));
  const uniqueCategories2 = categories2.filter(c => !categories1.includes(c));
  
  if (uniqueCategories1.length > 0 && uniqueCategories2.length > 0) {
    descriptions.push(`${joinWithAnd(uniqueCategories1)} meets ${joinWithAnd(uniqueCategories2)}`);
  }
  
  // If no specific description generated, use a generic one
  if (descriptions.length === 0) {
    descriptions.push("Complementary note profiles");
  }
  
  return descriptions[Math.floor(Math.random() * descriptions.length)];
}

/**
 * Find categories that apply to a set of notes
 */
function findCategories(notes, categories) {
  const foundCategories = [];
  
  for (const category of categories) {
    for (const note of notes) {
      if (category.keywords.some(keyword => note.includes(keyword))) {
        if (!foundCategories.includes(category.name)) {
          foundCategories.push(category.name);
        }
      }
    }
  }
  
  return foundCategories;
}

/**
 * Helper function to join array elements with commas and "and"
 */
function joinWithAnd(arr) {
  if (arr.length === 0) return '';
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  
  return arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1];
}

/**
 * Display layering suggestion board with perfume pairs
 */
function displayLayeringSuggestionBoard() {
  const suggestionBoard = document.getElementById('suggestionBoard');
  const suggestionBoardContent = document.getElementById('suggestionBoardContent');
  const suggestionBoardHeader = document.getElementById('suggestionBoardHeader');
  const suggestionBoardFooter = document.getElementById('suggestionBoardFooter');
  
  if (!suggestionBoard || !suggestionBoardContent || !suggestionBoardHeader) return;
  
  // Clear previous content
  suggestionBoardContent.innerHTML = '';
  
  // Update header with current context
  if (layeringSuggestions.length > 0 && layeringSuggestions[0].weatherContext) {
    const context = layeringSuggestions[0].weatherContext;
    suggestionBoardHeader.innerHTML = `Perfume Layering Suggestions • ${context.condition.charAt(0).toUpperCase() + context.condition.slice(1)} • ${context.season} • ${context.timeOfDay}`;
  } else {
    suggestionBoardHeader.innerHTML = 'Perfume Layering Suggestions';
  }
  
  // Update footer
  if (suggestionBoardFooter) {
    suggestionBoardFooter.textContent = 'Press L to exit layering mode';
  }
  
  // Create layering suggestion items
  layeringSuggestions.forEach(suggestion => {
    const data1 = suggestion.bottle1.userData.notionData;
    const data2 = suggestion.bottle2.userData.notionData;
    
    const suggestionItem = document.createElement('div');
    suggestionItem.className = 'suggestion-item layering-suggestion';
    suggestionItem.style.display = 'flex';
    suggestionItem.style.flexDirection = 'column';
    suggestionItem.style.width = '300px';
    suggestionItem.style.maxWidth = '300px';
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'layering-title';
    titleDiv.innerHTML = `<strong>${data1.house || ''} ${data1.name || ''}</strong><br>+<br><strong>${data2.house || ''} ${data2.name || ''}</strong>`;
    titleDiv.style.marginBottom = '8px';
    
    const descriptionDiv = document.createElement('div');
    descriptionDiv.className = 'layering-description';
    
    // Use contextBoost if available, otherwise use general description
    if (suggestion.contextBoost) {
      descriptionDiv.textContent = suggestion.contextBoost;
      descriptionDiv.style.color = '#1E5AAB'; // Highlight context-specific suggestions
    } else {
      descriptionDiv.textContent = suggestion.description || 'Complementary notes';
      descriptionDiv.style.color = '#555';
    }
    
    descriptionDiv.style.fontSize = '12px';
    descriptionDiv.style.fontStyle = 'italic';
    
    const commonNotesDiv = document.createElement('div');
    commonNotesDiv.className = 'layering-common-notes';
    if (suggestion.commonNotes && suggestion.commonNotes.length > 0) {
      commonNotesDiv.innerHTML = `<span style="font-size:12px; color:#777;">Common notes: ${suggestion.commonNotes.join(', ')}</span>`;
    }
    
    suggestionItem.appendChild(titleDiv);
    suggestionItem.appendChild(descriptionDiv);
    suggestionItem.appendChild(commonNotesDiv);
    
    // Add click handler to select both bottles
    suggestionItem.addEventListener('click', () => {
      // Determine if we need to return any previously flying bottles
      const previousSource = sourceBottle;
      const previousTarget = targetBottle;
      
      // Clear any active bottle
      if (activeBottle) {
        activeBottle.userData.flying = false;
        activeBottle = null;
      }
      
      // Return previous bottles if they're not part of the new selection
      if (previousSource &&
          previousSource !== suggestion.bottle1 &&
          previousSource !== suggestion.bottle2) {
        previousSource.userData.flying = false;
        revertMark(previousSource);
      }
      
      if (previousTarget &&
          previousTarget !== suggestion.bottle1 &&
          previousTarget !== suggestion.bottle2) {
        previousTarget.userData.flying = false;
        revertMark(previousTarget);
      }
      
      // Mark the two bottles as source and target
      markAsSource(suggestion.bottle1);
      markAsTarget(suggestion.bottle2);
      
      // Make both bottles fly
      suggestion.bottle1.userData.flying = true;
      suggestion.bottle2.userData.flying = true;
      
      // Update the info board for the first bottle
      updateInfoBoard(suggestion.bottle1);
    });
    
    suggestionBoardContent.appendChild(suggestionItem);
  });
  
  // Show the board
  suggestionBoard.style.display = 'block';
}

/**
 * Clear all layering suggestions and return bottles to original state
 */
function clearLayeringSuggestions() {
  // Reset all bottles to their original state
  clickableBottles.forEach(bottle => {
    const highlightables = bottle.userData.highlightables || [];
    highlightables.forEach(h => {
      h.mesh.material.color.copy(h.originalColor);
    });
    
    // Stop flying and return to original position
    if (bottle.userData.flying) {
      bottle.userData.flying = false;
      // Make sure the bottle is at its original position
      if (bottle.userData.initialY !== undefined) {
        bottle.position.y = bottle.userData.initialY;
      }
    }
  });
  
  // Clear source and target bottles
  if (sourceBottle) {
    revertMark(sourceBottle);
    sourceBottle = null;
  }
  
  if (targetBottle) {
    revertMark(targetBottle);
    targetBottle = null;
  }
  
  // Clear the suggestions array
  layeringSuggestions = [];
  layeringActive = false;
  
  // Hide suggestion board
  const suggestionBoard = document.getElementById('suggestionBoard');
  if (suggestionBoard) {
    suggestionBoard.style.display = 'none';
  }
  
  // Hide info board
  hideInfoBoard();
}

/**
 * Display suggestion board with suggestion info and perfume items
 */
function displaySuggestionBoard(weatherCondition, season, timeOfDay) {
  const suggestionBoard = document.getElementById('suggestionBoard');
  const suggestionBoardContent = document.getElementById('suggestionBoardContent');
  const suggestionBoardHeader = document.getElementById('suggestionBoardHeader');
  
  if (!suggestionBoard || !suggestionBoardContent || !suggestionBoardHeader) return;
  
  // Clear previous content
  suggestionBoardContent.innerHTML = '';
  
  // Format weather condition for display
  const formattedWeather = weatherCondition.charAt(0).toUpperCase() + weatherCondition.slice(1);
  
  // Update header with weather, season, and time of day info
  suggestionBoardHeader.innerHTML = `Perfume Suggestions for ${formattedWeather} Weather - ${season} Season - ${timeOfDay} Time`;
  
  // Create suggestion items
  suggestedBottles.forEach(item => {
    const bottleData = item.data;
    const bottle = item.bottle;
    
    const suggestionItem = document.createElement('div');
    suggestionItem.className = 'suggestion-item';
    suggestionItem.dataset.bottleId = bottle.id; // Store reference to the bottle
    
    // Add house and name
    const house = document.createElement('div');
    house.className = 'suggestion-house';
    house.textContent = bottleData.house || 'Unknown House';
    
    const name = document.createElement('div');
    name.className = 'suggestion-name';
    name.textContent = bottleData.name || 'Unnamed Perfume';
    
    // Build item (notes display removed as requested)
    suggestionItem.appendChild(house);
    suggestionItem.appendChild(name);
    
    // Add click handler to focus on this bottle
    suggestionItem.addEventListener('click', () => {
      // Make this bottle active and make it fly out
      if (activeBottle) {
        activeBottle.userData.flying = false;
      }
      
      activeBottle = bottle;
      activeBottle.userData.flying = true; // Make the bottle fly out when clicked
      
      // Update the info board with this bottle's details
      updateInfoBoard(bottle);
      
      // This doesn't cancel suggestion mode, just focuses on one bottle
    });
    
    suggestionBoardContent.appendChild(suggestionItem);
  });
  
  // Show the board
  suggestionBoard.style.display = 'block';
}

// Expose function to set cap color from the UI
window.setCapColorUI = function(pageId, colorName) {
  if (activeBottle && activeBottle.userData.notionData.id === pageId) {
    setCapColor(activeBottle, colorName);
  }
};

// Clean up weather interval when window is unloaded
window.addEventListener('beforeunload', () => {
  if (weatherUpdateInterval) {
    clearInterval(weatherUpdateInterval);
  }
});