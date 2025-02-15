require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

// Parse environment variables for platoons (e.g. PLATOON_A1, PLATOON_A2, etc.)
const platoonEnvVars = ["A1", "A2", "A3", "A4"];
const platoons = {};

platoonEnvVars.forEach(key => {
  const envName = `PLATOON_${key}`;
  if (process.env[envName]) {
    platoons[key] = parsePlatoonDefinition(process.env[envName]);
  }
});

// Parse environment variables for planes (PLANE_P1, PLANE_P2, etc.)
const planeConfigs = [];
[1,2,3,4].forEach(num => {
  const envKey = `PLANE_P${num}`;
  if (process.env[envKey]) {
    planeConfigs.push({ planeNumber: num, definition: process.env[envKey] });
  }
});

// Utility: parse e.g. "platoon(6(4,6))" => { racks:6, rows:4, slots:6 }
function parsePlatoonDefinition(str) {
  const match = /^platoon\((\d+)\((\d+),(\d+)\)\)$/.exec(str.trim());
  if (!match) {
    console.warn("Invalid platoon definition:", str);
    return { racks: 0, rows: 0, slots: 0 };
  }
  return {
    racks: parseInt(match[1]),
    rows: parseInt(match[2]),
    slots: parseInt(match[3])
  };
}

// Utility: parse e.g. "A1xA2" => ["A1", "A2"]
function parsePlaneDefinition(str) {
  return str.split('x').map(s => s.trim());
}

/**
 * Build a list of { plane, row, column } for a given planeDefinition (e.g. "A1xA2")
 * by enumerating each platoon, which may contain multiple racks, each with many rows/slots.
 * We'll unify them in the column dimension for simplicity.
 * If you wish to handle Z offset or advanced geometry, do so in your Three.js code later.
 */
function buildSlotsForPlane(planeNumber, planeDefinition) {
  const platoonIds = parsePlaneDefinition(planeDefinition);
  const result = [];
  let columnOffset = 0;

  for (const platoonId of platoonIds) {
    const p = platoons[platoonId];
    if (!p) {
      console.warn(`No definition found for platoon ${platoonId}. Skipping...`);
      continue;
    }
    const { racks, rows, slots } = p;
    // We'll map each rack/row/slot to a distinct column index
    // e.g. total columns = racks * slots, row remains from 0..(rows-1).
    for (let r = 0; r < racks; r++) {
      for (let row = 0; row < rows; row++) {
        for (let s = 0; s < slots; s++) {
          const col = columnOffset + r * slots + s;
          result.push({
            plane: planeNumber,
            row,
            column: col
          });
        }
      }
    }
    columnOffset += racks * slots;
  }
  return result;
}

/**
 * Master function to gather all possible slots across all plane definitions
 */
function buildAllSlots() {
  let all = [];
  for (const cfg of planeConfigs) {
    const planeSlots = buildSlotsForPlane(cfg.planeNumber, cfg.definition);
    all.push(...planeSlots);
  }
  return all;
}

// Utility: picks one of the 3 cap colors at random
function getRandomCapColor() {
  const colors = ["Black", "Gold", "Silver"];
  const idx = Math.floor(Math.random() * colors.length);
  return colors[idx];
}

/**
 * Update a Notion page with row, column, plane, and random cap color
 */
async function updatePage(pageId, plane, row, column, capColor) {
  try {
    await notion.pages.update({
      page_id: pageId,
      properties: {
        Plane: {
          rich_text: [
            {
              type: 'text',
              text: { content: String(plane) }
            }
          ]
        },
        Row: {
          rich_text: [
            {
              type: 'text',
              text: { content: String(row) }
            }
          ]
        },
        Column: {
          rich_text: [
            {
              type: 'text',
              text: { content: String(column) }
            }
          ]
        },
        // "Cap Color" is a select property
        "Cap Color": {
          select: {
            name: capColor
          }
        }
      }
    });
    console.log(`Assigned slot to page ${pageId} -> Plane=${plane}, Row=${row}, Column=${column}, Cap=${capColor}`);
  } catch (error) {
    console.error(`Failed to update page ${pageId}: ${error.message}`);
  }
}

(async function main() {
  try {
    // 1) Build the total set of all possible slots
    const allSlots = buildAllSlots();
    console.log(`Total available slots: ${allSlots.length}`);

    // 2) Fetch all pages from Notion
    const pages = await fetchAllNotionPages(databaseId);
    const filteredPages = pages.filter(p => !p.properties["Ignore?"]?.checkbox);
    console.log(`Ignoring ${pages.length - filteredPages.length} bottles with "Ignore?"=true. Operating on ${filteredPages.length} bottles (pages) from Notion.`);

    // 3) If you want to shuffle pages or slots, do it here:
    // e.g. randomize slot assignment, but keep a stable page order
    // We'll keep it simple: first page -> first slot, etc.

    // 4) For each page, pick the next slot, pick a random cap color, update in Notion
    const totalBottles = filteredPages.length;
    const usableSlots = Math.min(allSlots.length, totalBottles);
    console.log(`Assigning slots to ${usableSlots} bottles. Any beyond that won't be assigned.`);

    for (let i = 0; i < usableSlots; i++) {
      const page = filteredPages[i];
      const slot = allSlots[i];
      const capColor = getRandomCapColor();

      await updatePage(page.id, slot.plane, slot.row, slot.column, capColor);
    }

    // if there are leftover pages with no slots, optionally warn
    if (usableSlots < filteredPages.length) {
      console.log(`WARNING: Not enough slots. ${filteredPages.length - usableSlots} bottles remain unassigned.`);
    }

    console.log("Reassignment complete.");
  } catch (err) {
    console.error("Error in reassigning slots:", err.message);
  }
})();

/**
 * Utility to fetch all pages from a given Notion database (handling pagination).
 */
async function fetchAllNotionPages(dbId) {
  let results = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: dbId,
      start_cursor: startCursor
    });
    results = results.concat(response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }
  return results;
}