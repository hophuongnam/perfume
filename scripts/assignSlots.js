require('dotenv').config();
const { Client } = require('@notionhq/client');

/**
 * This script auto-assigns valid plane/row/column slots to Notion pages.
 *
 * 1) Parse environment variables for racks (RACK_R1..R4) => produce planeLayouts using PLANE_P1..P4
 * 2) For each page in the Notion database (filter "Ignore?"):
 *    - Grab existing plane, row, column.
 *    - If valid and unoccupied => keep that.
 *    - Else => find the first free valid slot in planeLayouts and use that.
 * 3) Update Notion to reflect these final assignments.
 *
 * No more "No slot found" messages. All bottles get placed in some valid slot, unless
 * we run out of total slots.
 */

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

/** Parse environment variables for RACK_R1..R4 in the form "(4,30)" => { rows, columns } */
function parseRackDefinition(str) {
  const match = /^\((\d+),\s*(\d+)\)$/.exec((str || "").trim());
  if (!match) {
    console.warn("Invalid rack definition:", str);
    return { rows: 0, columns: 0 };
  }
  return {
    rows: parseInt(match[1], 10),
    columns: parseInt(match[2], 10)
  };
}

const racks = {};
["R1","R2","R3","R4"].forEach(key => {
  const envKey = `RACK_${key}`;
  racks[key] = process.env[envKey] ? parseRackDefinition(process.env[envKey]) : { rows:0, columns:0 };
});

/** parsePlaneDefinition e.g. "R1xR2" => ["R1","R2"] */
function parsePlaneDefinition(str) {
  return (str || "").split('x').map(s => s.trim());
}

/**
 * planeLayouts[planeNumber] = array of { plane, row, column }
 * We build these by stacking racks from PLANE_P1..P4 in the row dimension.
 */
const planeLayouts = {};

function buildAllPlanesFromEnv() {
  for (let planeNumber = 1; planeNumber <= 4; planeNumber++) {
    const envKey = `PLANE_P${planeNumber}`;
    const definition = process.env[envKey] || "";
    if (!definition) {
      planeLayouts[planeNumber] = [];
      continue;
    }
    const rackIds = parsePlaneDefinition(definition);
    if (!rackIds || !rackIds.length) {
      planeLayouts[planeNumber] = [];
      continue;
    }

    const layout = [];
    let rowIndexBase = 0;
    const offsetRack = parseFloat(process.env.OFFSET_RACK || "1") || 1;

    for (const rackId of rackIds) {
      const rDef = racks[rackId] || { rows:0, columns:0 };
      if (!rDef.rows || !rDef.columns) {
        console.warn(`No valid definition for rackId=${rackId}`);
        continue;
      }
      const { rows, columns } = rDef;
      // Fill row+col
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns; c++) {
          layout.push({
            plane: planeNumber,
            row: rowIndexBase + r + 1,
            column: c + 1
          });
        }
      }
      rowIndexBase += rows;
      // The front-end also offsets racks in the scene, but for the row count logic
      // we only care about total rowIndexBase. The offsetRack doesn't matter for row numbering unless
      // we truly want blank rows between racks. For now we'll skip adding extra blank rows, to keep it simpler.
      // If you want to insert empty space for offsetRack, you could do e.g. rowIndexBase += offsetRack*X
    }
    planeLayouts[planeNumber] = layout;
  }
}

/** occupantMap "plane-row-col" => pageId */
const occupantMap = {};

/**
 * We'll store final assignment for each page in updatedPositions[pageId] = { plane, row, column }
 */
const updatedPositions = {};

/** We'll build a global list of all possible slots across planes, sorted by plane->row->column. */
let allSlots = [];

/**
 * Initialize the environment-based plane layouts, occupant map, etc.
 * Then fetch pages, for each page fix assignment or pick next free slot,
 * and update Notion.
 */
