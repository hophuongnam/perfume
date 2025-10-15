require('dotenv').config();
const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');
const bottleUtils = require('./utils/bottleUtils');

/**
 * This script generates two maps for Rack 1 (Plane 1):
 * 1. Current Map - showing current bottle positions
 * 2. Target Map - showing optimal positions based on seasonal preferences
 *
 * Seasonal preference order: Fall > Winter > Spring > Summer
 */

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

/**
 * Fetch all bottles from Notion database
 */
async function fetchAllBottles() {
  try {
    const pages = await fetchAllNotionPages(databaseId);
    const bottles = pages.filter(page => !page.properties["Ignore?"]?.checkbox);

    console.log(`Found ${bottles.length} bottles (excluding ${pages.length - bottles.length} with "Ignore?" checked)`);

    const mappedBottles = bottles.map(page => {
      const locationVal = page.properties["Location"]?.rich_text?.[0]?.plain_text || "0-0-0";
      const [planeVal, colVal, rowVal] = locationVal.split('-').map(num => parseInt(num, 10) || 0);

      return {
        id: page.id,
        name: page.properties["Name"]?.title?.[0]?.plain_text || "(No name)",
        house: page.properties["House"]?.select?.name || "Unknown House",
        plane: planeVal,
        row: rowVal,
        column: colVal,
        seasons: page.properties["Seasons"]?.multi_select?.map(s => s.name) || [],
        accords: page.properties["Accords"]?.multi_select?.map(a => a.name) || [],
        notes: page.properties["Notes"]?.multi_select?.map(n => n.name) || [],
        topNotes: page.properties["Top Notes"]?.multi_select?.map(n => n.name) || [],
        middleNotes: page.properties["Middle Notes"]?.multi_select?.map(n => n.name) || [],
        baseNotes: page.properties["Base Notes"]?.multi_select?.map(n => n.name) || [],
        time: page.properties["Time"]?.multi_select?.map(t => t.name) || []
      };
    });

    return mappedBottles;
  } catch (err) {
    console.error("Error fetching bottles:", err);
    process.exit(1);
  }
}

/**
 * Utility to fetch all pages in the Notion database with pagination handling
 */
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

/**
 * Create a grid representation of bottle positions
 */
function createGridMap(bottles, title) {
  // Find grid dimensions
  const maxRow = Math.max(...bottles.map(b => b.row));
  const maxCol = Math.max(...bottles.map(b => b.column));

  // Create position lookup
  const positionMap = new Map();
  bottles.forEach(bottle => {
    const key = `${bottle.column}-${bottle.row}`;
    positionMap.set(key, bottle);
  });

  // Build the grid
  let output = `${title}\n`;
  output += `${'='.repeat(title.length)}\n\n`;
  output += `Format: Column-Row: Perfume Name (House)\n\n`;

  // Group by rows
  for (let row = 1; row <= maxRow; row++) {
    output += `\n${'─'.repeat(80)}\n`;
    output += `ROW ${row}:\n`;
    output += `${'─'.repeat(80)}\n`;

    const rowBottles = [];
    for (let col = 1; col <= maxCol; col++) {
      const key = `${col}-${row}`;
      const bottle = positionMap.get(key);
      if (bottle) {
        rowBottles.push(`  Col ${col.toString().padStart(2)}: ${bottle.name} (${bottle.house})`);
      }
    }

    if (rowBottles.length > 0) {
      output += rowBottles.join('\n') + '\n';
    } else {
      output += `  (Empty)\n`;
    }
  }

  output += `\n${'═'.repeat(80)}\n`;
  output += `Total bottles: ${bottles.length}\n`;

  return output;
}

/**
 * Create a compact grid view (CSV-like format)
 */
function createCompactGridMap(bottles, title) {
  const maxRow = Math.max(...bottles.map(b => b.row));
  const maxCol = Math.max(...bottles.map(b => b.column));

  const positionMap = new Map();
  bottles.forEach(bottle => {
    const key = `${bottle.column}-${bottle.row}`;
    positionMap.set(key, `${bottle.name.substring(0, 20)} (${bottle.house.substring(0, 15)})`);
  });

  let output = `${title}\n`;
  output += `${'='.repeat(title.length)}\n\n`;

  // Header row
  output += 'Row\\Col'.padEnd(10);
  for (let col = 1; col <= maxCol; col++) {
    output += `| ${col.toString().padStart(2)} `.padEnd(40);
  }
  output += '\n';
  output += '-'.repeat(10 + (maxCol * 40)) + '\n';

  // Data rows
  for (let row = 1; row <= maxRow; row++) {
    output += `Row ${row}`.padEnd(10);
    for (let col = 1; col <= maxCol; col++) {
      const key = `${col}-${row}`;
      const bottle = positionMap.get(key) || '(Empty)';
      output += `| ${bottle}`.padEnd(40);
    }
    output += '\n';
  }

  return output;
}

/**
 * Generate rack maps
 */
