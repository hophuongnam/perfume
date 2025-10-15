require('dotenv').config();
const { Client } = require('@notionhq/client');
const bottleUtils = require('./utils/bottleUtils');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

/**
 * This script fixes duplicate positions by using a three-phase approach:
 * Phase 1: Move all bottles to temporary positions (plane 9)
 * Phase 2: Move all bottles to their final optimal positions
 */

async function fetchAllBottles() {
  const pages = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const resp = await notion.databases.query({
      database_id: databaseId,
      start_cursor: startCursor
    });
    pages.push(...resp.results);
    hasMore = resp.has_more;
    startCursor = resp.next_cursor;
  }

  const bottles = pages
    .filter(p => !p.properties['Ignore?']?.checkbox)
    .map(p => {
      const locationVal = p.properties.Location?.rich_text?.[0]?.plain_text || '0-0-0';
      const [planeVal, colVal, rowVal] = locationVal.split('-').map(num => parseInt(num, 10) || 0);

      return {
        id: p.id,
        name: p.properties.Name?.title?.[0]?.plain_text || '(No name)',
        house: p.properties.House?.select?.name || 'Unknown House',
        plane: planeVal,
        row: rowVal,
        column: colVal,
        seasons: p.properties.Seasons?.multi_select?.map(s => s.name) || [],
        accords: p.properties.Accords?.multi_select?.map(a => a.name) || [],
        notes: p.properties.Notes?.multi_select?.map(n => n.name) || [],
        topNotes: p.properties['Top Notes']?.multi_select?.map(n => n.name) || [],
        middleNotes: p.properties['Middle Notes']?.multi_select?.map(n => n.name) || [],
        baseNotes: p.properties['Base Notes']?.multi_select?.map(n => n.name) || [],
        time: p.properties.Time?.multi_select?.map(t => t.name) || []
      };
    });

  return bottles;
}

async function updateBottleLocation(pageId, plane, column, row) {
  const location = `${plane}-${column}-${row}`;
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Location: {
        rich_text: [{ text: { content: location } }]
      }
    }
  });
}

async function fixDuplicates() {
  console.log('🔧 Starting duplicate position fix...\n');

  // 1. Fetch all bottles
  const allBottles = await fetchAllBottles();
  const plane1Bottles = allBottles.filter(b => b.plane === 1);
  console.log(`📚 Found ${plane1Bottles.length} bottles in Plane 1\n`);

  // 2. Calculate optimal positions
  console.log('🎯 Calculating optimal arrangement...');
  const scoredBottles = plane1Bottles.map(bottle => ({
    ...bottle,
    score: bottleUtils.calculateMultiSeasonalScore(bottle)
  }));
  scoredBottles.sort((a, b) => b.score - a.score);

  const bottlesPerRow = {};
  plane1Bottles.forEach(b => {
    bottlesPerRow[b.row] = (bottlesPerRow[b.row] || 0) + 1;
  });

  const uniqueRows = [...new Set(plane1Bottles.map(b => b.row))].sort((a, b) => a - b);

  // Build target mapping
  const targetPositions = [];
  let currentIndex = 0;

  uniqueRows.forEach(row => {
    const rowBottleCount = bottlesPerRow[row] || 0;
    const currentRowBottles = plane1Bottles.filter(b => b.row === row)
      .sort((a, b) => a.column - b.column);

    for (let i = 0; i < rowBottleCount && currentIndex < scoredBottles.length; i++) {
      const scoredBottle = scoredBottles[currentIndex];
      const columnPosition = currentRowBottles[i]?.column || (i + 1);

      targetPositions.push({
        id: scoredBottle.id,
        name: scoredBottle.name,
        house: scoredBottle.house,
        targetPlane: 1,
        targetColumn: columnPosition,
        targetRow: row
      });
      currentIndex++;
    }
  });

  console.log('✓ Optimal positions calculated\n');

  // 3. Phase 1: Move ALL bottles to temporary positions (plane 9)
  console.log('📦 PHASE 1: Moving all bottles to temporary positions...');
  for (let i = 0; i < targetPositions.length; i++) {
    const bottle = targetPositions[i];
    await updateBottleLocation(bottle.id, 9, i + 1, 1); // Temporary: 9-{index}-1

    if ((i + 1) % 10 === 0) {
      console.log(`  Progress: ${i + 1}/${targetPositions.length} bottles moved to temp`);
    }

    await new Promise(resolve => setTimeout(resolve, 300));
  }
  console.log(`✓ All ${targetPositions.length} bottles moved to temporary positions\n`);

  // 4. Phase 2: Move bottles to final optimal positions
  console.log('🎯 PHASE 2: Moving bottles to final positions...');
  for (let i = 0; i < targetPositions.length; i++) {
    const bottle = targetPositions[i];
    await updateBottleLocation(bottle.id, bottle.targetPlane, bottle.targetColumn, bottle.targetRow);

    if ((i + 1) % 10 === 0) {
      console.log(`  Progress: ${i + 1}/${targetPositions.length} bottles moved to final position`);
    }

    await new Promise(resolve => setTimeout(resolve, 300));
  }
  console.log(`✓ All ${targetPositions.length} bottles moved to final positions\n`);

  console.log('=' .repeat(80));
  console.log('🎉 Position fix completed successfully!');
  console.log('=' .repeat(80));
  console.log('All bottles should now be in unique positions.');
  console.log('Run checkDuplicates.js to verify.');
}

fixDuplicates().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
