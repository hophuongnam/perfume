require('dotenv').config();
const { Client } = require('@notionhq/client');

/**
 * This script updates Notion database with the new optimal bottle arrangement
 * based on the seasonal priority: Fall > Winter > Spring > Summer
 */

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

// Import the bottle utils to reuse scoring logic
const bottleUtils = require('./utils/bottleUtils');

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
 * Update a bottle's location in Notion
 */
async function updateBottleLocation(pageId, plane, column, row) {
  try {
    const location = `${plane}-${column}-${row}`;

    await notion.pages.update({
      page_id: pageId,
      properties: {
        "Location": {
          rich_text: [
            {
              text: {
                content: location
              }
            }
          ]
        }
      }
    });

    return true;
  } catch (err) {
    console.error(`Error updating page ${pageId}:`, err.message);
    return false;
  }
}

/**
 * Main function to update Notion with new arrangement
 */
async function updateNotionArrangement() {
  try {
    console.log('🔄 Starting Notion update process...\n');

    // 1. Fetch all bottles
    console.log('📚 Fetching bottles from Notion...');
    const allBottles = await fetchAllBottles();

    // 2. Filter for Plane 1 only
    const plane1Bottles = allBottles.filter(bottle => bottle.plane === 1);
    console.log(`✓ Found ${plane1Bottles.length} bottles in Rack/Plane 1\n`);

    if (plane1Bottles.length === 0) {
      console.error('❌ No bottles found in Plane 1!');
      process.exit(1);
    }

    // 3. Score and sort bottles
    console.log('🎯 Calculating optimal arrangement...');
    const scoredBottles = plane1Bottles.map(bottle => ({
      ...bottle,
      score: bottleUtils.calculateMultiSeasonalScore(bottle)
    }));

    scoredBottles.sort((a, b) => b.score - a.score);
    console.log('✓ Bottles sorted by seasonal preference\n');

    // 4. Create optimal arrangement
    const bottlesPerRow = {};
    plane1Bottles.forEach(bottle => {
      bottlesPerRow[bottle.row] = (bottlesPerRow[bottle.row] || 0) + 1;
    });

    const uniqueRows = [...new Set(plane1Bottles.map(b => b.row))].sort((a, b) => a - b);

    // 5. Assign new positions
    const updates = [];
    let currentIndex = 0;

    uniqueRows.forEach(row => {
      const rowBottleCount = bottlesPerRow[row] || 0;
      const currentRowBottles = plane1Bottles.filter(b => b.row === row)
        .sort((a, b) => a.column - b.column);

      for (let i = 0; i < rowBottleCount && currentIndex < scoredBottles.length; i++) {
        const scoredBottle = scoredBottles[currentIndex];
        const columnPosition = currentRowBottles[i]?.column || (i + 1);

        // Only add to updates if position is different
        if (scoredBottle.row !== row || scoredBottle.column !== columnPosition) {
          updates.push({
            id: scoredBottle.id,
            name: scoredBottle.name,
            house: scoredBottle.house,
            oldPosition: `${scoredBottle.plane}-${scoredBottle.column}-${scoredBottle.row}`,
            newPosition: `${1}-${columnPosition}-${row}`,
            plane: 1,
            column: columnPosition,
            row: row,
            score: scoredBottle.score
          });
        }

        currentIndex++;
      }
    });

    console.log(`📝 Found ${updates.length} bottles that need position updates\n`);

    if (updates.length === 0) {
      console.log('✅ All bottles are already in optimal positions!');
      return;
    }

    // 6. Confirm before updating
    console.log('⚠️  This will update Notion database with new positions.');
    console.log('First 10 updates to be made:');
    updates.slice(0, 10).forEach((update, i) => {
      console.log(`  ${i + 1}. ${update.name} (${update.house})`);
      console.log(`     ${update.oldPosition} → ${update.newPosition}`);
    });

    if (updates.length > 10) {
      console.log(`  ... and ${updates.length - 10} more\n`);
    }

    // Wait for user confirmation
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise(resolve => {
      readline.question('\n❓ Do you want to proceed with the update? (yes/no): ', resolve);
    });
    readline.close();

    if (answer.toLowerCase() !== 'yes') {
      console.log('\n❌ Update cancelled.');
      process.exit(0);
    }

    // 7. Perform updates
    console.log('\n🚀 Starting updates...');
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < updates.length; i++) {
      const update = updates[i];
      const success = await updateBottleLocation(update.id, update.plane, update.column, update.row);

      if (success) {
        successCount++;
        console.log(`✓ [${i + 1}/${updates.length}] Updated: ${update.name} → Row ${update.row}, Col ${update.column}`);
      } else {
        failCount++;
        console.log(`✗ [${i + 1}/${updates.length}] Failed: ${update.name}`);
      }

      // Add small delay to avoid rate limiting
      if (i < updates.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // 8. Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 Update Summary:');
    console.log('='.repeat(80));
    console.log(`✅ Successful updates: ${successCount}`);
    console.log(`❌ Failed updates: ${failCount}`);
    console.log(`📦 Total bottles processed: ${updates.length}`);
    console.log('='.repeat(80));

    if (failCount === 0) {
      console.log('\n🎉 All updates completed successfully!');
      console.log('Your Notion database now reflects the optimal seasonal arrangement.');
    } else {
      console.log('\n⚠️  Some updates failed. Please check the error messages above.');
    }

  } catch (err) {
    console.error('❌ Error during update process:', err);
    process.exit(1);
  }
}

// Execute
updateNotionArrangement();
