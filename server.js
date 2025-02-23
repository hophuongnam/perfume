const express = require('express');
const path = require('path');
require('dotenv').config();
const { Client } = require('@notionhq/client');
const chokidar = require('chokidar');
const fs = require('fs');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const app = express();
app.use(express.json());
const port = process.env.PORT || 3000;

/**
 * Build a config object to send to the client
 * Contains environment variables needed by the front-end
 */
const config = {
  rackR1: process.env.RACK_R1 || "",
  rackR2: process.env.RACK_R2 || "",
  rackR3: process.env.RACK_R3 || "",
  rackR4: process.env.RACK_R4 || "",
  planeP1: process.env.PLANE_P1 || "",
  planeP2: process.env.PLANE_P2 || "",
  planeP3: process.env.PLANE_P3 || "",
  planeP4: process.env.PLANE_P4 || "",
  planeVerticalOffset: process.env.PLANE_VERTICAL_OFFSET || "2",
  offsetRack: process.env.OFFSET_RACK || "1",
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

// Serve static files (CSS, JS, etc.) from the same directory
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

// Endpoint to fetch all bottle data from Notion
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
      
      // Filter out "Ignore?"
      const validPages = response.results.filter(page => !page.properties["Ignore?"]?.checkbox);

      // Map to simpler JSON
      const mapped = validPages.map(page => {
        const nameProp      = page.properties["Name"];
        const capColorProp  = page.properties["Cap Color"];
        const houseProp     = page.properties["House"];
        const planeProp     = page.properties["Plane"];
        const rowProp       = page.properties["Row"];
        const columnProp    = page.properties["Column"];
        const typeProp      = page.properties["Type"];
        const accordsProp   = page.properties["Accords"];
        const seasonsProp   = page.properties["Seasons"];

        // Parse fields
        const nameVal     = nameProp?.title?.[0]?.plain_text || "(No name)";
        const capColorVal = capColorProp?.select?.name || "Gold";
        const houseVal    = houseProp?.select?.name || "Unknown House";
        const planeVal    = planeProp?.number || 0;
        const rowVal      = rowProp?.number || 0;
        const colVal      = columnProp?.number || 0;
        const typeVal     = typeProp?.select?.name || "Unknown Type";
        const accordsVal  = accordsProp?.multi_select?.map(opt => opt.name) || [];
        const seasonsVal  = seasonsProp?.multi_select?.map(opt => opt.name) || [];

        return {
          id: page.id,
          name: nameVal,
          capColor: capColorVal,
          house: houseVal,
          plane: planeVal,
          row: rowVal,
          column: colVal,
          type: typeVal,
          accords: accordsVal,
          seasons: seasonsVal
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

app.post('/api/updateBottleSlot', async (req, res) => {
  try {
    const { pageId, plane, row, column } = req.body;
    if (!pageId) {
      return res.status(400).json({ error: 'Missing pageId' });
    }
    await notion.pages.update({
      page_id: pageId,
      properties: {
        Plane: {
          number: plane
        },
        Row: {
          number: row
        },
        Column: {
          number: column
        }
      }
    });
    res.json({ success: true });
  } catch (err) {
    console.error('/api/updateBottleSlot error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/updateBottleCap', async (req, res) => {
  try {
    const { pageId, capColor } = req.body;
    if (!pageId) {
      return res.status(400).json({ error: 'Missing pageId' });
    }
    await notion.pages.update({
      page_id: pageId,
      properties: {
        "Cap Color": {
          select: {
            name: capColor
          }
        }
      }
    });
    res.json({ success: true });
  } catch (err) {
    console.error('/api/updateBottleCap error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});

const dataFilePath = path.join(__dirname, 'perfumeData.json');

/**
 * Reads perfumeData.json, updates Notion for any new/unupdated records,
 * and marks them so they won't be updated again.
 */
async function updatePerfumeData() {
  try {
    if (!fs.existsSync(dataFilePath)) {
      return; // No file to process
    }

    const rawData = fs.readFileSync(dataFilePath, 'utf8');
    let perfumeData = JSON.parse(rawData);

    // Handle the case where perfumeData might be a single object
    if (!Array.isArray(perfumeData)) {
      perfumeData = [perfumeData];
    }

    let updatedSomething = false;

    // Process each record in the JSON
    for (const record of perfumeData) {
      // Skip if already updated or missing a URL
      if (record.notionUpdated || !record.url) {
        continue;
      }

      // Query Notion for a page with matching URL
      const resp = await notion.databases.query({
        database_id: process.env.NOTION_DATABASE_ID,
        filter: {
          property: 'URL',
          url: {
            equals: record.url
          }
        }
      });

      if (resp.results.length > 0) {
        const page = resp.results[0];
        // Update "Accords" field or any other fields from the record
        // If "accords" is present, update it
        if (Array.isArray(record.accords)) {
          await notion.pages.update({
            page_id: page.id,
            properties: {
              Accords: {
                multi_select: record.accords.map(a => ({ name: a }))
              }
            }
          });
          console.log(`Notion updated for URL: ${record.url}`);
        } else {
          console.log(`Record has no accords array for URL: ${record.url}`);
        }

        // Mark this record as updated
        record.notionUpdated = true;
        updatedSomething = true;
      } else {
        console.log(`No matching page found for URL: ${record.url}`);
      }
    }

    // If we updated at least one record, write back to the file
    if (updatedSomething) {
      fs.writeFileSync(dataFilePath, JSON.stringify(perfumeData, null, 2), 'utf8');
      console.log('perfumeData.json updated to mark notion updates.');
    }
  } catch (error) {
    console.error('Error updating Notion from JSON file:', error);
  }
}

// Watch the JSON file for changes and trigger an update
chokidar.watch(dataFilePath).on('change', () => {
  console.log(`Detected change in ${dataFilePath}. Updating Notion...`);
  updatePerfumeData();
});

// Also update Notion once every minute, in case the file hasn't changed
setInterval(() => {
  updatePerfumeData();
}, 60000);