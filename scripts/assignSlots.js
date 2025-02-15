require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

/**
 * Parse environment variables for RACK_R1..RACK_R4, each in the form "(4,6)" => { rows, columns }
 */
const rackEnvVars = ["R1","R2","R3","R4"];
const racks = {};

rackEnvVars.forEach(key => {
  const envKey = `RACK_${key}`;
  if (process.env[envKey]) {
    racks[key] = parseRackDefinition(process.env[envKey]);
  }
});

/**
 * Utility function to parse e.g. "(4,6)" => { rows: 4, columns: 6 }
 */
function parseRackDefinition(str) {
  const match = /^\((\d+),(\d+)\)$/.exec(str.trim());
  if (!match) {
    console.warn("Invalid rack definition:", str);
    return { rows: 0, columns: 0 };
  }
  return {
    rows: parseInt(match[1], 10),
    columns: parseInt(match[2], 10)
  };
}

/**
 * Parse environment variables for planes: PLANE_P1..P4
 * Each is e.g. "R1xR2" => means 2 racks side by side (along the row dimension).
 */
const planeConfigs = [];
[1,2,3,4].forEach(num => {
  const envKey = `PLANE_P${num}`;
  if (process.env[envKey]) {
    planeConfigs.push({ planeNumber: num, definition: process.env[envKey] });
  }
});

/**
 * Utility: parse plane definition e.g. "R1xR2" => ["R1", "R2"]
 */
function parsePlaneDefinition(str) {
  return str.split('x').map(s => s.trim());
}

/**
 * Build a list of { plane, row, column } for a given planeDefinition ("R1xR2"),
 * stacking racks by row dimension. If R1 has 4 rows, 6 columns, and R2 has 4 rows, 6 columns,
 * then total rows = 4 + 4, columns = 6, plus optional row offset from OFFSET_RACK.
 */
function buildSlotsForPlane(planeNumber, planeDefinition) {
  const rackIds = parsePlaneDefinition(planeDefinition);
  const result = [];
  let rowOffset = 0;
  const offsetRack = parseInt(process.env.OFFSET_RACK || "1", 10);

  for (const rackId of rackIds) {
    const rDef = racks[rackId];
    if (!rDef) {
      console.warn(`No rack definition found for ${rackId}. Skipping...`);
      continue;
    }
    const { rows, columns } = rDef;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        result.push({
          plane: planeNumber,
          row: rowOffset + row,
          column: col
        });
      }
    }
    // Move rowOffset for the next rack in this plane (stack by row)
    rowOffset += rows;
    // Add extra spacing if desired
    rowOffset += offsetRack;
  }

  return result;
}

/**
 * Gather all possible slots across all plane definitions
 */
function buildAllSlots() {
  let all = [];
  for (const cfg of planeConfigs) {
    const planeSlots = buildSlotsForPlane(cfg.planeNumber, cfg.definition);
    all.push(...planeSlots);
  }
  return all;
}

/**
 * Update a Notion page with row, column, and plane
 */
async function updatePage(pageId, plane, row, column) {
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
        }
      }
    });
    console.log(`Assigned slot to page ${pageId} -> Plane=${plane}, Row=${row}, Column=${column}`);
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

    // 3) If you want to shuffle pages or slots, do it here. We'll keep it simple.

    // 4) For each page, pick the next slot
    const totalBottles = filteredPages.length;
    const usableSlots = Math.min(allSlots.length, totalBottles);
    console.log(`Assigning slots to ${usableSlots} bottles. Any beyond that won't be assigned.`);

    for (let i = 0; i < usableSlots; i++) {
      const page = filteredPages[i];
      const slot = allSlots[i];
      await updatePage(page.id, slot.plane, slot.row, slot.column);
    }

    // If leftover
    if (usableSlots < filteredPages.length) {
      console.log(`WARNING: Not enough slots. ${filteredPages.length - usableSlots} bottles remain unassigned.`);
    }

    console.log("Reassignment complete.");
  } catch (err) {
    console.error("Error in reassigning slots:", err.message);
  }
})();

/**
 * Utility to fetch all pages from a Notion database (pagination)
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