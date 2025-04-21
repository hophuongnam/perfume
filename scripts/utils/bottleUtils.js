/**
 * Utility functions for perfume bottle organization
 */

// Seasonal preferences for notes and accords
const SEASONAL_PREFERENCES = {
  Spring: {
    notes: ['Citrus', 'Bergamot', 'Lemon', 'Neroli', 'Orange Blossom', 'Petitgrain', 'Grapefruit', 
            'Lavender', 'Rose', 'Green Apple', 'Mint', 'Basil', 'Grass', 'Green Tea', 'Jasmine'],
    accords: ['Citrus', 'Fresh', 'Green', 'Aromatic', 'Floral', 'Light', 'Aquatic', 'Clean']
  },
  Summer: {
    notes: ['Coconut', 'Tiare Flower', 'Sea Salt', 'Marine', 'Aquatic', 'Melon', 'Peach', 'Lime', 
            'Mint', 'Lemon', 'Basil', 'Bergamot', 'Neroli', 'Orange Blossom', 'Jasmine'],
    accords: ['Aquatic', 'Marine', 'Fruity', 'Fresh', 'Citrus', 'Tropical', 'Solar', 'Light']
  },
  Fall: {
    notes: ['Apple', 'Cinnamon', 'Cardamom', 'Clove', 'Nutmeg', 'Cedar', 'Sandalwood', 'Patchouli', 
            'Amber', 'Vanilla', 'Benzoin', 'Tobacco', 'Leather', 'Fig', 'Plum'],
    accords: ['Spicy', 'Woody', 'Oriental', 'Sweet', 'Gourmand', 'Warm', 'Amber', 'Earthy']
  },
  Winter: {
    notes: ['Vanilla', 'Tonka Bean', 'Amber', 'Benzoin', 'Incense', 'Oud', 'Frankincense', 'Myrrh', 
            'Leather', 'Tobacco', 'Cinnamon', 'Clove', 'Pine', 'Coffee', 'Chocolate'],
    accords: ['Warm', 'Sweet', 'Oriental', 'Gourmand', 'Spicy', 'Resinous', 'Woody', 'Balsamic']
  }
};

/**
 * Determine current season based on Northern Hemisphere
 */
function getCurrentSeason() {
  const now = new Date();
  const month = now.getMonth(); // 0-11
  
  if (month >= 2 && month <= 4) {
    return 'Spring';
  } else if (month >= 5 && month <= 7) {
    return 'Summer';
  } else if (month >= 8 && month <= 10) {
    return 'Fall';
  } else {
    return 'Winter';
  }
}

/**
 * Calculate a perfume bottle's score based on season, notes, and accords
 */
function calculateBottleScore(bottle, season) {
  let score = 0;
  
  // Score for seasonal match
  if (bottle.seasons.includes(season)) {
    score += 30;
  }
  
  // Score for adjacent seasons
  const adjacentSeasons = {
    'Spring': ['Summer', 'Winter'],
    'Summer': ['Spring', 'Fall'],
    'Fall': ['Summer', 'Winter'],
    'Winter': ['Fall', 'Spring']
  };
  
  for (const bottleSeason of bottle.seasons) {
    if (adjacentSeasons[season]?.includes(bottleSeason)) {
      score += 15;
    }
  }
  
  // Score for notes appropriate for current season
  const seasonNotes = SEASONAL_PREFERENCES[season].notes;
  const allNotes = [...bottle.notes, ...bottle.topNotes, ...bottle.middleNotes, ...bottle.baseNotes];
  
  for (const note of allNotes) {
    if (seasonNotes.some(seasonNote => note.toLowerCase().includes(seasonNote.toLowerCase()))) {
      score += 2;
    }
  }
  
  // Score for accords appropriate for current season
  const seasonAccords = SEASONAL_PREFERENCES[season].accords;
  
  for (const accord of bottle.accords) {
    if (seasonAccords.some(seasonAccord => accord.toLowerCase().includes(seasonAccord.toLowerCase()))) {
      score += 3;
    }
  }
  
  // Additional weights for specific time preferences
  if (bottle.time.includes('Day') && (season === 'Spring' || season === 'Summer')) {
    score += 5;
  }
  if (bottle.time.includes('Night') && (season === 'Fall' || season === 'Winter')) {
    score += 5;
  }
  
  return score;
}

/**
 * Calculate the minimum number of swaps required to rearrange bottles
 * based on the cycle detection method
 */
function calculateMinimumSwaps(currentPositions, optimalPositions) {
  // Create position mapping for bottles
  const positionMap = new Map();
  
  for (let i = 0; i < currentPositions.length; i++) {
    const bottle = currentPositions[i];
    const key = `${bottle.row}-${bottle.column}`;
    positionMap.set(key, i);
  }
  
  // Track visited bottles
  const visited = new Array(currentPositions.length).fill(false);
  let swaps = 0;
  
  // Find cycles and calculate swaps
  for (let i = 0; i < currentPositions.length; i++) {
    // If bottle is already in correct position or already visited
    if (visited[i] || (
      currentPositions[i].row === optimalPositions[i].row && 
      currentPositions[i].column === optimalPositions[i].column
    )) {
      visited[i] = true;
      continue;
    }
    
    // Count nodes in this cycle
    let cycleSize = 0;
    let j = i;
    
    while (!visited[j]) {
      visited[j] = true;
      cycleSize++;
      
      // Find next bottle in cycle
      const targetRow = optimalPositions[j].row;
      const targetColumn = optimalPositions[j].column;
      const targetKey = `${targetRow}-${targetColumn}`;
      
      // If there's no bottle at this position, break cycle
      if (!positionMap.has(targetKey)) {
        break;
      }
      
      j = positionMap.get(targetKey);
    }
    
    // Number of swaps needed for a cycle is cycleSize - 1
    if (cycleSize > 0) {
      swaps += (cycleSize - 1);
    }
  }
  
  return swaps;
}

