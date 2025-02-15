const express = require('express');
const path = require('path');
require('dotenv').config();

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
  offsetPlatoon: process.env.OFFSET_PLATOON || "1"
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

// Start the server
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});