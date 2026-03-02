#!/usr/bin/env node

/**
 * Command-line tool to optimize perfume bottle arrangement
 * 
 * Usage: node optimizeBottles.js [--apply]
 * 
 * Options:
 *   --apply  Apply the optimization to bottleSwaps.txt (default: only generate optimalBottleSwaps.txt)
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Parse command-line arguments
const args = process.argv.slice(2);
const shouldApply = args.includes('--apply');

// Check for a season parameter with strict validation
const validSeasons = ['spring', 'summer', 'fall', 'winter'];
let seasonParam = '';
for (const arg of args) {
  const seasonMatch = arg.match(/^--season=(\w+)$/i);
  if (seasonMatch) {
    const seasonValue = seasonMatch[1].toLowerCase();
    if (validSeasons.includes(seasonValue)) {
      seasonParam = `--season=${seasonMatch[1]}`;
    } else {
      console.error(`❌ Invalid season: "${seasonMatch[1]}". Valid seasons: ${validSeasons.join(', ')}`);
      process.exit(1);
    }
    break;
  }
}

// Paths
const scriptPath = path.join(__dirname, 'scripts', 'optimizeBottleArrangement.js');
const outputPath = path.join(__dirname, 'optimalBottleSwaps.txt');
const targetPath = path.join(__dirname, 'bottleSwaps.txt');

console.log('🧪 Optimizing perfume bottle arrangement...');
if (seasonParam) {
  console.log(`Using season: ${seasonParam.split('=')[1]}`);
}

// Run the optimization script with season parameter if provided
const execArgs = [scriptPath];
if (seasonParam) {
  execArgs.push(seasonParam);
}
execFile(process.execPath, execArgs, (error, stdout, stderr) => {
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
    console.log('\n💡 To specify a different season, use --season:');
    console.log('   node optimizeBottles.js --season=Summer');
    console.log('   node optimizeBottles.js --season=Summer --apply');
  }
});
