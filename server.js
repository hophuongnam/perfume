const express = require('express');
const path = require('path');
require('dotenv').config();
const { Client } = require('@notionhq/client');
    
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
        const urlProp       = page.properties["URL"];

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
        const urlVal      = urlProp?.url || "";

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
          seasons: seasonsVal,
          url: urlVal
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

const dataFilePath = path.join(__dirname, 'perfumeData.txt');

/**
 * Reads perfumeData.txt, updates Notion for any new/unupdated records,
 * and marks them so they won't be updated again.
 */
async function updatePerfumeData() {
  try {
    if (!fs.existsSync(dataFilePath)) {
      return;
    }

    const rawData = fs.readFileSync(dataFilePath, 'utf8').trim();
    if (!rawData) {
      return;
    }

    // Split into lines, dropping empty lines
    const lines = rawData.split('\n').map(line => line.trim()).filter(Boolean);

    // We expect at least 2 lines: (accords...) + final line for URL
    if (lines.length < 2) {
      console.log('perfumeData.txt does not contain enough lines for accords and URL.');
      return;
    }

    // The last line is the URL; preceding lines are the accords
    const url = lines.pop();
    const accords = lines;

    // Query Notion for the page with this URL
    const resp = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID,
      filter: {
        property: 'URL',
        url: {
          equals: url
        }
      }
    });

    if (resp.results.length === 0) {
      console.log(`No matching page found for URL: ${url}`);
      return;
    }

    const page = resp.results[0];
    // Update Accords on Notion
    await notion.pages.update({
      page_id: page.id,
      properties: {
        Accords: {
          multi_select: accords.map(a => ({ name: a }))
        }
      }
    });

    console.log(`Notion updated for URL: ${url}`);

    // Mark the file so that next time it won't update again
    fs.writeFileSync(dataFilePath, '', 'utf8');
    console.log('perfumeData.txt is cleared to prevent re-update');
  } catch (error) {
    console.error('Error updating Notion from file:', error);
  }
}

 

// Periodically update Notion from the file every minute
setInterval(() => {
  updatePerfumeData();
}, 60000);