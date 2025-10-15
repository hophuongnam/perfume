require('dotenv').config();
const { Client } = require('@notionhq/client');
const bottleUtils = require('./utils/bottleUtils');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

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
    .filter(p => {
      const ignore = p.properties['Ignore?']?.checkbox;
      return !ignore;
    })
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

async function resume() {
  console.log('🔄 Resuming fix process...\n');

  const allBottles = await fetchAllBottles();

  const plane1Bottles = allBottles.filter(b => b.plane === 1);
  const tempBottles = allBottles.filter(b => b.plane === 9);

  console.log(`Bottles in Plane 1: ${plane1Bottles.length}`);
  console.log(`Bottles in temporary positions (Plane 9): ${tempBottles.length}\n`);

  if (tempBottles.length === 0) {
    console.log('✅ No bottles in temporary positions. Checking for duplicates...');
    return;
  }

  // Get all bottles that should be in plane 1
  const allPlane1Candidates = [...plane1Bottles, ...tempBottles];
  console.log(`Total bottles for Plane 1: ${allPlane1Candidates.length}\n`);

  // Calculate optimal positions for ALL bottles
  const scoredBottles = allPlane1Candidates.map(bottle => ({
    ...bottle,
    score: bottleUtils.calculateMultiSeasonalScore(bottle)
  }));
  scoredBottles.sort((a, b) => b.score - a.score);

  // Assign positions (30 bottles per row, 8 rows)
  const targetPositions = [];
  for (let row = 1; row <= 8; row++) {
    for (let col = 1; col <= 30; col++) {
      const index = (row - 1) * 30 + (col - 1);
      if (index < scoredBottles.length) {
        targetPositions.push({
          id: scoredBottles[index].id,
          name: scoredBottles[index].name,
          targetPlane: 1,
          targetColumn: col,
          targetRow: row
        });
      }
    }
  }

  console.log('Moving remaining bottles to final positions...\n');

  for (let i = 0; i < targetPositions.length; i++) {
    const bottle = targetPositions[i];
    await updateBottleLocation(bottle.id, bottle.targetPlane, bottle.targetColumn, bottle.targetRow);

    if ((i + 1) % 20 === 0) {
      console.log(`Progress: ${i + 1}/${targetPositions.length} bottles positioned`);
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  console.log(`\n✅ Completed! All ${targetPositions.length} bottles positioned.`);
}

resume().catch(console.error);
