require('dotenv').config();
const { Client } = require('@notionhq/client');
const fs = require('fs');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

// Current season configuration
const CURRENT_SEASON = 'Fall';

// Season weights for scoring
const SEASON_WEIGHTS = {
  'Fall': 1.0,
  'Year-round': 0.7,
  'Spring': 0.3,
  'Summer': 0.2,
  'Winter': 0.5
};

// Note categories for grouping
const NOTE_CATEGORIES = {
  woody: ['woody', 'wood', 'cedar', 'sandalwood', 'oud', 'vetiver', 'patchouli'],
  spicy: ['spicy', 'spice', 'cinnamon', 'pepper', 'cardamom', 'clove'],
  citrus: ['citrus', 'lemon', 'bergamot', 'orange', 'grapefruit', 'lime'],
  floral: ['floral', 'rose', 'jasmine', 'lavender', 'iris', 'violet'],
  fresh: ['fresh', 'aquatic', 'marine', 'mint', 'green'],
  oriental: ['oriental', 'amber', 'vanilla', 'incense', 'resin'],
  leather: ['leather', 'suede', 'tobacco'],
  fruity: ['fruity', 'fruit', 'apple', 'peach', 'berry']
};

async function fetchAllBottles() {
  console.log('Fetching all bottles from Notion...');
  let allPages = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: startCursor
    });
    allPages = allPages.concat(response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  const bottles = allPages
    .filter(page => !page.properties['Ignore?']?.checkbox)
    .map(page => {
      const locationVal = page.properties['Location']?.rich_text?.[0]?.plain_text || '0-0-0';
      const [plane, column, row] = locationVal.split('-').map(num => parseInt(num, 10) || 0);

      return {
        id: page.id,
        name: page.properties['Name']?.title?.[0]?.plain_text || '(No name)',
        house: page.properties['House']?.select?.name || 'Unknown',
        plane,
        column,
        row,
        currentLocation: locationVal,
        seasons: page.properties['Seasons']?.multi_select?.map(s => s.name) || [],
        notes: page.properties['Notes']?.multi_select?.map(n => n.name) || [],
        accords: page.properties['Accords']?.multi_select?.map(a => a.name) || [],
        time: page.properties['Time']?.multi_select?.map(t => t.name) || []
      };
    })
    .filter(b => b.plane === 1); // Only Plane 1

  console.log(`Fetched ${bottles.length} active bottles in Plane 1\n`);
  return bottles;
}

function calculateSeasonScore(bottle) {
  let score = 0;

  // Primary: Direct season match
  if (bottle.seasons.includes(CURRENT_SEASON)) {
    score += 100;
  }

  // Secondary: Other seasons with weights
  bottle.seasons.forEach(season => {
    if (season !== CURRENT_SEASON && SEASON_WEIGHTS[season]) {
      score += SEASON_WEIGHTS[season] * 50;
    }
  });

  return score;
}

function categorizeByNotes(bottle) {
  const allTerms = [
    ...bottle.notes.map(n => n.toLowerCase()),
    ...bottle.accords.map(a => a.toLowerCase())
  ];

  for (const [category, keywords] of Object.entries(NOTE_CATEGORIES)) {
    for (const term of allTerms) {
      for (const keyword of keywords) {
        if (term.includes(keyword)) {
          return category;
        }
      }
    }
  }

  return 'other';
}

function optimizeArrangement(bottles) {
  console.log('Calculating seasonal scores...');

  // Score all bottles
  bottles.forEach(bottle => {
    bottle.seasonScore = calculateSeasonScore(bottle);
    bottle.noteCategory = categorizeByNotes(bottle);
  });

  // Sort by season score (descending), then by house, then by note category
  bottles.sort((a, b) => {
    if (b.seasonScore !== a.seasonScore) {
      return b.seasonScore - a.seasonScore;
    }
    if (a.house !== b.house) {
      return a.house.localeCompare(b.house);
    }
    return a.noteCategory.localeCompare(b.noteCategory);
  });

  console.log('Assigning bottles to optimal positions...\n');

  // Assign positions
  const arrangement = [];
  let currentRow = 1;
  let currentColumn = 1;
  const MAX_COLUMNS = 30;

  bottles.forEach((bottle, index) => {
    // Assign position first
    arrangement.push({
      ...bottle,
      targetLocation: `1-${currentColumn}-${currentRow}`,
      targetPlane: 1,
      targetColumn: currentColumn,
      targetRow: currentRow
    });

    // Move to next position
    currentColumn++;
    if (currentColumn > MAX_COLUMNS) {
      currentColumn = 1;
      currentRow++;
      if (currentRow > 8) currentRow = 1; // Wrap around if needed
    }
  });

  return arrangement;
}

