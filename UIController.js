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
let suggestionActive = false; // Track if suggestion mode is active
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
  
  // If in suggestion mode, ignore regular bottle interactions
  // except for those initiated from the suggestion board
  if (suggestionActive) {
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
  
  // Skip hover effects if filter box is visible or in suggestion mode
  if (isFilterBoxVisible() || suggestionActive) return;
  
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

  // Skip if filter box visible or in suggestion mode
  if (isFilterBoxVisible() || suggestionActive) return;
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

    const bottleTokens = [
      ...nameTokens,
      ...houseTokens,
      ...accordsTokens,
      ...seasonTokens,
      ...typeTokens
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
  
  // Map weather conditions to appropriate fragrance accords
  const weatherAccordMap = {
    'clear': ['fresh', 'citrus', 'fresh spicy', 'aromatic', 'fruity', 'green'],
    'clouds': ['woody', 'amber', 'musky', 'powdery', 'earthy'],
    'rain': ['marine', 'aquatic', 'ozonic', 'fresh', 'green'],
    'thunderstorm': ['woody', 'earthy', 'oud', 'smoky', 'leather'],
    'snow': ['vanilla', 'warm spicy', 'almond', 'balsamic', 'powdery'],
    'mist': ['musky', 'marine', 'ozonic', 'metallic', 'salty']
  };
  
  // Get suggested accords based on weather
  const suggestedAccords = weatherAccordMap[weatherCondition] || ['fresh', 'woody', 'citrus'];
  
  // Find perfumes that match the weather condition and current season
  suggestedBottles = [];
  
  clickableBottles.forEach(bottle => {
    const bottleData = bottle.userData.notionData;
    if (!bottleData) return;
    
    const bottleAccords = bottleData.accords || [];
    const bottleSeasons = bottleData.seasons || [];
    
    // Calculate match score - higher is better
    let matchScore = 0;
    
    // Accord matching
    for (const accord of bottleAccords) {
      const accordLower = accord.toLowerCase();
      if (suggestedAccords.some(sa => accordLower.includes(sa))) {
        matchScore += 3; // Strong match with weather-appropriate accord
      }
    }
    
    // Season matching
    if (bottleSeasons.includes(currentSeason)) {
      matchScore += 5; // Strong boost for matching the current season
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
  
  // Highlight the suggested bottles
  highlightSuggestedBottles(suggestedBottleObjects);
  
  // Display suggestions in the board
  displaySuggestionBoard(weatherCondition, currentSeason);
  
  // Set suggestion mode active - this will disable regular bottle interactions
  suggestionActive = true;
  
  // Hide info board if visible
  hideInfoBoard();
}

/**
 * Highlight the suggested bottles in yellow
 * @param {Array} bottleObjects - Array of bottle objects to highlight
 */
function highlightSuggestedBottles(bottleObjects) {
  bottleObjects.forEach(bottle => {
    const highlightables = bottle.userData.highlightables || [];
    highlightables.forEach(h => {
      // Store original color if not already stored
      if (!h.originalSuggestionColor) {
        h.originalSuggestionColor = h.mesh.material.color.clone();
      }
      
      // Set to yellow
      h.mesh.material.color.set(0xffff00); // Yellow highlight
    });
    
    // Make the bottle fly to draw attention
    if (!bottle.userData.flying) {
      bottle.userData.flying = true;
    }
  });
}

/**
 * Clear all suggestions and return bottles to original state
 */
function clearSuggestions() {
  // Get just the bottle objects from suggestions
  const bottleObjects = suggestedBottles.map(item =>
    item.bottle ? item.bottle : item
  ).filter(bottle => bottle);
  
  bottleObjects.forEach(bottle => {
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
  
  // Hide suggestion board
  const suggestionBoard = document.getElementById('suggestionBoard');
  if (suggestionBoard) {
    suggestionBoard.style.display = 'none';
  }
}

/**
 * Display suggestion board with suggestion info and perfume items
 */
function displaySuggestionBoard(weatherCondition, season) {
  const suggestionBoard = document.getElementById('suggestionBoard');
  const suggestionBoardContent = document.getElementById('suggestionBoardContent');
  const suggestionBoardHeader = document.getElementById('suggestionBoardHeader');
  
  if (!suggestionBoard || !suggestionBoardContent || !suggestionBoardHeader) return;
  
  // Clear previous content
  suggestionBoardContent.innerHTML = '';
  
  // Format weather condition for display
  const formattedWeather = weatherCondition.charAt(0).toUpperCase() + weatherCondition.slice(1);
  
  // Update header with weather and season info
  suggestionBoardHeader.innerHTML = `Perfume Suggestions for ${formattedWeather} Weather - ${season} Season`;
  
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
    
    // Add accords if available
    const accords = document.createElement('div');
    accords.className = 'suggestion-accords';
    
    if (bottleData.accords && bottleData.accords.length > 0) {
      // Take just first 3 accords to keep it compact
      const topAccords = bottleData.accords.slice(0, 3);
      
      topAccords.forEach(accord => {
        const accordTag = document.createElement('span');
        accordTag.className = 'suggestion-accord';
        accordTag.textContent = accord;
        accords.appendChild(accordTag);
      });
    }
    
    // Build item
    suggestionItem.appendChild(house);
    suggestionItem.appendChild(name);
    suggestionItem.appendChild(accords);
    
    // Add click handler to focus on this bottle
    suggestionItem.addEventListener('click', () => {
      // Make this bottle active and flying
      if (activeBottle) {
        activeBottle.userData.flying = false;
      }
      
      activeBottle = bottle;
      activeBottle.userData.flying = true;
      
      // Update position to make bottle visible
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