require('dotenv').config();
const { Client } = require('@notionhq/client');

/**
 * This script fetches all bottle entries from Notion database,
 * excluding those marked with "Ignore?" checkbox,
 * and outputs them to stdout in JSON format.
 * Now with added functionality to arrange bottles by seasonal suitability.
 */

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

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

    // Transform to a simpler format with additional fields for seasonal info
    const mappedBottles = bottles.map(page => {
      return {
        name: page.properties["Name"]?.title?.[0]?.plain_text || "(No name)",
        house: page.properties["House"]?.select?.name || "Unknown House",
        plane: page.properties["Plane"]?.number || 0,
        row: page.properties["Row"]?.number || 0,
        column: page.properties["Column"]?.number || 0,
        seasons: page.properties["Seasons"]?.multi_select?.map(s => s.name) || [],
        accords: page.properties["Accords"]?.multi_select?.map(a => a.name) || [],
        notes: page.properties["Notes"]?.multi_select?.map(n => n.name) || [],
        topNotes: page.properties["Top Notes"]?.multi_select?.map(n => n.name) || [],
        middleNotes: page.properties["Middle Notes"]?.multi_select?.map(n => n.name) || [],
        baseNotes: page.properties["Base Notes"]?.multi_select?.map(n => n.name) || [],
        time: page.properties["Time"]?.multi_select?.map(t => t.name) || []
      };
    });

    // Filter bottles for plane 1
    const plane1Bottles = mappedBottles.filter(bottle => bottle.plane === 1);
    console.log(`Found ${plane1Bottles.length} bottles in plane 1`);

    // Determine current season based on Northern Hemisphere
    const now = new Date();
    const month = now.getMonth(); // 0-11
    let currentSeason;

    if (month >= 2 && month <= 4) {
      currentSeason = 'Spring';
    } else if (month >= 5 && month <= 7) {
      currentSeason = 'Summer';
    } else if (month >= 8 && month <= 10) {
      currentSeason = 'Fall';
    } else {
      currentSeason = 'Winter';
    }

    console.log(`Current season: ${currentSeason}`);

    // Calculate seasonal suitability score for each bottle
    const scoredBottles = plane1Bottles.map(bottle => {
      let score = 0;
      
      // Higher score if bottle's seasons include current season
      if (bottle.seasons.includes(currentSeason)) {
        score += 10;
      }
      
      // Add points for adjacent seasons (e.g., Spring is adjacent to Summer and Winter)
      const adjacentSeasons = {
        'Spring': ['Summer', 'Winter'],
        'Summer': ['Spring', 'Fall'],
        'Fall': ['Summer', 'Winter'],
        'Winter': ['Fall', 'Spring']
      };
      
      for (const season of bottle.seasons) {
        if (adjacentSeasons[currentSeason]?.includes(season)) {
          score += 5;
        }
      }
      
      return { ...bottle, seasonalScore: score };
    });
    
    // Sort bottles by seasonal suitability (higher scores first)
    scoredBottles.sort((a, b) => b.seasonalScore - a.seasonalScore);
    
    // Group the bottles into front rows and back rows based on scores
    const frontRowBottles = [];
    const backRowBottles = [];
    
    scoredBottles.forEach((bottle, index) => {
      if (bottle.seasonalScore >= 5) {
        frontRowBottles.push(bottle);
      } else {
        backRowBottles.push(bottle);
      }
    });
    
    console.log(`\nMore Seasonally Suitable Bottles (${frontRowBottles.length}) - Front Rows:`);
    console.log(JSON.stringify(frontRowBottles, null, 2));
    
    console.log(`\nLess Seasonally Suitable Bottles (${backRowBottles.length}) - Back Rows:`);
    console.log(JSON.stringify(backRowBottles, null, 2));

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

// Execute the main function
fetchAllBottles();
