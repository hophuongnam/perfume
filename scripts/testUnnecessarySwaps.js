/**
 * Test script specifically for unnecessary and redundant swaps
 * This tests that our fix correctly filters out these problematic swaps
 */

const bottleUtils = require('./utils/bottleUtils');

// Helper function to create test bottles with given positions
function createTestBottles(positions) {
  return positions.map((pos, i) => ({
    id: `bottle-${i}`,
    name: `Bottle ${i}`,
    house: `House ${i}`,
    plane: 1,
    row: pos.row,
    column: pos.column,
    seasons: [],
    accords: [],
    notes: [],
    topNotes: [],
    middleNotes: [],
    baseNotes: [],
    time: []
  }));
}

// Test case: Redundant swaps (same row, different column)
function testRedundantSwaps() {
  console.log("\n===== Test: Redundant Swaps (Same Row, Different Column) =====");
  
  // Current positions
  const currentPositions = createTestBottles([
    { row: 1, column: 1 },  // Bottle 0
    { row: 1, column: 2 },  // Bottle 1
    { row: 2, column: 1 },  // Bottle 2
    { row: 2, column: 2 }   // Bottle 3
  ]);
  
  // Optimal positions with same row but different column (REDUNDANT)
  const optimalPositions = createTestBottles([
    { row: 1, column: 2 },  // Bottle 0 moves from column 1 to column 2 (REDUNDANT - same row)
    { row: 1, column: 1 },  // Bottle 1 moves from column 2 to column 1 (REDUNDANT - same row)
    { row: 2, column: 2 },  // Bottle 2 moves from column 1 to column 2 (REDUNDANT - same row)
    { row: 2, column: 1 }   // Bottle 3 moves from column 2 to column 1 (REDUNDANT - same row)
  ]);
  
  // Calculate minimum swaps
  const minimumSwaps = bottleUtils.calculateMinimumSwaps(currentPositions, optimalPositions);
  console.log(`Minimum swaps required: ${minimumSwaps}`);
  
  // Generate swap plan
  const swapPlan = bottleUtils.generateSwapPlan(currentPositions, optimalPositions);
  console.log(`Generated ${swapPlan.length} swaps (should be 0 since all are redundant)`);
  
  // Validate the plan
  const validation = bottleUtils.validateSwapPlan(swapPlan, minimumSwaps);
  console.log(`Validation: ${validation.message}`);
  
  // Show the swaps
  if (swapPlan.length > 0) {
    console.log("\nSwap Details:");
    swapPlan.forEach((swap, i) => {
      console.log(`Swap ${i+1}: From Row ${swap.from.row}, Column ${swap.from.column} to Row ${swap.to.row}, Column ${swap.to.column}`);
    });
  } else {
    console.log("\nNo swaps generated - correct, since all swaps were redundant!");
  }
  
  // Check for redundant row swaps
  let hasRedundantSwaps = false;
  swapPlan.forEach(swap => {
    if (swap.from.row === swap.to.row) {
      hasRedundantSwaps = true;
      console.log(`Found redundant swap: From Row ${swap.from.row}, Column ${swap.from.column} to Row ${swap.to.row}, Column ${swap.to.column}`);
    }
  });
  
  return !hasRedundantSwaps;
}

// Test case: Unnecessary swaps (same exact position)
function testUnnecessarySwaps() {
  console.log("\n===== Test: Unnecessary Swaps (Same Exact Position) =====");
  
  // Current positions
  const currentPositions = createTestBottles([
    { row: 1, column: 1 },  // Bottle 0
    { row: 1, column: 2 },  // Bottle 1
    { row: 2, column: 1 },  // Bottle 2
    { row: 2, column: 2 }   // Bottle 3
  ]);
  
  // Optimal positions with one bottle staying in exact same position
  const optimalPositions = createTestBottles([
    { row: 1, column: 1 },  // Bottle 0 stays in exact same position (UNNECESSARY)
    { row: 3, column: 3 },  // Bottle 1 moves to new position
    { row: 4, column: 4 },  // Bottle 2 moves to new position
    { row: 2, column: 2 }   // Bottle 3 stays in same position (UNNECESSARY)
  ]);
  
  // Calculate minimum swaps
  const minimumSwaps = bottleUtils.calculateMinimumSwaps(currentPositions, optimalPositions);
  console.log(`Minimum swaps required: ${minimumSwaps}`);
  
  // Generate swap plan
  const swapPlan = bottleUtils.generateSwapPlan(currentPositions, optimalPositions);
  console.log(`Generated ${swapPlan.length} swaps`);
  
  // Validate the plan
  const validation = bottleUtils.validateSwapPlan(swapPlan, minimumSwaps);
  console.log(`Validation: ${validation.message}`);
  
  // Show the swaps
  if (swapPlan.length > 0) {
    console.log("\nSwap Details:");
    swapPlan.forEach((swap, i) => {
      console.log(`Swap ${i+1}: From Row ${swap.from.row}, Column ${swap.from.column} to Row ${swap.to.row}, Column ${swap.to.column}`);
    });
  } else {
    console.log("\nNo swaps generated - this might happen if all swaps form closed loops that were filtered.");
  }
  
  // Check for unnecessary swaps (same exact position)
  let hasUnnecessarySwaps = false;
  swapPlan.forEach(swap => {
    if (swap.from.row === swap.to.row && swap.from.column === swap.to.column) {
      hasUnnecessarySwaps = true;
      console.log(`Found unnecessary swap: From Row ${swap.from.row}, Column ${swap.from.column} to Row ${swap.to.row}, Column ${swap.to.column}`);
    }
  });
  
  return !hasUnnecessarySwaps;
}