function generateMoveList(arrangement) {
  console.log('Generating move list...\n');

  let moveList = '';
  moveList += '=== OPTIMAL ARRANGEMENT TRANSITION PLAN ===\n';
  moveList += `Generated: ${new Date().toLocaleString()}\n`;
  moveList += `Season: ${CURRENT_SEASON}\n`;
  moveList += `Total bottles: ${arrangement.length}\n\n`;
  moveList += 'Format: (target-slot) (bottle-name) (current-location)\n';
  moveList += '='.repeat(70) + '\n\n';

  // Group by target row for easier physical execution
  for (let row = 1; row <= 8; row++) {
    const rowBottles = arrangement.filter(b => b.targetRow === row);
    if (rowBottles.length === 0) continue;

    moveList += `\n--- ROW ${row} (${rowBottles.length} bottles) ---\n`;
    rowBottles.forEach(bottle => {
      moveList += `(${bottle.targetLocation}) ${bottle.name} (${bottle.currentLocation})\n`;
    });
  }

  return moveList;
}

function generateNotionUpdateScript(arrangement) {
  console.log('Generating Notion update script...\n');

  let script = `require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// Generated location updates
const updates = ${JSON.stringify(
    arrangement.map(b => ({
      id: b.id,
      name: b.name,
      newLocation: b.targetLocation,
      oldLocation: b.currentLocation
    })),
    null,
    2
  )};

async function updateNotionLocations() {
  console.log('Updating Notion with new bottle locations...');
  console.log(\`Total updates: \${updates.length}\\n\`);

  let successCount = 0;
  let errorCount = 0;

  for (const update of updates) {
    try {
      await notion.pages.update({
        page_id: update.id,
        properties: {
          'Location': {
            rich_text: [{
              text: { content: update.newLocation }
            }]
          }
        }
      });

      successCount++;
      console.log(\`✓ [\${successCount}/\${updates.length}] \${update.name}: \${update.oldLocation} → \${update.newLocation}\`);
    } catch (error) {
      errorCount++;
      console.error(\`✗ Failed to update \${update.name}: \${error.message}\`);
    }
  }

  console.log(\`\\n=== UPDATE COMPLETE ===\`);
  console.log(\`Successful: \${successCount}\`);
  console.log(\`Failed: \${errorCount}\`);
}

updateNotionLocations().catch(console.error);
`;

  return script;
}

function generateStatistics(arrangement) {
  const stats = {
    byRow: {},
    byHouse: {},
    byNoteCategory: {}
  };

  for (let row = 1; row <= 8; row++) {
    const rowBottles = arrangement.filter(b => b.targetRow === row);
    const fallCount = rowBottles.filter(b => b.seasons.includes(CURRENT_SEASON)).length;
    stats.byRow[row] = {
      total: rowBottles.length,
      fall: fallCount,
      percentage: rowBottles.length > 0 ? ((fallCount / rowBottles.length) * 100).toFixed(1) : 0
    };
  }

  arrangement.forEach(bottle => {
    stats.byHouse[bottle.house] = (stats.byHouse[bottle.house] || 0) + 1;
    stats.byNoteCategory[bottle.noteCategory] = (stats.byNoteCategory[bottle.noteCategory] || 0) + 1;
  });

  return stats;
}

