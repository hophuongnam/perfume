require('dotenv').config();
const { Client } = require('@notionhq/client');

/**
 * This script tests the new Location field conversion from Plane, Row, and Column values.
 * It doesn't modify any data, just outputs what would change.
 */

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

async function testLocationField() {
  try {
    // Fetch a small number of pages from database
    const { results } = await notion.databases.query({
      database_id: databaseId,
      page_size: 5
    });

    console.log(`Fetched ${results.length} sample bottles for testing`);

    // Analyze each bottle's data
    for (const page of results) {
      // Extract current values
      const pageName = page.properties["Name"]?.title?.[0]?.plain_text || "(No name)";
      const planeVal = page.properties["Plane"]?.number || 0;
      const rowVal = page.properties["Row"]?.number || 0;
      const colVal = page.properties["Column"]?.number || 0;
      
      // Check if Location field exists already
      const locationVal = page.properties["Location"]?.rich_text?.[0]?.plain_text || undefined;
      
      // Calculate what the Location value should be
      const calculatedLocation = `${planeVal}-${rowVal}-${colVal}`;
      
      console.log(`\nBottle: ${pageName}`);
      console.log(`Current values: plane=${planeVal}, row=${rowVal}, column=${colVal}`);
      console.log(`Current Location field: ${locationVal || "not set"}`);
      console.log(`Calculated Location: ${calculatedLocation}`);
      
      if (locationVal !== calculatedLocation) {
        console.log(`Location field needs update: ${locationVal || "not set"} -> ${calculatedLocation}`);
      } else if (locationVal) {
        console.log(`Location field correctly set to: ${locationVal}`);
      }
    }

    console.log("\nTest completed! This script did not modify any data.");
  } catch (err) {
    console.error("Error testing Location field:", err);
  }
}

// Execute the test function
testLocationField();
