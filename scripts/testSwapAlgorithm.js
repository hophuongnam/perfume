/**
 * Test script for verifying the optimized swap algorithm
 * This script tests the algorithm with various test cases to ensure it uses the minimum number of swaps
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

// Test case 1: Simple swap - 2 bottles
function testSimpleSwap() {
  console.log("\n===== Test Case 1: Simple Swap (2 bottles) =====");
  
  // Current positions: two bottles
  const currentPositions = createTestBottles([
    { row: 1, column: 1 }, // Bottle 0
    { row: 2, column: 2 }  // Bottle 1
  ]);
  
  // Optimal positions: swap the two bottles
  const optimalPositions = createTestBottles([
    { row: 2, column: 2 }, // Bottle 0 should be in position of Bottle 1
    { row: 1, column: 1 }  // Bottle 1 should be in position of Bottle 0
  ]);
  
  // Expected: 1 swap
  const minimumSwaps = bottleUtils.calculateMinimumSwaps(currentPositions, optimalPositions);
  console.log(`Minimum swaps required: ${minimumSwaps}`);
  
  const swapPlan = bottleUtils.generateSwapPlan(currentPositions, optimalPositions);
  console.log(`Generated ${swapPlan.length} swaps`);
  
  const validation = bottleUtils.validateSwapPlan(swapPlan, minimumSwaps);
  console.log(`Validation: ${validation.message}`);
  
  // Show the swap
  if (swapPlan.length > 0) {
    console.log("\nSwap Details:");
    swapPlan.forEach((swap, i) => {
      console.log(`Swap ${i+1}: From (${swap.from.row}, ${swap.from.column}) to (${swap.to.row}, ${swap.to.column})`);
    });
  }
  
  return validation.valid;
}

// Test case 2: Cycle of 3 bottles
function testCycleOfThree() {
  console.log("\n===== Test Case 2: Cycle of 3 Bottles =====");
  
  // Current positions
  const currentPositions = createTestBottles([
    { row: 1, column: 1 }, // Bottle 0
    { row: 2, column: 2 }, // Bottle 1
    { row: 3, column: 3 }  // Bottle 2
  ]);
  
  // Optimal positions: a cycle of 3
  const optimalPositions = createTestBottles([
    { row: 3, column: 3 }, // Bottle 0 should be in position of Bottle 2
    { row: 1, column: 1 }, // Bottle 1 should be in position of Bottle 0
    { row: 2, column: 2 }  // Bottle 2 should be in position of Bottle 1
  ]);
  
  // Expected: 2 swaps
  const minimumSwaps = bottleUtils.calculateMinimumSwaps(currentPositions, optimalPositions);
  console.log(`Minimum swaps required: ${minimumSwaps}`);
  
  const swapPlan = bottleUtils.generateSwapPlan(currentPositions, optimalPositions);
  console.log(`Generated ${swapPlan.length} swaps`);
  
  const validation = bottleUtils.validateSwapPlan(swapPlan, minimumSwaps);
  console.log(`Validation: ${validation.message}`);
  
  // Show the swaps
  if (swapPlan.length > 0) {
    console.log("\nSwap Details:");
    swapPlan.forEach((swap, i) => {
      console.log(`Swap ${i+1}: From (${swap.from.row}, ${swap.from.column}) to (${swap.to.row}, ${swap.to.column})`);
    });
  }
  
  return validation.valid;
}

// Test case 3: Multiple cycles
function testMultipleCycles() {
  console.log("\n===== Test Case 3: Multiple Cycles =====");
  
  // Current positions
  const currentPositions = createTestBottles([
    { row: 1, column: 1 }, // Bottle 0
    { row: 2, column: 2 }, // Bottle 1
    { row: 3, column: 3 }, // Bottle 2
    { row: 4, column: 4 }, // Bottle 3
    { row: 5, column: 5 }, // Bottle 4
    { row: 6, column: 6 }  // Bottle 5
  ]);
  
  // Optimal positions: two cycles (0,1,2) and (3,4,5)
  const optimalPositions = createTestBottles([
    { row: 2, column: 2 }, // Bottle 0 goes to position of Bottle 1
    { row: 3, column: 3 }, // Bottle 1 goes to position of Bottle 2
    { row: 1, column: 1 }, // Bottle 2 goes to position of Bottle 0
    { row: 5, column: 5 }, // Bottle 3 goes to position of Bottle 4
    { row: 6, column: 6 }, // Bottle 4 goes to position of Bottle 5
    { row: 4, column: 4 }  // Bottle 5 goes to position of Bottle 3
  ]);
  
  // Expected: 4 swaps (2 for each cycle)
  const minimumSwaps = bottleUtils.calculateMinimumSwaps(currentPositions, optimalPositions);
  console.log(`Minimum swaps required: ${minimumSwaps}`);
  
  const swapPlan = bottleUtils.generateSwapPlan(currentPositions, optimalPositions);
  console.log(`Generated ${swapPlan.length} swaps`);
  
  const validation = bottleUtils.validateSwapPlan(swapPlan, minimumSwaps);
  console.log(`Validation: ${validation.message}`);
  
  // Show the swaps
  if (swapPlan.length > 0) {
    console.log("\nSwap Details:");
    swapPlan.forEach((swap, i) => {
      console.log(`Swap ${i+1}: From (${swap.from.row}, ${swap.from.column}) to (${swap.to.row}, ${swap.to.column})`);
    });
  }
  
  return validation.valid;
}

// Test case 4: Complex arrangement with some bottles already in correct positions
function testComplexArrangement() {
  console.log("\n===== Test Case 4: Complex Arrangement =====");
  
  // Current positions
  const currentPositions = createTestBottles([
    { row: 1, column: 1 }, // Bottle 0
    { row: 2, column: 2 }, // Bottle 1 
    { row: 3, column: 3 }, // Bottle 2
    { row: 4, column: 4 }, // Bottle 3
    { row: 5, column: 5 }, // Bottle 4
    { row: 6, column: 6 }, // Bottle 5
    { row: 7, column: 7 }, // Bottle 6
    { row: 8, column: 8 }  // Bottle 7
  ]);
  
  // Optimal positions: mix of cycles and bottles in correct positions
  const optimalPositions = createTestBottles([
    { row: 1, column: 1 }, // Bottle 0 stays in place
    { row: 3, column: 3 }, // Bottle 1 goes to position of Bottle 2
    { row: 5, column: 5 }, // Bottle 2 goes to position of Bottle 4
    { row: 4, column: 4 }, // Bottle 3 stays in place
    { row: 2, column: 2 }, // Bottle 4 goes to position of Bottle 1
    { row: 8, column: 8 }, // Bottle 5 goes to position of Bottle 7
    { row: 6, column: 6 }, // Bottle 6 stays in place
    { row: 7, column: 7 }  // Bottle 7 goes to position of Bottle 6
  ]);
  
  // Expected: 4 swaps (one cycle of 3, one cycle of 2)
  const minimumSwaps = bottleUtils.calculateMinimumSwaps(currentPositions, optimalPositions);
  console.log(`Minimum swaps required: ${minimumSwaps}`);
  
  const swapPlan = bottleUtils.generateSwapPlan(currentPositions, optimalPositions);
  console.log(`Generated ${swapPlan.length} swaps`);
  
  const validation = bottleUtils.validateSwapPlan(swapPlan, minimumSwaps);
  console.log(`Validation: ${validation.message}`);
  
  // Show the swaps
  if (swapPlan.length > 0) {
    console.log("\nSwap Details:");
    swapPlan.forEach((swap, i) => {
      console.log(`Swap ${i+1}: From (${swap.from.row}, ${swap.from.column}) to (${swap.to.row}, ${swap.to.column})`);
    });
  }
  
  return validation.valid;
}

// Run all tests
function runAllTests() {
  console.log("=== Starting Swap Algorithm Tests ===\n");
  
  let passedTests = 0;
  let totalTests = 4;
  
  if (testSimpleSwap()) passedTests++;
  if (testCycleOfThree()) passedTests++;
  if (testMultipleCycles()) passedTests++;
  if (testComplexArrangement()) passedTests++;
  
  console.log(`\n=== Test Results: ${passedTests}/${totalTests} tests passed ===`);
  
  if (passedTests === totalTests) {
    console.log("✓ All tests passed! The algorithm is correctly using the minimum number of swaps.");
  } else {
    console.log("✗ Some tests failed. The algorithm may not be using the minimum number of swaps.");
  }
}

// Execute tests
runAllTests();