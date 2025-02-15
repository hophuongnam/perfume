const express = require('express');
const path = require('path');
require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const app = express();
const port = process.env.PORT || 3000;

/**
 * Build a config object to send to the client
 * Only the environment variables that the front-end uses.
 */
const config = {
  platoonA1: process.env.PLATOON_A1 || "",
  platoonA2: process.env.PLATOON_A2 || "",
  platoonA3: process.env.PLATOON_A3 || "",
  platoonA4: process.env.PLATOON_A4 || "",
  planeP1: process.env.PLANE_P1 || "",
  planeP2: process.env.PLANE_P2 || "",
  planeVerticalOffset: process.env.PLANE_VERTICAL_OFFSET || "2",
  offsetPlatoon: process.env.OFFSET_PLATOON || "1",
  capColorDefault: "Gold"
};

// Serve perfume.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'perfume.html'));
});

// Provide config data to the frontend
app.get('/api/config', (req, res) => {
  res.json(config);
});

// Serve any other static files in the directory as needed (CSS, JS, etc.)
app.use(express.static(path.join(__dirname)));

app.get('/api/bottleCount', async (req, res) => {
  try {
    let total = 0;
    let hasMore = true;
    let startCursor = undefined;
    while (hasMore) {
      const resp = await notion.databases.query({
        database_id: process.env.NOTION_DATABASE_ID,
        start_cursor: startCursor
      });
      // filter out pages with "Ignore?" checkbox
      const validPages = resp.results.filter(page => !page.properties["Ignore?"]?.checkbox);
      total += validPages.length;
      hasMore = resp.has_more;
      startCursor = resp.next_cursor;
    }
    res.json({ total });
  } catch (err) {
    console.error('/api/bottleCount error:', err);
    res.status(500).json({ error: err.message });
  }
});

// STEP 5: Add an /api/bottles endpoint to retrieve detailed data
app.get('/api/bottles', async (req, res) => {
  try {
    let allBottles = [];
    let hasMore = true;
    let startCursor = undefined;

    while (hasMore) {
      const response = await notion.databases.query({
        database_id: process.env.NOTION_DATABASE_ID,
        start_cursor: startCursor
      });
      
      // Filter out "Ignore?" if you want
      const validPages = response.results.filter(page => !page.properties["Ignore?"]?.checkbox);

      // Map to a simpler JSON
      const mapped = validPages.map(page => {
        const nameProp      = page.properties["Name"];
        const capColorProp  = page.properties["Cap Color"];
        const houseProp     = page.properties["House"];
        const planeProp     = page.properties["Plane"];
        const rowProp       = page.properties["Row"];
        const columnProp    = page.properties["Column"];

        // Parse the fields
        const nameVal       = nameProp?.title?.[0]?.plain_text || "(No name)";
        const capColorVal   = capColorProp?.select?.name || "Gold"; // fallback
        const houseVal      = houseProp?.select?.name || "Unknown House";

        const planeVal      = planeProp?.rich_text?.[0]?.plain_text || "";
        const rowVal        = rowProp?.rich_text?.[0]?.plain_text || "";
        const colVal        = columnProp?.rich_text?.[0]?.plain_text || "";

        return {
          id: page.id,
          name: nameVal,
          capColor: capColorVal,
          house: houseVal,
          plane: parseInt(planeVal, 10) || 0,
          row: parseInt(rowVal, 10) || 0,
          column: parseInt(colVal, 10) || 0
        };
      });

      allBottles.push(...mapped);
      hasMore = response.has_more;
      startCursor = response.next_cursor;
    }

    res.json(allBottles);
  } catch (err) {
    console.error('/api/bottles error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});