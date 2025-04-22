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
 * based on the cycle detection method.
 * 
 * The minimum number of swaps to transform one permutation into another
 * is (n - c) where n is the number of elements and c is the number of cycles.
 */
function calculateMinimumSwaps(currentPositions, optimalPositions) {
  // Create position mapping for bottles - maps from position key to bottle index
  const positionMap = new Map();
  
  for (let i = 0; i < currentPositions.length; i++) {
    const bottle = currentPositions[i];
    // Use consistent format column-row to match the display format in bottleSwaps.txt
    const key = `${bottle.column}-${bottle.row}`;
    positionMap.set(key, i);
  }
  
  // Track visited bottles
  const visited = new Array(currentPositions.length).fill(false);
  let swaps = 0;
  let cycles = 0;
  
  // Find cycles and calculate swaps
  for (let i = 0; i < currentPositions.length; i++) {
    // Skip if already visited
    if (visited[i]) continue;
    
    // Check if bottle is already in correct position
    if (currentPositions[i].row === optimalPositions[i].row && 
        currentPositions[i].column === optimalPositions[i].column) {
      visited[i] = true;
      cycles++; // A bottle in the correct position is a cycle of size 1
      continue;
    }
    
    // Start a new cycle
    let cycleSize = 0;
    let j = i;
    let cycleComplete = false;
    
    while (!visited[j]) {
      visited[j] = true;
      cycleSize++;
      
      // Find next bottle in cycle
      const targetRow = optimalPositions[j].row;
      const targetColumn = optimalPositions[j].column;
      // Use consistent format column-row to match the display format in bottleSwaps.txt
      const targetKey = `${targetColumn}-${targetRow}`;
      
      // If there's no bottle at this position, handle this special case
      if (!positionMap.has(targetKey)) {
        console.warn(`Warning: No bottle found at position ${targetKey} (column-row format). Check if this location exists in your Notion database.`);
        break;
      }
      
      j = positionMap.get(targetKey);
      
      // If we've reached the start of the cycle, mark it complete
      if (j === i) {
        cycleComplete = true;
        break;
      }
    }
    
    // If we found a complete cycle, count it
    if (cycleComplete || cycleSize > 0) {
      cycles++;
      // Number of swaps needed for a cycle is cycleSize - 1
      swaps += (cycleSize - 1);
    }
  }
  
  console.log(`Found ${cycles} cycles in the permutation`);
  return swaps;
}

/**
 * Generate optimal swap plan based on current and optimal positions
 * This implementation uses cycle detection to generate the minimum number of swaps
 */
function generateSwapPlan(currentBottles, optimalBottles) {
  // First calculate the theoretical minimum number of swaps
  const theoreticalMinimum = calculateMinimumSwaps(currentBottles, optimalBottles);
  console.log(`Theoretical minimum swaps: ${theoreticalMinimum}`);

  // Build mappings for efficient lookups
  const currentPosToIndex = new Map(); // Maps position key to index in currentBottles
  const optimalPosToIndex = new Map(); // Maps position key to index in optimalBottles
  const currentIdxToPosition = new Map(); // Maps bottle index to position key
  
  // Initialize mappings
  for (let i = 0; i < currentBottles.length; i++) {
    const currBottle = currentBottles[i];
    const optBottle = optimalBottles[i];
    
    // Use consistent format column-row to match the display format in bottleSwaps.txt
    const currKey = `${currBottle.column}-${currBottle.row}`;
    const optKey = `${optBottle.column}-${optBottle.row}`;
    
    currentPosToIndex.set(currKey, i);
    optimalPosToIndex.set(optKey, i);
    currentIdxToPosition.set(i, currKey);
  }
  
  // Track processed bottles
  const processed = new Array(currentBottles.length).fill(false);
  const swaps = [];
  
  // For each bottle, find and follow its cycle
  for (let i = 0; i < currentBottles.length; i++) {
    if (processed[i]) continue;
    
    // Check if bottle is already in correct position
    const currBottle = currentBottles[i];
    const optBottle = optimalBottles[i];
    
    if (currBottle.row === optBottle.row && currBottle.column === optBottle.column) {
      processed[i] = true;
      continue;
    }
    
    // Start a new cycle
    let cycleStart = i;
    let j = i;
    const cycle = [];
    
    // Follow the cycle
    while (!processed[j]) {
      cycle.push(j);
      processed[j] = true;
      
      // Find where the bottle at index j should go in the optimal arrangement
      const optRow = optimalBottles[j].row;
      const optCol = optimalBottles[j].column;
      // Use consistent format column-row to match the display format in bottleSwaps.txt
      const targetKey = `${optCol}-${optRow}`;
      
      // Find which bottle is currently in that position
      if (!currentPosToIndex.has(targetKey)) {
        // This shouldn't happen in a valid permutation, but handle it gracefully
        console.warn(`Warning: No bottle found at position ${targetKey} (column-row format). Check if this location exists in your Notion database.`);
        break;
      }
      
      j = currentPosToIndex.get(targetKey);
      
      // If we've reached the start of the cycle, we're done with this cycle
      if (j === cycleStart) break;
    }
    
    // Generate swaps for this cycle (cycleSize - 1 swaps)
    if (cycle.length > 1) {
      // We want the first bottle to end up in the last position
      // Each swap moves a bottle to where the previous bottle in the cycle should go
      for (let k = 0; k < cycle.length - 1; k++) {
        const fromIdx = cycle[k];
        const toIdx = cycle[k + 1];
        
        const fromBottle = currentBottles[fromIdx];
        const toBottle = currentBottles[toIdx];
        
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
      }
    }
  }
  
  // Validate that we have the minimum number of swaps
  if (swaps.length !== theoreticalMinimum) {
    console.warn(`Warning: Generated ${swaps.length} swaps, but theoretical minimum is ${theoreticalMinimum}`);
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

/**
 * Validate that the swap plan uses the minimum number of swaps
 */
function validateSwapPlan(swaps, minimumSwaps) {
  if (swaps.length !== minimumSwaps) {
    return {
      valid: false,
      message: `Generated ${swaps.length} swaps, but calculated minimum is ${minimumSwaps}`
    };
  }
  
  return {
    valid: true,
    message: `Swap plan is optimal with ${swaps.length} swaps`
  };
}

module.exports = {
  getCurrentSeason,
  calculateBottleScore,
  calculateMinimumSwaps,
  generateSwapPlan,
  formatSwapPlan,
  validateSwapPlan,
  SEASONAL_PREFERENCES
};
