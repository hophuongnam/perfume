require('dotenv').config();
const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');
const bottleUtils = require('./utils/bottleUtils');

/**
 * This script optimizes the arrangement of perfume bottles based on:
 * 1. Seasonal appropriateness (current season gets priority)
 * 2. Notes (notes appropriate for current season)
 * 3. Accords (accords appropriate for current season)
 * 
 * It places the most preferable bottles in row 1 (front), and least preferable in row 8.
 * The script calculates the minimum number of swaps required to achieve the optimal arrangement.
 */

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

/**
 * Write swap plan to a file
 */
function writeSwapPlanToFile(swapPlan) {
  const filePath = path.join(__dirname, '..', 'optimalBottleSwaps.txt');
  fs.writeFileSync(filePath, swapPlan);
  
  console.log(`Swap plan written to ${filePath}`);
}

/**
 * Generate a unique version ID for the swap plan
 * Uses a timestamp + random string to ensure uniqueness
 */
function generateSwapVersion() {
  const timestamp = new Date().toISOString().replace(/[-:\.]/g, '').slice(0, 14); // YYYYMMDDhhmmss
  const randomString = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${randomString}`;
}

/**
 * Fetch all bottles from Notion database
 */
async function fetchAllBottles() {
  try {
    // Fetch all pages from database
    const pages = await fetchAllNotionPages(databaseId);

    // Filter out pages with "Ignore?" checkbox checked
    const bottles = pages.filter(page => !page.properties["Ignore?"]?.checkbox);

    console.log(`Found ${bottles.length} bottles (excluding ${pages.length - bottles.length} with "Ignore?" checked)`);

    // Transform to a simpler format with all necessary fields
    const mappedBottles = bottles.map(page => {
      // Extract location
      const locationVal = page.properties["Location"]?.rich_text?.[0]?.plain_text || "0-0-0";
      // Parse location into plane, column, and row (format: x-y-z)
      // This matches the format used in server.js
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
 * Find the optimal bottle arrangement
 */
async function optimizeBottleArrangement() {
  try {
    // 1. Fetch all bottles from Notion
    const allBottles = await fetchAllBottles();
    
    // 2. Filter bottles for plane 1
    const plane1Bottles = allBottles.filter(bottle => bottle.plane === 1);
    console.log(`Found ${plane1Bottles.length} bottles in plane 1`);
    
    // 3. Determine current season
    const currentSeason = bottleUtils.getCurrentSeason();
    console.log(`Current season: ${currentSeason}`);
    
    // 4. Score bottles based on seasonal appropriateness, notes, and accords
    const scoredBottles = plane1Bottles.map(bottle => ({
      ...bottle,
      score: bottleUtils.calculateBottleScore(bottle, currentSeason)
    }));
    
    // 5. Sort bottles by score (descending)
    scoredBottles.sort((a, b) => b.score - a.score);
    
    // 6. Create optimal positions array
    // We want to place bottles with highest scores in rows 1-3 (front)
    // and bottles with lowest scores in rows 6-8 (back)
    const optimalPositions = [];
    
    // Map of row number to priority (1 = highest priority, 8 = lowest)
    // We need to respect the rack layout where row 1 is the front (most accessible)
    const rowPriorities = {
      1: 1, // Highest priority (front row)
      2: 2,
      3: 3,
      4: 4,
      5: 5,
      6: 6,
      7: 7,
      8: 8  // Lowest priority (back row)
    };
    
    // Get all unique rows in plane 1 and sort them by priority
    const uniqueRows = [...new Set(plane1Bottles.map(b => b.row))].sort((a, b) => {
      // If we have defined priorities, use them; otherwise, use numeric order
      const priorityA = rowPriorities[a] || a;
      const priorityB = rowPriorities[b] || b;
      return priorityA - priorityB; // Lower number = higher priority
    });
    
    console.log(`Row arrangement (from highest to lowest priority): ${uniqueRows.join(', ')}`);
    
    // Count bottles per row in the current arrangement
    const bottlesPerRow = {};
    plane1Bottles.forEach(bottle => {
      bottlesPerRow[bottle.row] = (bottlesPerRow[bottle.row] || 0) + 1;
    });
    
    // Assign bottles to rows based on their score
    // Higher scored bottles go to higher priority rows (lower row numbers)
    let currentIndex = 0;
    
    // Assign positions by row priority
    uniqueRows.forEach(row => {
      const rowBottleCount = bottlesPerRow[row] || 0;
      
      for (let i = 0; i < rowBottleCount; i++) {
        if (currentIndex < scoredBottles.length) {
          // Keep the same column but assign to the row based on score
          const bottle = scoredBottles[currentIndex];
          optimalPositions.push({
            ...bottle,
            plane: 1, // Ensure we're only dealing with plane 1
            row: row  // Keep the original row structure
          });
          currentIndex++;
        }
      }
    });
    
    // 7. Calculate the minimum number of swaps required
    const currentPositions = [...plane1Bottles];
    let minimumSwaps;
    try {
      minimumSwaps = bottleUtils.calculateMinimumSwaps(currentPositions, optimalPositions);
      console.log(`Minimum swaps required: ${minimumSwaps}`);
    } catch (error) {
      console.error(`Error calculating minimum swaps: ${error.message}`);
      console.log("Falling back to a direct calculation method...");
      // Simple fallback: Bottles at wrong positions equal number of required swaps
      minimumSwaps = currentPositions.filter((bottle, i) => 
        bottle.row !== optimalPositions[i].row || bottle.column !== optimalPositions[i].column
      ).length / 2; // Divide by 2 since each swap fixes 2 bottles
      console.log(`Fallback calculation: Minimum swaps required: ${minimumSwaps}`);
    }
    
    // 8. Generate swap plan using the cycle-based algorithm
    let swapPlan;
    try {
      swapPlan = bottleUtils.generateSwapPlan(currentPositions, optimalPositions);
      console.log(`Generated ${swapPlan.length} swaps`);
    } catch (error) {
      console.error(`Error generating swap plan: ${error.message}`);
      console.log("Please check for any missing bottles or inconsistencies in your bottle positions.");
      process.exit(1);
    }
    
    // 9. Validate that the swap plan is optimal
    const validationResult = bottleUtils.validateSwapPlan(swapPlan, minimumSwaps);
    console.log(`Validation: ${validationResult.message}`);
    
    if (!validationResult.valid) {
      console.warn("Warning: The generated swap plan may not use the minimum number of swaps.");
    } else {
      console.log("✓ Swap plan is optimal - using minimum number of swaps");
    }
    
    // 10. Format the swap plan with headers for rows
    let formattedSwapPlan = bottleUtils.formatSwapPlan(swapPlan, currentSeason);
    
    // Add plane information
    formattedSwapPlan = formattedSwapPlan.replace(
      "Perfume Bottle Seasonal Swaps",
      "Perfume Bottle Seasonal Swaps - PLANE 1 ONLY"
    );
    
    // Add version information
    const swapVersion = generateSwapVersion();
    formattedSwapPlan = `VERSION: ${swapVersion}\n\n${formattedSwapPlan}`;
    
    // 11. Write the swap plan to a file
    writeSwapPlanToFile(formattedSwapPlan);
    
    // 12. Log the number of swaps by seasonal suitability
    const suitableBottlesCount = scoredBottles.filter(b => b.score >= 30).length;
    const lessSuitableBottlesCount = scoredBottles.length - suitableBottlesCount;
    
    console.log(`\nSeasonal Analysis:`);
    console.log(`${suitableBottlesCount} bottles are suitable for ${currentSeason}`);
    console.log(`${lessSuitableBottlesCount} bottles are less suitable for ${currentSeason}`);
    
    // Output detailed information about the first few bottles
    console.log(`\nTop 5 Most Suitable Bottles:`);
    scoredBottles.slice(0, 5).forEach(bottle => {
      console.log(`${bottle.name} (${bottle.house}) - Score: ${bottle.score}`);
    });
    
    console.log(`\nBottom 5 Least Suitable Bottles:`);
    scoredBottles.slice(-5).forEach(bottle => {
      console.log(`${bottle.name} (${bottle.house}) - Score: ${bottle.score}`);
    });
    
  } catch (err) {
    console.error("Error optimizing bottle arrangement:", err);
    process.exit(1);
  }
}

// Execute the optimization
optimizeBottleArrangement();
