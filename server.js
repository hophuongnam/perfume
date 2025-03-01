const express = require('express');
const path = require('path');
require('dotenv').config();
const { Client } = require('@notionhq/client');
const fetch = require('node-fetch');
    
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

// Weather API endpoint
app.get('/api/weather', async (req, res) => {
  try {
    const apiKey = process.env.WEATHER_API_KEY || '';
    const location = process.env.DEFAULT_LOCATION || 'Hanoi,VN';
    
    // Fallback weather data
    const fallbackWeather = {
      condition: 'Clear',
      description: 'Clear sky',
      icon: '01d',
      temp: 22,
      humidity: 50,
      windSpeed: 5,
      location: 'Hanoi, Vietnam',
      time: new Date().toISOString()
    };
    
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
    res.json({
      error: err.message,
      condition: 'Clear',
      description: 'Clear sky (fallback)',
      icon: '01d',
      temp: 22,
      humidity: 50,
      windSpeed: 5,
      location: 'Hanoi, Vietnam',
      time: new Date().toISOString()
    });
  }
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
        const baseNotesProp = page.properties["Base Notes"];
        const middleNotesProp = page.properties["Middle Notes"];
        const topNotesProp  = page.properties["Top Notes"];
        const timeProp      = page.properties["Time"];
        const notesProp     = page.properties["Notes"];

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
          column: colVal,
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





 