async function generateRackMaps() {
  try {
    console.log('Fetching bottles from Notion...');
    const allBottles = await fetchAllBottles();

    // Filter for Plane 1 only
    const plane1Bottles = allBottles.filter(bottle => bottle.plane === 1);
    console.log(`Found ${plane1Bottles.length} bottles in Rack/Plane 1`);

    if (plane1Bottles.length === 0) {
      console.error('No bottles found in Plane 1!');
      process.exit(1);
    }

    // Generate current map
    console.log('Generating current rack map...');
    const currentMap = createGridMap(plane1Bottles, 'CURRENT RACK 1 ARRANGEMENT');
    const currentMapCompact = createCompactGridMap(plane1Bottles, 'CURRENT RACK 1 ARRANGEMENT (Compact View)');

    // Score and sort bottles for optimal arrangement
    console.log('Calculating optimal arrangement based on seasonal preferences...');
    console.log('Seasonal priority: Fall > Winter > Spring > Summer');

    const scoredBottles = plane1Bottles.map(bottle => ({
      ...bottle,
      score: bottleUtils.calculateMultiSeasonalScore(bottle)
    }));

    // Sort by score (descending - highest scores first)
    scoredBottles.sort((a, b) => b.score - a.score);

    // Log top and bottom bottles
    console.log('\nTop 5 bottles by seasonal score:');
    scoredBottles.slice(0, 5).forEach((b, i) => {
      console.log(`  ${i+1}. ${b.name} (${b.house}) - Score: ${b.score.toFixed(2)}`);
    });

    console.log('\nBottom 5 bottles by seasonal score:');
    scoredBottles.slice(-5).forEach((b, i) => {
      console.log(`  ${i+1}. ${b.name} (${b.house}) - Score: ${b.score.toFixed(2)}`);
    });

    // Create optimal arrangement
    // Count bottles per row in current arrangement
    const bottlesPerRow = {};
    plane1Bottles.forEach(bottle => {
      bottlesPerRow[bottle.row] = (bottlesPerRow[bottle.row] || 0) + 1;
    });

    // Get unique rows sorted by priority (row 1 is highest priority)
    const uniqueRows = [...new Set(plane1Bottles.map(b => b.row))].sort((a, b) => a - b);

    console.log(`\nRow structure: ${uniqueRows.join(', ')}`);
    console.log('Bottles per row:', bottlesPerRow);

    // Assign bottles to rows based on score
    const targetBottles = [];
    let currentIndex = 0;

    // For each row (in priority order), assign the next highest-scored bottles
    uniqueRows.forEach(row => {
      const rowBottleCount = bottlesPerRow[row] || 0;

      // Get all current bottles in this row to preserve column positions
      const currentRowBottles = plane1Bottles.filter(b => b.row === row)
        .sort((a, b) => a.column - b.column);

      for (let i = 0; i < rowBottleCount && currentIndex < scoredBottles.length; i++) {
        const scoredBottle = scoredBottles[currentIndex];
        const columnPosition = currentRowBottles[i]?.column || (i + 1);

        targetBottles.push({
          ...scoredBottle,
          row: row,
          column: columnPosition
        });
        currentIndex++;
      }
    });

    // Generate target map
    console.log('\nGenerating target rack map...');
    const targetMap = createGridMap(targetBottles, 'TARGET RACK 1 ARRANGEMENT (Seasonal: Fall > Winter > Spring > Summer)');
    const targetMapCompact = createCompactGridMap(targetBottles, 'TARGET RACK 1 ARRANGEMENT (Compact View)');

    // Write output files
    const currentMapPath = path.join(__dirname, '..', 'currentRackMap.txt');
    const targetMapPath = path.join(__dirname, '..', 'targetRackMap.txt');
    const comparisonPath = path.join(__dirname, '..', 'rackComparison.txt');

    fs.writeFileSync(currentMapPath, currentMap + '\n\n' + currentMapCompact);
    fs.writeFileSync(targetMapPath, targetMap + '\n\n' + targetMapCompact);

    // Create comparison file
    const comparison = `RACK 1 REARRANGEMENT GUIDE
${'='.repeat(80)}

Generated: ${new Date().toISOString()}
Seasonal Priority: FALL > WINTER > SPRING > SUMMER

Row Priority (Front to Back):
  Rows 1-2: Autumn/Fall perfumes (highest priority)
  Rows 3-4: Winter perfumes
  Rows 5-6: Spring perfumes
  Rows 7-8: Summer perfumes (lowest priority)

${'='.repeat(80)}

${currentMapCompact}

${'='.repeat(80)}

${targetMapCompact}

${'='.repeat(80)}

INSTRUCTIONS:
1. Review the CURRENT arrangement above
2. Rearrange bottles according to the TARGET arrangement
3. Each bottle should move from its current Column-Row to the target Column-Row
4. You can rearrange all at once since you have both maps

Total bottles to rearrange: ${plane1Bottles.length}
`;

    fs.writeFileSync(comparisonPath, comparison);

    console.log(`\n✓ Files generated successfully:`);
    console.log(`  - ${currentMapPath}`);
    console.log(`  - ${targetMapPath}`);
    console.log(`  - ${comparisonPath}`);
    console.log(`\nYou can now use these maps to rearrange your bottles!`);

  } catch (err) {
    console.error('Error generating rack maps:', err);
    process.exit(1);
  }
}

// Execute
generateRackMaps();
