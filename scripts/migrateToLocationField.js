require('dotenv').config();
const { Client } = require('@notionhq/client');

/**
 * This script migrates all existing entries in the Notion database
 * from the separate Plane, Row, and Column fields to a new Location field
 * in the format "x-y-z" where x is plane, y is column, and z is row.
 */

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

async function migrateToLocationField() {
  try {
    console.log("Starting migration to Location field...");
    
    // Fetch all pages from database
    let pages = await fetchAllNotionPages(databaseId);
    
    // Filter out pages with "Ignore?" checkbox checked
    pages = pages.filter(page => !page.properties["Ignore?"]?.checkbox);
    
    console.log(`Found ${pages.length} bottles to migrate`);
    console.log("Beginning migration process...");
    
    let successCount = 0;
    let errorCount = 0;
    
    // Process each page to update with the new Location field
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageId = page.id;
      const pageName = page.properties["Name"]?.title?.[0]?.plain_text || "(No name)";
      
      try {
        // Get current plane, row, column values
        const planeVal = page.properties["Plane"]?.number || 0;
        const rowVal = page.properties["Row"]?.number || 0;
        const colVal = page.properties["Column"]?.number || 0;
        
        // Create Location string in format "x-y-z"
        const locationString = `${planeVal}-${rowVal}-${colVal}`;
        
        // Check if anything needs to be updated
        const currentLocation = page.properties["Location"]?.rich_text?.[0]?.plain_text;
        
        if (currentLocation === locationString) {
          console.log(`[${i+1}/${pages.length}] Skipping "${pageName}" - Location already set to "${locationString}"`);
          successCount++;
          continue;
        }
        
        // Update the Notion page with the new Location field
        await notion.pages.update({
          page_id: pageId,
          properties: {
            Location: {
              rich_text: [
                {
                  text: {
                    content: locationString
                  }
                }
              ]
            }
          }
        });
        
        console.log(`[${i+1}/${pages.length}] Updated "${pageName}" with Location "${locationString}"`);
        successCount++;
        
        // Add a small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        console.error(`[${i+1}/${pages.length}] Error updating "${pageName}":`, err.message);
        errorCount++;
      }
    }
    
    console.log("\nMigration complete!");
    console.log(`Successfully updated: ${successCount} bottles`);
    console.log(`Errors encountered: ${errorCount} bottles`);
    
    if (errorCount > 0) {
      console.log("Please run the script again to retry failed updates.");
    } else {
      console.log("All bottles have been successfully migrated to the new Location field format!");
    }
  } catch (err) {
    console.error("Error during migration:", err);
  }
}

/**
 * Utility to fetch all pages in the Notion database with pagination handling
 */
async function fetchAllNotionPages(dbId) {
  let allPages = [];
  let hasMore = true;
  let startCursor = undefined;
  
  while (hasMore) {
    const response = await notion.databases.query({
      database_id: dbId,
      start_cursor: startCursor
    });
    
    allPages = allPages.concat(response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }
  
  return allPages;
}

// Execute the migration function
migrateToLocationField();
