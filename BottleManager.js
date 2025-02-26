/**
 * BottleManager.js
 * Handles Notion data fetching, bottle creation, flying updates, and occupant management.
 */

import * as THREE from 'three';
import { scene, camera, envMap } from './SceneManager.js';
import { planeLayouts, slotOccupants, SLOT_WIDTH_DEPTH, BOTTLE_HEIGHT } from './RackBuilder.js';

// List of all bottle groups that can be clicked
export const clickableBottles = [];

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
    const bottleWidth  = 10;
    const bottleDepth  = 10;
    const bottleHeight = BOTTLE_HEIGHT;
    const capHeight    = 15;
    const capRadius    = 5;

    // Bottle mesh
    const bottleGeo = new THREE.BoxGeometry(bottleWidth, bottleHeight, bottleDepth);
    const glassColorHex = getBottleGlassColor(bData);

    const bottleMat = new THREE.MeshPhysicalMaterial({
      color: glassColorHex,
      metalness: 0.0,
      roughness: 0.01,
      transmission: 0.92,
      thickness: 1.8,
      envMap: envMap,
      envMapIntensity: 1.5,
      clearcoat: 0.7,
      clearcoatRoughness: 0.05,
      ior: 1.52,
      transparent: true,
      opacity: 0.92,
      reflectivity: 0.2
    });
    const bottleMesh = new THREE.Mesh(bottleGeo, bottleMat);
    bottleMesh.position.set(0, bottleHeight/2, 0);
    bottleMesh.castShadow = true;
    bottleMesh.receiveShadow = true;

    // Label
    const labelWidth  = bottleWidth;
    const labelHeight = bottleHeight / 2;
    const labelGeo = new THREE.PlaneGeometry(labelWidth, labelHeight);
    const labelTexture = createLabelTexture(name || "(No Name)");
    const labelMat = new THREE.MeshStandardMaterial({
      map: labelTexture,
      side: THREE.DoubleSide,
      transparent: true,
      roughness: 0.7,
      metalness: 0.0
    });
    const labelMesh = new THREE.Mesh(labelGeo, labelMat);
    labelMesh.position.set(0, 0, bottleDepth/2 + 0.01);
    bottleMesh.add(labelMesh);

    // Cap
    const capGeo = new THREE.CylinderGeometry(capRadius, capRadius, capHeight, 32);
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
    const capMesh = new THREE.Mesh(capGeo, capMat);
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

function createLabelTexture(text) {
  const canvas  = document.createElement('canvas');
  canvas.width  = 256;
  canvas.height = 819;
  const ctx     = canvas.getContext('2d');

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font         = "60px Arial";
  ctx.fillStyle    = "#000000";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";

  ctx.save();
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(text, canvas.height / 2, canvas.width / 2);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createBoardMesh(house, name, line3, line4) {
  const width  = 384;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  function clipAndFillText(context, txt, maxW, x, y, fontStyle="20px Arial") {
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

  // background gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#f0f8ff");
  gradient.addColorStop(1, "#e6f2ff");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#4682b4";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, width - 8, height - 8);

  ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
  ctx.fillRect(12, 12, width - 24, height - 24);

  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.fillRect(12, 12, width - 24, height - 24);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // line1: House
  ctx.fillStyle = "#444";
  clipAndFillText(ctx, house, 320, width / 2, 48, "bold 24px Arial");

  // line2: Name
  ctx.fillStyle = "#000";
  clipAndFillText(ctx, name, 320, width / 2, 100, "bold 32px Arial");

  // separator
  ctx.strokeStyle = "#4682b4";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width/4, 140);
  ctx.lineTo(width*3/4, 140);
  ctx.stroke();

  // line3
  ctx.fillStyle = "#333";
  clipAndFillText(ctx, line3, 320, width / 2, 180, "18px Arial");

  // line4
  ctx.fillStyle = "#1E5AAB";
  clipAndFillText(ctx, line4, 320, width / 2, 220, "bold 18px Arial");

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;

  const boardGeo = new THREE.PlaneGeometry(64, 48);
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