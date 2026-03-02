const express = require('express');
const path = require('path');
require('dotenv').config();
const { Client } = require('@notionhq/client');
const fetch = require('node-fetch');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const fs = require('fs');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const app = express();

// Notion page IDs are UUIDs (with or without dashes)
const NOTION_ID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

// Security headers
app.use(helmet({
  contentSecurityPolicy: false // disabled — frontend uses inline scripts/styles and external CDN assets
}));

// Rate limiting for API endpoints (100 requests per 15 minutes per IP)
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
}));

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

// Fallback weather data used when API is unavailable
function getFallbackWeather() {
  return {
    condition: 'Clear',
    description: 'Clear sky',
    icon: '01d',
    temp: 22,
    humidity: 50,
    windSpeed: 5,
    location: 'Hanoi, Vietnam',
    time: new Date().toISOString()
  };
}

// Weather API endpoint
app.get('/api/weather', async (req, res) => {
  try {
    const apiKey = process.env.WEATHER_API_KEY || '';
    const location = process.env.DEFAULT_LOCATION || 'Hanoi,VN';
    const fallbackWeather = getFallbackWeather();
    
    if (!apiKey) {
      console.log('No Weather API key configured. Using fallback data.');
      return res.json({
        ...fallbackWeather,
        error: 'Weather API key not configured'
      });
    }
    
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${apiKey}&units=metric`
    );
    
    // Check response status before parsing JSON
    if (!response.ok) {
      // Log more details about the error
      const errorText = await response.text().catch(() => '');
      console.error(`Weather API error (${response.status}): ${errorText}`);
      
      if (response.status === 401) {
        console.error('API Key is invalid or unauthorized. Please check your WEATHER_API_KEY in .env file.');
        return res.json({
          ...fallbackWeather,
          error: 'Weather API key is invalid'
        });
      }
      
      // For other errors, still return fallback data
      return res.json({
        ...fallbackWeather,
        error: `Weather API responded with status ${response.status}`
      });
    }
    
    // Only parse JSON after confirming response is OK
    const data = await response.json();
  
    // Extract relevant weather info
    const weather = {
      condition: data.weather[0].main, // e.g., "Clear", "Clouds", "Rain"
      description: data.weather[0].description,
      icon: data.weather[0].icon,
      temp: data.main.temp,
      humidity: data.main.humidity,
      windSpeed: data.wind.speed,
      location: data.name,
      time: new Date().toISOString()
    };
    
    res.json(weather);
  } catch (err) {
    console.error('/api/weather error:', err);
    // Return fallback data with HTTP 200 to not break the UI
    res.json({ ...getFallbackWeather(), error: 'Failed to fetch weather data' });
  }
});

// Serve only the specific frontend files needed by the browser
// (avoids exposing server.js, .env, scripts/, package.json, etc.)
const allowedStaticFiles = [
  'SceneManager.js',
  'RackBuilder.js',
  'BottleManager.js',
  'UIController.js'
];
allowedStaticFiles.forEach(file => {
  app.get(`/${file}`, (req, res) => {
    res.sendFile(path.join(__dirname, file));
  });
});
app.use('/lib', express.static(path.join(__dirname, 'lib')));

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
    res.status(500).json({ error: 'Failed to fetch bottle count' });
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
        const locationProp  = page.properties["Location"];
        const typeProp      = page.properties["Type"];
        const accordsProp   = page.properties["Accords"];
        const seasonsProp   = page.properties["Seasons"];
        const urlProp       = page.properties["URL"];
        const baseNotesProp = page.properties["Base Notes"];
        const middleNotesProp = page.properties["Middle Notes"];
        const topNotesProp  = page.properties["Top Notes"];
        const timeProp      = page.properties["Time"];
        const notesProp     = page.properties["Notes"];

        // Parse fields
        const nameVal     = nameProp?.title?.[0]?.plain_text || "(No name)";
        const capColorVal = capColorProp?.select?.name || "Gold";
        const houseVal    = houseProp?.select?.name || "Unknown House";
        const locationVal = locationProp?.rich_text?.[0]?.plain_text || "0-0-0";
        // Parse location into plane, column, and row (format: x-y-z)
        const [planeVal, columnVal, rowVal] = locationVal.split('-').map(num => parseInt(num, 10) || 0);
        const typeVal     = typeProp?.select?.name || "Unknown Type";
        const accordsVal  = accordsProp?.multi_select?.map(opt => opt.name) || [];
        const seasonsVal  = seasonsProp?.multi_select?.map(opt => opt.name) || [];
        const urlVal      = urlProp?.url || "";
        const baseNotesVal = baseNotesProp?.multi_select?.map(opt => opt.name) || [];
        const middleNotesVal = middleNotesProp?.multi_select?.map(opt => opt.name) || [];
        const topNotesVal = topNotesProp?.multi_select?.map(opt => opt.name) || [];
        const timeVal     = timeProp?.multi_select?.map(opt => opt.name) || [];
        const notesVal    = notesProp?.multi_select?.map(opt => opt.name) || [];

        return {
          id: page.id,
          name: nameVal,
          capColor: capColorVal,
          house: houseVal,
          plane: planeVal,
          row: rowVal,
          column: columnVal,
          type: typeVal,
          accords: accordsVal,
          seasons: seasonsVal,
          url: urlVal,
          baseNotes: baseNotesVal,
          middleNotes: middleNotesVal,
          topNotes: topNotesVal,
          time: timeVal,
          notes: notesVal
        };
      });

      allBottles.push(...mapped);
      hasMore = response.has_more;
      startCursor = response.next_cursor;
    }

    res.json(allBottles);
  } catch (err) {
    console.error('/api/bottles error:', err);
    res.status(500).json({ error: 'Failed to fetch bottles' });
  }
});

app.post('/api/updateBottleSlot', async (req, res) => {
  try {
    const { pageId, plane, row, column } = req.body;
    if (!pageId || typeof pageId !== 'string' || !NOTION_ID_RE.test(pageId)) {
      return res.status(400).json({ error: 'Missing or invalid pageId' });
    }
    // Validate plane, row, column are positive integers within expected bounds
    const planeNum = Number(plane);
    const rowNum = Number(row);
    const colNum = Number(column);
    if (!Number.isInteger(planeNum) || planeNum < 1 || planeNum > 4) {
      return res.status(400).json({ error: 'Invalid plane (must be 1-4)' });
    }
    if (!Number.isInteger(rowNum) || rowNum < 1 || rowNum > 8) {
      return res.status(400).json({ error: 'Invalid row (must be 1-8)' });
    }
    if (!Number.isInteger(colNum) || colNum < 1 || colNum > 30) {
      return res.status(400).json({ error: 'Invalid column (must be 1-30)' });
    }
    // Create Location string in format "x-y-z" from plane, column, row values
    const locationString = `${planeNum}-${colNum}-${rowNum}`;
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
    res.json({ success: true });
  } catch (err) {
    console.error('/api/updateBottleSlot error:', err);
    res.status(500).json({ error: 'Failed to update bottle slot' });
  }
});

app.post('/api/batchUpdateBottleSlots', async (req, res) => {
  try {
    const { swaps } = req.body;
    if (!swaps || !Array.isArray(swaps) || swaps.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid swaps array' });
    }

    const results = [];
    let successCount = 0;
    let failureCount = 0;

    // Process each swap
    for (const swap of swaps) {
      try {
        const { fromId, toId, fromPlane, fromRow, fromColumn, toPlane, toRow, toColumn } = swap;

        if (!fromId || typeof fromId !== 'string' || !NOTION_ID_RE.test(fromId) ||
            !toId || typeof toId !== 'string' || !NOTION_ID_RE.test(toId)) {
          results.push({ success: false, error: 'Missing or invalid bottle ID', swap });
          failureCount++;
          continue;
        }

        // Validate all position values are integers in valid ranges
        const positions = [
          { name: 'fromPlane', val: fromPlane, min: 1, max: 4 },
          { name: 'toPlane', val: toPlane, min: 1, max: 4 },
          { name: 'fromRow', val: fromRow, min: 1, max: 8 },
          { name: 'toRow', val: toRow, min: 1, max: 8 },
          { name: 'fromColumn', val: fromColumn, min: 1, max: 30 },
          { name: 'toColumn', val: toColumn, min: 1, max: 30 }
        ];
        const invalidPos = positions.find(p => {
          const n = Number(p.val);
          return !Number.isInteger(n) || n < p.min || n > p.max;
        });
        if (invalidPos) {
          results.push({ success: false, error: `Invalid ${invalidPos.name}`, swap });
          failureCount++;
          continue;
        }

        // Create location strings using validated integer values
        const toLocationString = `${Number(toPlane)}-${Number(toColumn)}-${Number(toRow)}`;
        const fromLocationString = `${Number(fromPlane)}-${Number(fromColumn)}-${Number(fromRow)}`;
        
        // Update both bottles in parallel
        await Promise.all([
          notion.pages.update({
            page_id: fromId,
            properties: {
              Location: {
                rich_text: [{ text: { content: toLocationString } }]
              }
            }
          }),
          notion.pages.update({
            page_id: toId,
            properties: {
              Location: {
                rich_text: [{ text: { content: fromLocationString } }]
              }
            }
          })
        ]);
        
        results.push({ success: true, swap });
        successCount++;
      } catch (error) {
        console.error('Error processing swap:', error, swap);
        results.push({ success: false, error: 'Failed to process swap', swap });
        failureCount++;
      }
    }
    
    res.json({ 
      success: true, 
      results, 
      summary: {
        total: swaps.length,
        successful: successCount,
        failed: failureCount
      }
    });
  } catch (err) {
    console.error('/api/batchUpdateBottleSlots error:', err);
    res.status(500).json({ error: 'Failed to process bottle swaps' });
  }
});

app.post('/api/updateBottleCap', async (req, res) => {
  try {
    const { pageId, capColor } = req.body;
    if (!pageId || typeof pageId !== 'string' || !NOTION_ID_RE.test(pageId)) {
      return res.status(400).json({ error: 'Missing or invalid pageId' });
    }
    const validCapColors = ['Gold', 'Silver', 'Black', 'White', 'Brown', 'Blue', 'Red', 'Green', 'Pink', 'Purple', 'Orange', 'Clear'];
    if (!capColor || typeof capColor !== 'string' || !validCapColors.includes(capColor)) {
      return res.status(400).json({ error: `Invalid capColor. Must be one of: ${validCapColors.join(', ')}` });
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
    res.status(500).json({ error: 'Failed to update bottle cap color' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});





 