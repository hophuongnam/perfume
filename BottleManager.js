/**
 * BottleManager.js
 * Handles Notion data fetching, bottle creation, flying updates, and occupant management.
 */

import * as THREE from 'three';
import { scene, camera, envMap } from './SceneManager.js';
import { planeLayouts, slotOccupants, SLOT_WIDTH_DEPTH, BOTTLE_HEIGHT } from './RackBuilder.js';

// List of all bottle groups that can be clicked
export const clickableBottles = [];

// Shared geometries for performance optimization
const bottleWidth = 10;
const bottleDepth = 10;
const capHeight = 15;
const capRadius = 5;

// Create geometries once and reuse them for all bottles
const sharedBottleGeo = new THREE.BoxGeometry(bottleWidth, BOTTLE_HEIGHT, bottleDepth);
const sharedCapGeo = new THREE.CylinderGeometry(capRadius, capRadius, capHeight, 32);
const sharedLabelGeo = new THREE.PlaneGeometry(bottleWidth, BOTTLE_HEIGHT / 2);

/**
 * 1) Fetch all bottles from Notion
 */
export async function fetchAllNotionBottles() {
  try {
    const response = await fetch('/api/bottles');
    if (!response.ok) {
      throw new Error(`Failed to fetch /api/bottles. Status = ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    console.error('fetchAllNotionBottles error:', err);
    return [];
  }
}

/**
 * 2) Create a bottle in the scene from Notion data
 */
export function createBottleFromNotion(bData) {
  try {
    const { plane, row, column, name, capColor, id, house, accords, type } = bData;
    if (!planeLayouts[plane]) {
      console.warn(`No plane layout found for plane=${plane}`);
      return;
    }

    const slot = planeLayouts[plane].find(s => s.row === row && s.column === column);
    if (!slot) {
      console.warn(`No slot found for plane=${plane}, row=${row}, column=${column}`);
      return;
    }

    const bottleGroup = new THREE.Group();
    // Use the pre-defined dimensions from shared geometries
    // We still need bottleHeight defined for positioning calculations
    const bottleHeight = BOTTLE_HEIGHT;
    
    // Bottle mesh - use shared geometry
    const glassColorHex = getBottleGlassColor(bData);
  
    const bottleMat = new THREE.MeshPhysicalMaterial({
      color: glassColorHex,
      metalness: 0.1,
      roughness: 0.05,
      transmission: 0.95,  // Higher transmission
      thickness: 1.0,      // Increase thickness
      ior: 1.45,           // More accurate IOR for perfume bottles
      attenuationDistance: 5.0,  // Increased for more realistic color absorption
      attenuationColor: new THREE.Color(glassColorHex).multiplyScalar(0.8),
      envMapIntensity: 2.0,
      clearcoat: 0.5,
      clearcoatRoughness: 0.03,
      specularIntensity: 1.0,
      specularColor: new THREE.Color(0xffffff),
      transparent: true,
      opacity: 0.95,
      // Enable for CSM
      customProgramCacheKey: () => 'MeshPhysicalMaterial' // Helps with CSM material compatibility
      // Note: envMap is now set via scene.environment in SceneManager.js
    });
    const bottleMesh = new THREE.Mesh(sharedBottleGeo, bottleMat);
    bottleMesh.position.set(0, bottleHeight/2, 0);
    bottleMesh.castShadow = true;
    bottleMesh.receiveShadow = true;
    
    // Add liquid inside the bottle
    const liquidColor = getLiquidColor(bData);
    const fillPercentage = getFillPercentage(bData);
    addLiquidToBottle(bottleMesh, fillPercentage, liquidColor);

    // Label - use shared geometry
    const labelTexture = createLabelTexture(name || "(No Name)", house);
    const labelMat = new THREE.MeshStandardMaterial({
      map: labelTexture,
      side: THREE.DoubleSide,
      transparent: true,
      roughness: 0.7,
      metalness: 0.0
    });
    const labelMesh = new THREE.Mesh(sharedLabelGeo, labelMat);
    labelMesh.position.set(0, 0, bottleDepth/2 + 0.01);
    bottleMesh.add(labelMesh);

    // Cap - use shared geometry
    let capMetalness = 1.0;
    let capRoughness = 0.2;

    if (capColor === 'Gold') {
      capMetalness = 1.0;
      capRoughness = 0.1;
    } else if (capColor === 'Silver') {
      capMetalness = 0.95;
      capRoughness = 0.1;
    } else if (capColor === 'Black') {
      capMetalness = 0.8;
      capRoughness = 0.3;
    }
    const capMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      roughness: capRoughness,
      metalness: capMetalness,
      envMap: envMap
    });
    if (capColor) {
      try {
        capMat.color.setStyle(capColor);
      } catch {
        capMat.color.set(0xffd700);
      }
    }
    const capMesh = new THREE.Mesh(sharedCapGeo, capMat);
    capMesh.position.set(0, bottleHeight + capHeight/2, 0);
    capMesh.castShadow = true;
    capMesh.receiveShadow = true;

    bottleGroup.add(bottleMesh);
    bottleGroup.add(capMesh);

    bottleGroup.position.set(slot.x, slot.y, slot.z);
    bottleGroup.userData = {
      initialY: slot.y,
      flying: false,
      notionData: bData,
      plane: plane,
      row: row,
      column: column,
      house: house,
      accords: accords,
      type: type,
      highlightables: [
        { mesh: bottleMesh, originalColor: bottleMesh.material.color.clone() },
        { mesh: capMesh,    originalColor: capMesh.material.color.clone() }
      ]
    };

    clickableBottles.push(bottleGroup);
    scene.add(bottleGroup);

    const key = `${plane}-${row}-${column}`;
    if (slotOccupants[key]) {
      console.warn(`Multiple occupant in slot ${key}: occupant = ${slotOccupants[key].userData.notionData.name}, new occupant = ${name}`);
    }
    slotOccupants[key] = bottleGroup;
  } catch (err) {
    console.error('Error creating bottle from Notion data:', err, bData);
  }
}

/**
 * Called each frame by SceneManager to animate "flying" bottles
 * We handle the rise/fall, plus creation/removal of any floating label boards.
 */
const MOVE_SPEED  = 2;
const FLY_OFFSET  = 32;

export function updateBottles(activeBottle) {
  clickableBottles.forEach(bottle => {
    if (bottle.userData.flying !== undefined) {
      const initialY = bottle.userData.initialY;
      const targetY  = initialY + FLY_OFFSET;

      if (bottle.userData.flying) {
        if (bottle.position.y < targetY) {
          bottle.position.y += MOVE_SPEED;
          if (bottle.position.y > targetY) {
            bottle.position.y = targetY;
          }
        }
        // Attach or update the floating board
        if (!bottle.userData.boardMesh) {
          const line3 = `Col: ${bottle.userData.column}, Row: ${bottle.userData.row}`;
          const line4 = bottle.userData.noticeLine4 || "";
          bottle.userData.boardMesh = createBoardMesh(
            bottle.userData.notionData.house || "Unknown House",
            bottle.userData.notionData.name  || "No Name",
            line3,
            line4
          );
          bottle.add(bottle.userData.boardMesh);
          bottle.userData.boardMesh.position.set(0, BOTTLE_HEIGHT + 40, 0);
        }
        // Slight float animation
        const now = Date.now();
        const floatOffset = Math.sin(now * 0.002) * 2;
        bottle.userData.boardMesh.position.y = BOTTLE_HEIGHT + 40 + floatOffset;
        // Face the camera
        bottle.userData.boardMesh.lookAt(camera.position);

      } else {
        // dropping down
        if (bottle.position.y > initialY) {
          bottle.position.y -= MOVE_SPEED;
          if (bottle.position.y < initialY) {
            bottle.position.y = initialY;
          }
        }
        // remove board mesh if any
        if (bottle.userData.boardMesh) {
          bottle.remove(bottle.userData.boardMesh);
          bottle.userData.boardMesh.geometry.dispose();
          if (bottle.userData.boardMesh.material.map) {
            bottle.userData.boardMesh.material.map.dispose();
          }
          bottle.userData.boardMesh.material.dispose();
          bottle.userData.boardMesh = null;
        }
      }
    }
  });
}

/**
 * Helper to pick glass color from accords or house
 */
function getBottleGlassColor(bottleData) {
  let glassColor = 0xF0F8FF; // default subtle light-blue glass
  if (bottleData.accords && bottleData.accords.length > 0) {
    const accordColorMap = {
      'floral': 0xFFF0F5,
      'woody': 0xF5DEB3,
      'fresh': 0xE0FFFF,
      'citrus': 0xFFFACD,
      'spicy': 0xFFE4B5,
      'sweet': 0xFFE4E1,
      'amber': 0xFFD700,
      'powdery': 0xFFF0F5,
      'aromatic': 0xF0FFF0,
      'fruity': 0xFFF0F5,
      'green': 0xF0FFF0,
      'marine': 0xE0FFFF,
      'vanilla': 0xFFF8DC,
      'oud': 0xDEB887,
      'leather': 0xD2B48C,
      'musky': 0xE6E6FA
    };
    for (const accord of bottleData.accords) {
      const lowerAccord = accord.toLowerCase();
      for (const [key, color] of Object.entries(accordColorMap)) {
        if (lowerAccord.includes(key)) {
          glassColor = color;
          break;
        }
      }
    }
  }
  if (bottleData.house) {
    const houseLower = bottleData.house.toLowerCase();
    if (houseLower.includes('dior')) {
      glassColor = 0xF0F8FF;
    } else if (houseLower.includes('chanel')) {
      glassColor = 0xFFFAFA;
    } else if (houseLower.includes('guerlain')) {
      glassColor = 0xFFF5EE;
    }
  }
  return glassColor;
}

/**
 * Get the appropriate liquid color based on accords and type
 */
function getLiquidColor(bottleData) {
  // Default liquid color (light amber)
  let liquidColor = 0xf5e9d5;
  
  // Determine liquid color based on accords
  if (bottleData.accords && bottleData.accords.length > 0) {
    const liquidColorMap = {
      'oud': 0x3a2710,        // Deep brown
      'leather': 0x4d341e,    // Brown
      'tobacco': 0x654321,    // Dark brown
      'coffee': 0x3b2417,     // Coffee brown
      'amber': 0xd4a76a,      // Amber
      'vanilla': 0xf3e5ab,    // Cream vanilla
      'woody': 0x9a7b4f,      // Medium brown
      'caramel': 0xc68e3c,    // Caramel
      'honey': 0xe8b923,      // Honey
      'spicy': 0xb5651d,      // Spice brown
      'warm spicy': 0xb76e2e, // Cinnamon
      'citrus': 0xfff9c4,     // Light yellow
      'fruity': 0xffcce5,     // Pink
      'cherry': 0xcc0033,     // Cherry red
      'floral': 0xffe6f2,     // Light pink
      'rose': 0xff9999,       // Rose pink
      'white floral': 0xf8f8ff, // White
      'yellow floral': 0xfff9e0, // Pale yellow
      'fresh': 0xe6f2ff,      // Light blue
      'marine': 0xaee7f8,     // Aqua blue
      'aquatic': 0xadd8e6,    // Light blue
      'aromatic': 0xd6e8be,   // Light green
      'green': 0xd9ead3,      // Pale green
      'musky': 0xe6e6fa,      // Lavender
      'powdery': 0xf5f5f5,    // Almost white
      'iris': 0xdcd1f0,       // Pale purple
      'salty': 0xf5f5f5,      // White
      'metallic': 0xdfe2e3,   // Silver
      'lavender': 0xe6e6fa,   // Lavender
      'alcohol': 0xfffaf0,    // Clear
      'ozonic': 0xf0f8ff,     // Very light blue
      'balsamic': 0x8c6b3f,   // Dark honey
      'animalic': 0x5e4e41,   // Dark taupe
      'almond': 0xf0e6d8,     // Light almond
      'mossy': 0x606e3c,      // Olive green
      'earthy': 0x7d734a,     // Earth brown
      'patchouli': 0x79553d,  // Dark amber
      'anis': 0xd6e6d6        // Pale green
    };
    
    for (const accord of bottleData.accords) {
      const lowerAccord = accord.toLowerCase();
      for (const [key, color] of Object.entries(liquidColorMap)) {
        if (lowerAccord.includes(key)) {
          liquidColor = color;
          break;
        }
      }
    }
  }
  
  // Adjust based on perfume type
  if (bottleData.type) {
    const typeLower = bottleData.type.toLowerCase();
    if (typeLower.includes('men')) {
      // Slightly darken for men's fragrances
      const color = new THREE.Color(liquidColor);
      color.multiplyScalar(0.85);
      liquidColor = color.getHex();
    } else if (typeLower.includes('unisex')) {
      // No adjustment for unisex
    } else if (typeLower.includes('women')) {
      // Slightly lighten for women's fragrances
      const color = new THREE.Color(liquidColor);
      color.multiplyScalar(1.15);
      liquidColor = color.getHex();
    }
  }
  
  return liquidColor;
}

/**
 * Determine fill percentage based on volume property or random value
 */
function getFillPercentage(bottleData) {
  // Default fill level of 75%
  let fillPercentage = 0.75;
  
  // If we have a volume, use that to determine fill level
  if (bottleData.volume) {
    // Smaller volumes (like samples) tend to be fuller
    const volumeMap = {
      '2': 0.9,
      '5': 0.85,
      '6': 0.85,
      '7': 0.85,
      '8': 0.8,
      '9': 0.8,
      '10': 0.8,
      '12.5': 0.75,
      '15': 0.75,
      '20': 0.75,
      '30': 0.75,
      '35': 0.7,
      '40': 0.7,
      '45': 0.7,
      '50': 0.7
    };
    
    if (volumeMap[bottleData.volume]) {
      fillPercentage = volumeMap[bottleData.volume];
    }
  } else {
    // If no volume info, add a bit of randomness to make bottles look different
    // Between 65% and 85% full
    fillPercentage = 0.65 + Math.random() * 0.2;
  }
  
  return fillPercentage;
}

/**
 * Add liquid inside bottle
 */
function addLiquidToBottle(bottleMesh, fillPercentage = 0.75, liquidColor = 0xf5e9d5) {
  // Create slightly smaller inner mesh for the liquid
  const bottleWidth = 9;  // Slightly smaller than bottle
  const bottleDepth = 9;
  const liquidHeight = BOTTLE_HEIGHT * fillPercentage;
  
  // For liquids, we need to create individual geometries since the height varies based on fill percentage
  const liquidGeo = new THREE.BoxGeometry(bottleWidth, liquidHeight, bottleDepth);
  const liquidMat = new THREE.MeshPhysicalMaterial({
    color: liquidColor,
    metalness: 0.0,
    roughness: 0.15,
    transmission: 0.7,
    ior: 1.33,  // Water/alcohol
    envMapIntensity: 0.8
  });
  
  const liquidMesh = new THREE.Mesh(liquidGeo, liquidMat);
  liquidMesh.position.y = -BOTTLE_HEIGHT * (1 - fillPercentage) / 2;
  bottleMesh.add(liquidMesh);
  
  return liquidMesh;
}

function createLabelTexture(text, houseText) {
  const canvas  = document.createElement('canvas');
  canvas.width  = 512;  // Increased for better resolution
  canvas.height = 1024;
  const ctx     = canvas.getContext('2d');

  // Create elegant background with gradient
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, "#f8f8f8");
  gradient.addColorStop(0.5, "#ffffff");
  gradient.addColorStop(1, "#f8f8f8");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Add decorative border
  ctx.strokeStyle = "#d0d0d0";
  ctx.lineWidth = 8;
  ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);
  
  // Add inner subtle border
  ctx.strokeStyle = "#e0e0e0";
  ctx.lineWidth = 2;
  ctx.strokeRect(32, 32, canvas.width - 64, canvas.height - 64);

  // Rotate for vertical text (perfume bottles often have vertical labels)
  ctx.save();
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);
  
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  
  // Draw house name (smaller, at top)
  ctx.font = "bold 50px 'Palatino', serif";
  ctx.fillStyle = "#666666";
  ctx.fillText(houseText || "Unknown House", canvas.height / 2, canvas.width / 4);
  
  // Decorative divider
  ctx.strokeStyle = "#d0d0d0";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(canvas.height / 2 - 120, canvas.width / 2 - 20);
  ctx.lineTo(canvas.height / 2 + 120, canvas.width / 2 - 20);
  ctx.stroke();
  
  // Draw perfume name (larger, below divider)
  ctx.font = "bold 70px 'Palatino', serif";
  ctx.fillStyle = "#333333";
  ctx.fillText(text, canvas.height / 2, canvas.width / 2 + 50);
  
  ctx.restore();

  // Apply a subtle vignette effect for elegance
  const radialGradient = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, canvas.width / 4,
    canvas.width / 2, canvas.height / 2, canvas.width
  );
  radialGradient.addColorStop(0, "rgba(255, 255, 255, 0)");
  radialGradient.addColorStop(1, "rgba(230, 230, 230, 0.3)");
  ctx.fillStyle = radialGradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createBoardMesh(house, name, line3, line4) {
  const width  = 512;  // Wider for more elegant layout
  const height = 320;  // Taller to accommodate more information
  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  function clipAndFillText(context, txt, maxW, x, y, fontStyle="20px 'Palatino', serif") {
    context.font = fontStyle;
    let clipped = txt;
    const ellipsis = '…';
    while (clipped.length > 0 && context.measureText(clipped + ellipsis).width > maxW) {
      clipped = clipped.slice(0, -1);
    }
    if (clipped !== txt) {
      clipped += ellipsis;
    }
    context.fillText(clipped, x, y);
  }

  // Create a sophisticated background gradient
  const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
  bgGradient.addColorStop(0, "#f0f5ff");
  bgGradient.addColorStop(1, "#e6f0ff");
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  // Add subtle pattern
  ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const size = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  // Add elegant border with shadow effect
  ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
  ctx.shadowBlur = 15;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 5;
  
  // Gold/bronze border
  const borderGradient = ctx.createLinearGradient(0, 0, width, height);
  borderGradient.addColorStop(0, "#d4af37");  // Gold
  borderGradient.addColorStop(0.5, "#f9f7e8"); // Light gold
  borderGradient.addColorStop(1, "#cd7f32");  // Bronze
  ctx.strokeStyle = borderGradient;
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, width - 16, height - 16);
  
  // Reset shadow
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Elegant inner panel
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.fillRect(20, 20, width - 40, height - 40);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // House name (elegant, smaller font)
  ctx.fillStyle = "#666";
  ctx.shadowColor = "rgba(0, 0, 0, 0.1)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  clipAndFillText(ctx, house, width - 80, width / 2, 60, "italic 28px 'Palatino', serif");
  
  // Reset shadow
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Decorative divider
  const dividerGradient = ctx.createLinearGradient(width/4, 0, width*3/4, 0);
  dividerGradient.addColorStop(0, "rgba(212, 175, 55, 0.3)"); // Transparent gold
  dividerGradient.addColorStop(0.5, "rgba(212, 175, 55, 1)"); // Solid gold
  dividerGradient.addColorStop(1, "rgba(212, 175, 55, 0.3)"); // Transparent gold
  
  ctx.strokeStyle = dividerGradient;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width/4, 90);
  ctx.lineTo(width*3/4, 90);
  ctx.stroke();

  // Perfume Name (larger, bold, central)
  ctx.fillStyle = "#000";
  ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  clipAndFillText(ctx, name, width - 80, width / 2, 140, "bold 38px 'Palatino', serif");
  
  // Reset shadow
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Another decorative divider
  ctx.strokeStyle = dividerGradient;
  ctx.beginPath();
  ctx.moveTo(width/4, 190);
  ctx.lineTo(width*3/4, 190);
  ctx.stroke();

  // Position Info (clear, modern)
  ctx.fillStyle = "#333";
  clipAndFillText(ctx, line3, width - 80, width / 2, 230, "22px 'Arial', sans-serif");

  // Additional Info (accent color)
  ctx.fillStyle = "#1E5AAB";
  clipAndFillText(ctx, line4, width - 80, width / 2, 270, "bold 22px 'Arial', sans-serif");

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  // Larger board geometry to match the new texture size
  const boardGeo = new THREE.PlaneGeometry(80, 60);
  const boardMat = new THREE.MeshBasicMaterial({
    map: tex,
    side: THREE.DoubleSide,
    transparent: true
  });
  const boardMesh = new THREE.Mesh(boardGeo, boardMat);
  boardMesh.renderOrder = 9999;
  return boardMesh;
}

/**
 * Update the cap color on the server
 */
export async function updateBottleCapColorOnServer(pageId, capColor) {
  try {
    const resp = await fetch('/api/updateBottleCap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId, capColor })
    });
    if (!resp.ok) {
      console.error("Failed to update Notion for bottle cap color:", pageId, resp.status);
    }
  } catch (err) {
    console.error("Error calling /api/updateBottleCap:", err);
  }
}

/**
 * Exposed utility to set bottle cap color in scene + update server
 */
export function setCapColor(bottle, colorName) {
  const highlightables = bottle.userData.highlightables;
  if (!highlightables || highlightables.length < 2) return;
  const capEntry = highlightables[1];

  let metalness = 1.0;
  let roughness = 0.2;

  if (colorName === 'Gold') {
    metalness = 1.0;
    roughness = 0.1;
  } else if (colorName === 'Silver') {
    metalness = 0.95;
    roughness = 0.1;
  } else if (colorName === 'Black') {
    metalness = 0.8;
    roughness = 0.3;
  }

  capEntry.mesh.material.metalness = metalness;
  capEntry.mesh.material.roughness = roughness;

  try {
    capEntry.mesh.material.color.setStyle(colorName);
    capEntry.originalColor.setStyle(colorName);
  } catch (err) {
    console.warn('Invalid color style, defaulting to gold');
    capEntry.mesh.material.color.setStyle('Gold');
    capEntry.originalColor.setStyle('Gold');
  }

  bottle.userData.notionData.capColor = colorName;
  updateBottleCapColorOnServer(bottle.userData.notionData.id, colorName);
}

/**
 * Update bottle slot on server (plane, row, col)
 */
export async function updateBottleSlotOnServer(pageId, plane, row, column) {
  try {
    const resp = await fetch('/api/updateBottleSlot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId, plane, row, column })
    });
    if (!resp.ok) {
      console.error("Failed to update Notion for bottle:", pageId, resp.status);
    }
  } catch (err) {
    console.error("Error calling /api/updateBottleSlot:", err);
  }
}