// Test case: Mixed swaps (necessary, redundant, and unnecessary)
function testMixedSwaps() {
  console.log("\n===== Test: Mixed Swaps (Necessary, Redundant, and Unnecessary) =====");
  
  // Current positions
  const currentPositions = createTestBottles([
    { row: 1, column: 1 },  // Bottle 0
    { row: 2, column: 2 },  // Bottle 1
    { row: 3, column: 3 },  // Bottle 2
    { row: 4, column: 4 },  // Bottle 3
    { row: 5, column: 5 },  // Bottle 4
    { row: 6, column: 6 }   // Bottle 5
  ]);
  
  // Optimal positions with a mix of different swap types
  const optimalPositions = createTestBottles([
    { row: 1, column: 1 },  // Bottle 0 stays in exact same position (UNNECESSARY)
    { row: 2, column: 3 },  // Bottle 1 changes column but stays in same row (REDUNDANT)
    { row: 5, column: 5 },  // Bottle 2 moves to different row (NECESSARY)
    { row: 4, column: 5 },  // Bottle 3 changes row and column (NECESSARY)
    { row: 3, column: 3 },  // Bottle 4 moves to different row (NECESSARY)
    { row: 6, column: 7 }   // Bottle 5 changes column but stays in same row (REDUNDANT)
  ]);
  
  // Calculate minimum swaps
  const minimumSwaps = bottleUtils.calculateMinimumSwaps(currentPositions, optimalPositions);
  console.log(`Minimum swaps required: ${minimumSwaps}`);
  
  // Generate swap plan
  const swapPlan = bottleUtils.generateSwapPlan(currentPositions, optimalPositions);
  console.log(`Generated ${swapPlan.length} swaps (should only have necessary swaps)`);
  
  // Validate the plan
  const validation = bottleUtils.validateSwapPlan(swapPlan, minimumSwaps);
  console.log(`Validation: ${validation.message}`);
  
  // Show the swaps
  if (swapPlan.length > 0) {
    console.log("\nSwap Details:");
    swapPlan.forEach((swap, i) => {
      console.log(`Swap ${i+1}: From Row ${swap.from.row}, Column ${swap.from.column} to Row ${swap.to.row}, Column ${swap.to.column}`);
    });
  } else {
    console.log("\nNo swaps generated.");
  }
  
  // Check for unnecessary and redundant swaps
  let hasUnnecessaryOrRedundantSwaps = false;
  swapPlan.forEach(swap => {
    if (swap.from.row === swap.to.row) {
      hasUnnecessaryOrRedundantSwaps = true;
      if (swap.from.column === swap.to.column) {
        console.log(`Found unnecessary swap: From Row ${swap.from.row}, Column ${swap.from.column} to Row ${swap.to.row}, Column ${swap.to.column}`);
      } else {
        console.log(`Found redundant swap: From Row ${swap.from.row}, Column ${swap.from.column} to Row ${swap.to.row}, Column ${swap.to.column}`);
      }
    }
  });
  
  return !hasUnnecessaryOrRedundantSwaps;
}

// Run the tests
function runTests() {
  console.log("=== Testing for Unnecessary and Redundant Swaps ===\n");
  
  const redundantTestPassed = testRedundantSwaps();
  const unnecessaryTestPassed = testUnnecessarySwaps();
  const mixedTestPassed = testMixedSwaps();
  
  console.log(`\n=== Test Results: ===`);
  console.log(`Redundant swaps test: ${redundantTestPassed ? "PASSED" : "FAILED"}`);
  console.log(`Unnecessary swaps test: ${unnecessaryTestPassed ? "PASSED" : "FAILED"}`);
  console.log(`Mixed swaps test: ${mixedTestPassed ? "PASSED" : "FAILED"}`);
  
  if (redundantTestPassed && unnecessaryTestPassed && mixedTestPassed) {
    console.log("\n✓ All tests passed! No unnecessary or redundant swaps detected.");
  } else {
    console.log("\n✗ Some tests failed.");
  }
}

// Execute the tests
runTests();