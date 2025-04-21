require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

/**
 * This script runs the bottle optimization and updates the bottleSwaps.txt file
 * with the new optimal swap plan.
 */

// Path to the optimization script
const optimizeScriptPath = path.join(__dirname, 'optimizeBottleArrangement.js');

// Path to the output file
const outputFilePath = path.join(__dirname, '..', 'optimalBottleSwaps.txt');

// Path to the bottleSwaps.txt file
const bottleSwapsPath = path.join(__dirname, '..', 'bottleSwaps.txt');

/**
 * Run the optimization script
 */
function runOptimization() {
  return new Promise((resolve, reject) => {
    console.log(`Running optimization script: ${optimizeScriptPath}`);
    
    exec(`node ${optimizeScriptPath}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error running optimization: ${error.message}`);
        return reject(error);
      }
      
      if (stderr) {
        console.error(`Optimization stderr: ${stderr}`);
      }
      
      console.log(`Optimization output:\n${stdout}`);
      resolve();
    });
  });
}

/**
 * Update the bottleSwaps.txt file with the new swap plan
 */
function updateBottleSwaps() {
  try {
    // Check if the output file exists
    if (!fs.existsSync(outputFilePath)) {
      console.error(`Output file not found: ${outputFilePath}`);
      return;
    }
    
    // Read the optimized swap plan
    const optimizedSwapPlan = fs.readFileSync(outputFilePath, 'utf8');
    
    // Write to bottleSwaps.txt
    fs.writeFileSync(bottleSwapsPath, optimizedSwapPlan);
    
    console.log(`Successfully updated ${bottleSwapsPath} with optimized swap plan`);
  } catch (err) {
    console.error(`Error updating bottleSwaps.txt: ${err.message}`);
  }
}

/**
 * Main function
 */
async function main() {
  try {
    // Run the optimization
    await runOptimization();
    
    // Update the bottleSwaps.txt file
    updateBottleSwaps();
    
    console.log('Bottle organization optimization complete!');
  } catch (err) {
    console.error(`Error in main function: ${err.message}`);
    process.exit(1);
  }
}

// Execute the main function
main();