/**
 * Generate optimal swap plan based on current and optimal positions
 */
function generateSwapPlan(currentBottles, optimalBottles) {
  const swaps = [];
  const bottlesMap = new Map();
  
  // Create mapping for current bottle positions
  for (const bottle of currentBottles) {
    const key = `${bottle.row}-${bottle.column}`;
    bottlesMap.set(key, bottle);
  }
  
  // Create a copy of current bottles for simulation
  const simulatedBottles = JSON.parse(JSON.stringify(currentBottles));
  const simulatedMap = new Map();
  
  // Initialize simulated map
  for (const bottle of simulatedBottles) {
    const key = `${bottle.row}-${bottle.column}`;
    simulatedMap.set(key, bottle);
  }
  
  // For each bottle, find its optimal position
  for (let i = 0; i < optimalBottles.length; i++) {
    const optimalPosition = optimalBottles[i];
    const currentPosition = simulatedBottles[i];
    
    // If bottle is already in correct position, skip
    if (currentPosition.row === optimalPosition.row && 
        currentPosition.column === optimalPosition.column) {
      continue;
    }
    
    // Generate swap
    const fromKey = `${currentPosition.row}-${currentPosition.column}`;
    const toKey = `${optimalPosition.row}-${optimalPosition.column}`;
    
    // Only create swap if destination position has a bottle
    if (simulatedMap.has(toKey)) {
      const fromBottle = simulatedMap.get(fromKey);
      const toBottle = simulatedMap.get(toKey);
      
      // Add swap to list
      swaps.push({
        from: { 
          name: fromBottle.name, 
          house: fromBottle.house, 
          row: fromBottle.row, 
          column: fromBottle.column 
        },
        to: { 
          name: toBottle.name, 
          house: toBottle.house, 
          row: toBottle.row, 
          column: toBottle.column 
        }
      });
      
      // Update simulated positions after this swap
      const tempRow = fromBottle.row;
      const tempCol = fromBottle.column;
      
      fromBottle.row = toBottle.row;
      fromBottle.column = toBottle.column;
      toBottle.row = tempRow;
      toBottle.column = tempCol;
      
      // Update simulated map
      simulatedMap.set(`${fromBottle.row}-${fromBottle.column}`, fromBottle);
      simulatedMap.set(`${toBottle.row}-${toBottle.column}`, toBottle);
    }
  }
  
  return swaps;
}

/**
 * Format swap plan into a readable format
 */
function formatSwapPlan(swaps, currentSeason) {
  let output = `Perfume Bottle Seasonal Swaps - ${currentSeason} ${new Date().getFullYear()} (OPTIMIZED ARRANGEMENT)\n\n`;
  output += `Total swaps needed: ${swaps.length}\n\n`;
  
  // Row preference explanation
  output += `COLUMN-ROW PREFERENCE ORDER:\n`;
  output += `Row 1: Most preferred/accessible (front)\n`;
  output += `...\n`;
  output += `Row 8: Least preferred/accessible (back)\n\n`;
  output += `Note: Location format is COLUMN-ROW (e.g., Column 30, Row 3)\n\n`;
  
  output += `SWAP PLAN:\n\n`;
  
  // Group swaps by destination row for better organization
  const rowGroups = {};
  swaps.forEach(swap => {
    const toRow = swap.to.row;
    if (!rowGroups[toRow]) {
      rowGroups[toRow] = [];
    }
    rowGroups[toRow].push(swap);
  });
  
  // Get all rows in numerical order
  const rows = Object.keys(rowGroups).map(Number).sort((a, b) => a - b);
  
  let swapIndex = 1;
  rows.forEach(row => {
    const rowSwaps = rowGroups[row];
    output += `ROW ${row} SWAPS:\n`;
    
    rowSwaps.forEach(swap => {
      output += `${swapIndex}. From: ${swap.from.name} (${swap.from.house}) - Column ${swap.from.column}, Row ${swap.from.row}\n`;
      output += `   To: ${swap.to.name} (${swap.to.house}) - Column ${swap.to.column}, Row ${swap.to.row}\n\n`;
      swapIndex++;
    });
  });
  
  output += `Notes: This swap plan minimizes the total number of bottle movements while organizing by seasonal appropriateness, notes, and accords. The most suitable bottles for ${currentSeason} are placed in rows 1-3, while less suitable bottles are moved to higher-numbered rows.`;
  
  return output;
}

module.exports = {
  getCurrentSeason,
  calculateBottleScore,
  calculateMinimumSwaps,
  generateSwapPlan,
  formatSwapPlan,
  SEASONAL_PREFERENCES
};
