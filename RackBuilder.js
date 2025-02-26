/**
 * RackBuilder.js
 * Builds shelves (planes), racks, and keeps track of slot layouts.
 */

import * as THREE from 'three';
import { scene, envMap } from './SceneManager.js';
import { RectAreaLightHelper } from 'RectAreaLightHelper';

/**
 * Because original code references these as constants, define them here
 * so they can be shared easily for rack building.
*/
export const SLOT_WIDTH_DEPTH = 15;
export const BOTTLE_HEIGHT = 64;

export const planeLayouts = {};   // planeLayouts[planeNumber] = array of slot objects
export const slotOccupants = {}; // "plane-row-column" => bottleGroup

// We'll store racks definitions from environment config
export const racks = {};

/**
 * Build all planes based on config (planeP1..planeP4), using parsePlaneDefinition() and parseSingleRack().
 * planeIndex: 1..4
 */
export function buildAllPlanes(config) {
  // First ensure planeLayouts for planes 1..4
  for (let i = 1; i <= 4; i++) {
    planeLayouts[i] = [];
  }

  const planeKeys = ["planeP1","planeP2","planeP3","planeP4"];
  let currentPlaneY = 0;

  planeKeys.forEach((planeKey, index) => {
    const definition = config[planeKey];
    if (!definition) return;

    const planeNumber = index + 1;
    const rackIds = parsePlaneDefinition(definition);
    if (!rackIds || !rackIds.length) return;

    const planeGroup = new THREE.Group();
    planeGroup.position.set(0, currentPlaneY, index * 12 * SLOT_WIDTH_DEPTH);
    scene.add(planeGroup);

    let rowIndexBase = 0;
    let rowStackOffset = 0;
    const offsetRack = parseFloat(config.offsetRack) || 1;

    rackIds.forEach(rackId => {
      const rDef = racks[rackId] || { rows:0, columns:0 };
      if (rDef.rows <= 0 || rDef.columns <= 0) {
        console.warn("No valid definition for rackId =", rackId);
        return;
      }

      const rows    = rDef.rows;
      const columns = rDef.columns;
      const { group: rackGroup, rowHeights } = createSteppedRack(rows, columns);
      const rackDepth = rows * SLOT_WIDTH_DEPTH;

      rackGroup.position.z = -rowStackOffset;
      planeGroup.add(rackGroup);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns; c++) {
          const totalWidth = columns * SLOT_WIDTH_DEPTH;
          const slotCenterX = -(totalWidth / 2) + c*SLOT_WIDTH_DEPTH + SLOT_WIDTH_DEPTH/2;
          const slotCenterZ = (rackDepth / 2) - r*SLOT_WIDTH_DEPTH - (SLOT_WIDTH_DEPTH / 2);
          const worldX = slotCenterX;
          const worldY = currentPlaneY + rowHeights[r];
          const worldZ = planeGroup.position.z + rackGroup.position.z + slotCenterZ;

          planeLayouts[planeNumber].push({
            plane: planeNumber,
            row: rowIndexBase + r + 1,
            column: c + 1,
            x: worldX,
            y: worldY,
            z: worldZ
          });
        }
      }

      rowIndexBase += rows;
      rowStackOffset += rackDepth;
      rowStackOffset += offsetRack * rackDepth;
    });

    const planeVerticalOffset = parseFloat(config.planeVerticalOffset) || 2;
    currentPlaneY -= planeVerticalOffset * BOTTLE_HEIGHT;
  });

  // Once planes are built, add overhead lights for each plane
  addPlaneLights();
}

/**
 * Parse a single plane definition, e.g. "R1 x R2" => ["R1","R2"]
 */
export function parsePlaneDefinition(str) {
  return (str || "").split('x').map(s => s.trim());
}

/**
 * Parse a single rack definition, e.g. "(5,8)" => rows=5, cols=8
 * Store in `racks` object.
 */
export function parseSingleRack(rackId, definition) {
  const match = /^\((\d+),(\d+)\)$/.exec((definition || "").trim());
  if (!match) {
    racks[rackId] = { rows: 0, columns: 0 };
  } else {
    racks[rackId] = {
      rows: parseInt(match[1], 10),
      columns: parseInt(match[2], 10)
    };
  }
}

/**
 * Creates a stepped rack Group for given row/column count
 */