function generateTrackingHTML(arrangement, stats) {
  console.log('Generating interactive tracking page...\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Perfume Arrangement Tracker</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #1a1a1a;
      color: #e0e0e0;
      padding: 20px;
      line-height: 1.6;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 {
      text-align: center;
      margin-bottom: 10px;
      color: #fff;
      font-size: 2em;
    }
    .stats {
      background: #2a2a2a;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 15px;
    }
    .stat-item {
      background: #333;
      padding: 15px;
      border-radius: 6px;
    }
    .stat-item h3 { color: #4CAF50; margin-bottom: 8px; font-size: 0.9em; }
    .progress-bar {
      background: #444;
      height: 30px;
      border-radius: 15px;
      overflow: hidden;
      margin: 15px 0;
    }
    .progress-fill {
      background: linear-gradient(90deg, #4CAF50, #45a049);
      height: 100%;
      transition: width 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 0.9em;
    }
    .row-section {
      background: #2a2a2a;
      border-radius: 8px;
      margin-bottom: 15px;
      overflow: hidden;
    }
    .row-header {
      background: #333;
      padding: 15px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
    }
    .row-header:hover { background: #3a3a3a; }
    .row-title {
      font-size: 1.2em;
      font-weight: bold;
      color: #fff;
    }
    .row-progress {
      font-size: 0.9em;
      color: #aaa;
    }
    .row-content {
      padding: 10px;
      display: none;
    }
    .row-content.expanded { display: block; }
    .move-item {
      background: #333;
      padding: 12px 15px;
      margin: 8px 0;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 15px;
      transition: all 0.2s ease;
    }
    .move-item:hover { background: #3a3a3a; }
    .move-item.completed {
      opacity: 0.5;
      background: #2a4a2a;
    }
    input[type="checkbox"] {
      width: 20px;
      height: 20px;
      cursor: pointer;
      accent-color: #4CAF50;
    }
    .move-details {
      flex: 1;
      display: grid;
      grid-template-columns: 150px 1fr 150px;
      gap: 15px;
      align-items: center;
    }
    .target-slot {
      color: #4CAF50;
      font-weight: bold;
      font-family: monospace;
    }
    .bottle-name {
      color: #fff;
      font-weight: 500;
    }
    .current-location {
      color: #ff9800;
      font-family: monospace;
      text-align: right;
    }
    .expand-icon {
      transition: transform 0.3s ease;
      color: #4CAF50;
    }
    .expanded .expand-icon {
      transform: rotate(90deg);
    }
    @media (max-width: 768px) {
      .move-details {
        grid-template-columns: 1fr;
        gap: 5px;
      }
      .current-location { text-align: left; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🌸 Perfume Arrangement Tracker</h1>

    <div class="stats">
      <div class="stat-item">
        <h3>TOTAL MOVES</h3>
        <div style="font-size: 2em; color: #fff;">${arrangement.length}</div>
      </div>
      <div class="stat-item">
        <h3>SEASON</h3>
        <div style="font-size: 2em; color: #fff;">${CURRENT_SEASON}</div>
      </div>
      <div class="stat-item">
        <h3>GENERATED</h3>
        <div style="font-size: 1em; color: #fff;">${new Date().toLocaleString()}</div>
      </div>
    </div>

    <div class="progress-bar">
      <div class="progress-fill" id="overallProgress">0 / ${arrangement.length} (0%)</div>
    </div>

${generateRowSections(arrangement)}
  </div>

  <script>
    // Load saved progress from localStorage
    const savedProgress = JSON.parse(localStorage.getItem('perfumeProgress') || '{}');

    // Apply saved checkboxes
    Object.keys(savedProgress).forEach(id => {
      const checkbox = document.getElementById(id);
      if (checkbox && savedProgress[id]) {
        checkbox.checked = true;
        checkbox.closest('.move-item').classList.add('completed');
      }
    });

    // Update progress
    function updateProgress() {
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      const total = checkboxes.length;
      const completed = Array.from(checkboxes).filter(cb => cb.checked).length;
      const percentage = Math.round((completed / total) * 100);

      document.getElementById('overallProgress').textContent =
        \`\${completed} / \${total} (\${percentage}%)\`;
      document.getElementById('overallProgress').style.width = percentage + '%';

      // Update row progress
      document.querySelectorAll('.row-section').forEach(section => {
        const rowCheckboxes = section.querySelectorAll('input[type="checkbox"]');
        const rowTotal = rowCheckboxes.length;
        const rowCompleted = Array.from(rowCheckboxes).filter(cb => cb.checked).length;
        const rowPercentage = Math.round((rowCompleted / rowTotal) * 100);

        const progressEl = section.querySelector('.row-progress');
        progressEl.textContent = \`\${rowCompleted}/\${rowTotal} (\${rowPercentage}%)\`;
      });
    }

    // Handle checkbox changes
    document.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      checkbox.addEventListener('change', function() {
        const moveItem = this.closest('.move-item');
        moveItem.classList.toggle('completed', this.checked);

        // Save to localStorage
        savedProgress[this.id] = this.checked;
        localStorage.setItem('perfumeProgress', JSON.stringify(savedProgress));

        updateProgress();
      });
    });

    // Toggle row sections
    document.querySelectorAll('.row-header').forEach(header => {
      header.addEventListener('click', function() {
        const content = this.nextElementSibling;
        content.classList.toggle('expanded');
        this.classList.toggle('expanded');
      });
    });

    // Initial progress update
    updateProgress();

    // Expand first row by default
    document.querySelector('.row-header').click();
  </script>
</body>
</html>`;

  return html;
}

function generateRowSections(arrangement) {
  let html = '';

  for (let row = 1; row <= 8; row++) {
    const rowBottles = arrangement.filter(b => b.targetRow === row);
    if (rowBottles.length === 0) continue;

    const accessibility = row <= 3 ? '⭐ MOST ACCESSIBLE' : row <= 5 ? 'ACCESSIBLE' : 'LESS ACCESSIBLE';

    html += `
    <div class="row-section">
      <div class="row-header">
        <div class="row-title">
          <span class="expand-icon">▶</span>
          Row ${row} - ${accessibility}
        </div>
        <div class="row-progress">0/${rowBottles.length} (0%)</div>
      </div>
      <div class="row-content">`;

    rowBottles.forEach((bottle, idx) => {
      const moveId = `move-${row}-${idx}`;
      html += `
        <div class="move-item">
          <input type="checkbox" id="${moveId}">
          <div class="move-details">
            <div class="target-slot">${bottle.targetLocation}</div>
            <div class="bottle-name">${bottle.name}</div>
            <div class="current-location">from ${bottle.currentLocation}</div>
          </div>
        </div>`;
    });

    html += `
      </div>
    </div>`;
  }

  return html;
}

function printStatistics(stats) {
  console.log('=== ARRANGEMENT STATISTICS ===\n');

  console.log('Distribution by Row:');
  for (let row = 1; row <= 8; row++) {
    const s = stats.byRow[row];
    console.log(`  Row ${row}: ${s.total} bottles | ${s.fall} Fall (${s.percentage}%)`);
  }

  console.log('\nTop Houses:');
  const topHouses = Object.entries(stats.byHouse)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  topHouses.forEach(([house, count]) => {
    console.log(`  ${house}: ${count} bottles`);
  });

  console.log('\nNote Categories:');
  Object.entries(stats.byNoteCategory)
    .sort((a, b) => b[1] - a[1])
    .forEach(([category, count]) => {
      console.log(`  ${category}: ${count} bottles`);
    });

  console.log('');
}

async function main() {
  try {
    // Fetch bottles
    const bottles = await fetchAllBottles();

    // Optimize arrangement
    const arrangement = optimizeArrangement(bottles);

    // Generate statistics
    const stats = generateStatistics(arrangement);
    printStatistics(stats);

    // Generate move list
    const moveList = generateMoveList(arrangement);
    fs.writeFileSync('optimalArrangement.txt', moveList);
    console.log('✓ Move list saved to: optimalArrangement.txt');

    // Generate Notion update script
    const updateScript = generateNotionUpdateScript(arrangement);
    fs.writeFileSync('updateNotionLocations.js', updateScript);
    console.log('✓ Notion update script saved to: updateNotionLocations.js');

    // Generate tracking HTML
    const trackingHTML = generateTrackingHTML(arrangement, stats);
    fs.writeFileSync('arrangementTracker.html', trackingHTML);
    console.log('✓ Interactive tracker saved to: arrangementTracker.html');

    console.log('\n=== NEXT STEPS ===');
    console.log('1. Open arrangementTracker.html in your browser');
    console.log('2. Check off bottles as you move them');
    console.log('3. Progress is saved automatically in your browser');
    console.log('4. When done, run: node updateNotionLocations.js');
    console.log('5. Verify updates in Notion\n');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