async function main() {
  buildAllPlanesFromEnv();

  // Build a single sorted array of all possible slots in ascending (plane, row, column).
  // This helps us pick "the first free slot" easily.
  allSlots = [];
  Object.keys(planeLayouts).forEach(planeKey => {
    const planeNum = parseInt(planeKey, 10);
    const layout = planeLayouts[planeNum] || [];
    allSlots.push(...layout);
  });
  // Sort by plane, then row, then column
  allSlots.sort((a,b) => {
    if (a.plane !== b.plane) return a.plane - b.plane;
    if (a.row !== b.row) return a.row - b.row;
    return a.column - b.column;
  });

  try {
    // 1) Fetch all pages
    const pages = await fetchAllNotionPages(databaseId);
    const filtered = pages.filter(p => !p.properties["Ignore?"]?.checkbox);
    console.log(`Ignoring ${pages.length - filtered.length} bottles with "Ignore?"=true. Assigning slots for ${filtered.length} pages.`);

    // 2) For each page, read plane/row/col. If invalid or occupied => pick next free slot
    for (const page of filtered) {
      const pageId = page.id;

      // parse plane, row, col from Notion
      const planeVal = page.properties["Plane"]?.number || 0;
      const rowVal   = page.properties["Row"]?.number || 0;
      const colVal   = page.properties["Column"]?.number || 0;
      let plane = planeVal;
      let row   = rowVal;
      let column= colVal;

      // check if (plane,row,col) is valid in planeLayouts
      if (!isSlotValid(plane, row, column)) {
        // pick next free slot
        const slot = findFirstFreeSlot();
        if (!slot) {
          console.log(`WARNING: No more free slots. Page ${pageId} can't be assigned.`);
          // We'll just set plane=row=column=0 to indicate unassigned
          updatedPositions[pageId] = { plane:0, row:0, column:0 };
          continue;
        }
        plane = slot.plane;
        row   = slot.row;
        column= slot.column;
      } else {
        // It's valid in the layout. Next, is it free or occupied?
        const occKey = `${plane}-${row}-${column}`;
        if (occupantMap[occKey]) {
          // Occupied => pick next free slot
          const slot = findFirstFreeSlot();
          if (!slot) {
            console.log(`WARNING: No more free slots. Page ${pageId} can't be assigned.`);
            updatedPositions[pageId] = { plane:0, row:0, column:0 };
            continue;
          }
          plane = slot.plane;
          row   = slot.row;
          column= slot.column;
        }
      }

      // Now occupant is going to (plane, row, column)
      const key = `${plane}-${row}-${column}`;
      occupantMap[key] = pageId;
      updatedPositions[pageId] = { plane, row, column };
    }

    // 3) Update each final assignment in Notion
    for (const [pageId, pos] of Object.entries(updatedPositions)) {
      await updateBottleSlotInNotion(pageId, pos.plane, pos.row, pos.column);
    }

    console.log("All assignments complete. 🎉");
  } catch (err) {
    console.error("Error in main assignSlots logic:", err);
    process.exit(1);
  }
}

/** Check if plane, row, col is valid in planeLayouts */
function isSlotValid(plane, row, col) {
  if (!planeLayouts[plane]) return false;
  return planeLayouts[plane].some(s => s.row === row && s.column === col);
}

/** findFirstFreeSlot => scan allSlots in order, see if occupantMap[plane-row-col] is empty. Return that slot if found. */
function findFirstFreeSlot() {
  for (const slot of allSlots) {
    const key = `${slot.plane}-${slot.row}-${slot.column}`;
    if (!occupantMap[key]) {
      return slot;  // occupantMap doesn't have an occupant => free
    }
  }
  return null; // no free slot
}

/** Update the Notion page's plane, row, column fields */
async function updateBottleSlotInNotion(pageId, plane, row, column) {
  try {
    await notion.pages.update({
      page_id: pageId,
      properties: {
        Plane: {
          number: plane
        },
        Row: {
          number: row
        },
        Column: {
          number: column
        }
      }
    });
    console.log(`Page ${pageId} => plane=${plane}, row=${row}, column=${column}`);
  } catch (err) {
    console.error(`Failed to update Notion page ${pageId}: ${err.message}`);
  }
}

/** Utility to fetch all pages in the Notion database */
async function fetchAllNotionPages(dbId) {
  let results = [];
  let hasMore = true;
  let startCursor = undefined;
  while (hasMore) {
    const resp = await notion.databases.query({
      database_id: dbId,
      start_cursor: startCursor
    });
    results = results.concat(resp.results);
    hasMore = resp.has_more;
    startCursor = resp.next_cursor;
  }
  return results;
}

// Kick it off
main();