function createSteppedRack(numRows, numColumns) {
  const group = new THREE.Group();
  const totalWidth = numColumns * SLOT_WIDTH_DEPTH;
  const totalDepth = numRows * SLOT_WIDTH_DEPTH;
  const rowHeight  = BOTTLE_HEIGHT / 2;
  const wallThickness = 0.1;
  const stepY     = rowHeight * 0.3;
  const baseY     = wallThickness / 2;

  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xe0e0e0,
    roughness: 0.7,
    metalness: 0.0,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    clearcoat: 0.3,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.5
    // Note: envMap is now set via scene.environment in SceneManager.js
  });

  const rowDepth = totalDepth / numRows;
  function rowCenterZ(i) {
    return totalDepth / 2 - rowDepth / 2 - rowDepth*i;
  }

  // We'll store the top y for each row
  const rowHeights = [];

  for (let i = 0; i < numRows; i++) {
    const rowBaseY = baseY + stepY*i;
    rowHeights.push(rowBaseY + wallThickness);

    const centerZ = rowCenterZ(i);

    // floor
    const floorGeom = new THREE.BoxGeometry(totalWidth, wallThickness, rowDepth);
    const floorMesh = new THREE.Mesh(floorGeom, mat);
    floorMesh.position.set(0, rowBaseY, centerZ);
    group.add(floorMesh);

    // vertical dividers
    for (let j = 1; j < numColumns; j++) {
      const dividerGeom = new THREE.BoxGeometry(wallThickness, rowHeight, rowDepth - 2*wallThickness);
      const divider = new THREE.Mesh(dividerGeom, mat);
      const xPos = -totalWidth/2 + (totalWidth/numColumns)*j;
      divider.position.set(
        xPos,
        rowBaseY + wallThickness + rowHeight/2,
        centerZ
      );
      group.add(divider);
    }

    // side walls
    const sideGeom = new THREE.BoxGeometry(wallThickness, rowHeight, rowDepth);
    const leftWall = new THREE.Mesh(sideGeom, mat);
    leftWall.position.set(
      -totalWidth/2 + wallThickness/2,
      rowBaseY + wallThickness + rowHeight/2,
      centerZ
    );
    group.add(leftWall);

    const rightWall  = new THREE.Mesh(sideGeom, mat);
    rightWall.position.set(
      totalWidth/2 - wallThickness/2,
      rowBaseY + wallThickness + rowHeight/2,
      centerZ
    );
    group.add(rightWall);
  }

  // front wall
  const frontWallGeom = createBeveledWall(totalWidth, rowHeight, wallThickness, 0.2, 0.05);
  const frontWall = new THREE.Mesh(frontWallGeom, mat);
  frontWall.rotation.y = Math.PI;
  frontWall.position.set(0, baseY, totalDepth/2);
  group.add(frontWall);

  // back wall
  const extraHeight  = (numRows - 1) * stepY;
  const backWallGeom = createBeveledWall(totalWidth, rowHeight + extraHeight, wallThickness, 0.2, 0.05);
  const backWall = new THREE.Mesh(backWallGeom, mat);
  backWall.position.set(0, baseY, -totalDepth/2);
  group.add(backWall);

  // internal walls between steps
  for (let i = 0; i < numRows - 1; i++) {
    const lowerY = baseY + stepY*(i+1);
    const upperY = baseY + stepY*i + rowHeight;
    const overlapHeight = upperY - lowerY;
    const boundaryZ = rowCenterZ(i) - rowDepth/2 + wallThickness/2;

    const sharedGeom = new THREE.BoxGeometry(totalWidth, overlapHeight, wallThickness);
    const sharedWall = new THREE.Mesh(sharedGeom, mat);
    sharedWall.position.set(0, lowerY + overlapHeight/2, boundaryZ);
    group.add(sharedWall);
  }

  return { group, rowHeights };
}

function createBeveledWall(width, height, depth, bevelSize, bevelThickness) {
  const shape = new THREE.Shape();
  shape.moveTo(-width/2, 0);
  shape.lineTo(width/2, 0);
  shape.lineTo(width/2, height);
  shape.lineTo(-width/2, height);
  shape.lineTo(-width/2, 0);

  const extrudeSettings = {
    steps: 1,
    depth: depth,
    bevelEnabled: true,
    bevelThickness: bevelThickness,
    bevelSize: bevelSize,
    bevelSegments: 1
  };
  return new THREE.ExtrudeGeometry(shape, extrudeSettings);
}

