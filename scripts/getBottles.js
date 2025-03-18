require('dotenv').config();
const { Client } = require('@notionhq/client');

/**
 * This script fetches all bottle entries from Notion database,
 * excluding those marked with "Ignore?" checkbox,
 * and outputs them to stdout in JSON format.
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
    
    // Transform to a simpler format with only requested fields
    const mappedBottles = bottles.map(page => {
      return {
        name: page.properties["Name"]?.title?.[0]?.plain_text || "(No name)",
        house: page.properties["House"]?.select?.name || "Unknown House",
        plane: page.properties["Plane"]?.number || 0,
        row: page.properties["Row"]?.number || 0,
        column: page.properties["Column"]?.number || 0
      };
    });
    
    // Output as formatted JSON
    console.log(JSON.stringify(mappedBottles, null, 2));
    
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
