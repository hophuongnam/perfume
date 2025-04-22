#!/usr/bin/env node

/**
 * Command-line tool to optimize perfume bottle arrangement
 * 
 * Usage: node optimizeBottles.js [--apply]
 * 
 * Options:
 *   --apply  Apply the optimization to bottleSwaps.txt (default: only generate optimalBottleSwaps.txt)
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Parse command-line arguments
const args = process.argv.slice(2);
const shouldApply = args.includes('--apply');

// Paths
const scriptPath = path.join(__dirname, 'scripts', 'optimizeBottleArrangement.js');
const outputPath = path.join(__dirname, 'optimalBottleSwaps.txt');
const targetPath = path.join(__dirname, 'bottleSwaps.txt');

console.log('🧪 Optimizing perfume bottle arrangement...');

// Run the optimization script
exec(`node ${scriptPath}`, (error, stdout, stderr) => {
  if (error) {
    console.error('❌ Error running optimization:', error.message);
    if (stdout) {
      console.log('\nScript output before error:');
      console.log(stdout);
    }
    
    console.log('\n🔍 Possible issues:');
    console.log('1. Missing bottle in your Notion database at a position referenced by the algorithm');
    console.log('2. Inconsistent position formatting (expected format is column-row)');
    console.log('3. Check if all bottles have valid positions in the Notion database');
    console.log('4. Position references may be out of range (rows should be 1-8)');
    process.exit(1);
  }
  
  if (stderr) {
    console.error('⚠️ Warnings:', stderr);
  }
  
  // Display output from the script
  console.log(stdout);
  
  // Check if output file exists
  if (!fs.existsSync(outputPath)) {
    console.error('❌ Output file not found:', outputPath);
    process.exit(1);
  }
  
  console.log(`✅ Optimization complete. Results saved to: ${outputPath}`);
  
  // Apply to bottleSwaps.txt if requested
  if (shouldApply) {
    try {
      fs.copyFileSync(outputPath, targetPath);
      console.log(`✅ Applied optimization to: ${targetPath}`);
    } catch (err) {
      console.error('❌ Error applying optimization:', err.message);
      process.exit(1);
    }
  } else {
    console.log('\n💡 To apply this optimization, run with --apply:');
    console.log('   node optimizeBottles.js --apply');
  }
});