/**
 * Overhead lights for each plane
 */
function addPlaneLights() {
  // Create enhanced rect area lights for each plane
  // with additional spotlights for better shadows
  for (let planeNum = 1; planeNum <= 4; planeNum++) {
    if (!planeLayouts[planeNum] || planeLayouts[planeNum].length === 0) continue;
    const slots = planeLayouts[planeNum];
    
    const minX = Math.min(...slots.map(s => s.x)) - SLOT_WIDTH_DEPTH/2;
    const maxX = Math.max(...slots.map(s => s.x)) + SLOT_WIDTH_DEPTH/2;
    const minZ = Math.min(...slots.map(s => s.z)) - SLOT_WIDTH_DEPTH/2;
    const maxZ = Math.max(...slots.map(s => s.z)) + SLOT_WIDTH_DEPTH/2;
    
    const planeWidth = maxX - minX;
    const planeDepth = maxZ - minZ;
    const planeY = slots[0].y; // assume all have same Y
    const planeCenterX = (minX + maxX) / 2;
    const planeCenterZ = (minZ + maxZ) / 2;

    // Enhanced overhead shelf light
    const shelfLight = new THREE.RectAreaLight(0xffffff, 2.5, planeWidth * 1.4, planeDepth * 1.4);
    shelfLight.position.set(planeCenterX, planeY + BOTTLE_HEIGHT + 25, planeCenterZ);
    shelfLight.lookAt(planeCenterX, planeY, planeCenterZ);
    scene.add(shelfLight);

    // Add helper for debugging (optional - comment out in production)
    // const shelfLightHelper = new RectAreaLightHelper(shelfLight);
    // shelfLight.add(shelfLightHelper);

    // Enhanced subtle up light with warmer color
    const upLight = new THREE.RectAreaLight(0xfff0e0, 1.0, planeWidth * 1.4, planeDepth * 1.4);
    upLight.position.set(planeCenterX, planeY - 15, planeCenterZ);
    upLight.lookAt(planeCenterX, planeY + BOTTLE_HEIGHT/2, planeCenterZ);
    scene.add(upLight);

    // Add helper for debugging (optional - comment out in production)
    // const upLightHelper = new RectAreaLightHelper(upLight);
    // upLight.add(upLightHelper);

    // Add accent spotlights for each plane corner to create deeper shadows
    const cornerOffsetX = planeWidth * 0.4;
    const cornerOffsetZ = planeDepth * 0.4;
    
    // Front left corner spotlight
    const spotFL = new THREE.SpotLight(0xffffff, 0.4);
    spotFL.position.set(planeCenterX - cornerOffsetX, planeY + BOTTLE_HEIGHT * 1.5, planeCenterZ + cornerOffsetZ);
    spotFL.angle = Math.PI / 8;
    spotFL.penumbra = 0.5;
    spotFL.decay = 1.5;
    spotFL.distance = 300;
    spotFL.castShadow = true;
    spotFL.shadow.mapSize.width = 512;
    spotFL.shadow.mapSize.height = 512;
    spotFL.shadow.bias = -0.001;
    scene.add(spotFL);
    
    // Create and set spotlight target
    const spotTargetFL = new THREE.Object3D();
    spotTargetFL.position.set(planeCenterX, planeY, planeCenterZ);
    scene.add(spotTargetFL);
    spotFL.target = spotTargetFL;
    
    // Front right corner spotlight
    const spotFR = new THREE.SpotLight(0xffffff, 0.4);
    spotFR.position.set(planeCenterX + cornerOffsetX, planeY + BOTTLE_HEIGHT * 1.5, planeCenterZ + cornerOffsetZ);
    spotFR.angle = Math.PI / 8;
    spotFR.penumbra = 0.5;
    spotFR.decay = 1.5;
    spotFR.distance = 300;
    spotFR.castShadow = true;
    spotFR.shadow.mapSize.width = 512;
    spotFR.shadow.mapSize.height = 512;
    spotFR.shadow.bias = -0.001;
    scene.add(spotFR);
    
    // Create and set spotlight target
    const spotTargetFR = new THREE.Object3D();
    spotTargetFR.position.set(planeCenterX, planeY, planeCenterZ);
    scene.add(spotTargetFR);
    spotFR.target = spotTargetFR;
  }
}