require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

async function analyzePlane1() {
  try {
    const pages = await notion.databases.query({ database_id: databaseId });
    const allBottles = pages.results
      .filter(page => !page.properties['Ignore?']?.checkbox)
      .map(page => {
        const locationVal = page.properties['Location']?.rich_text?.[0]?.plain_text || '0-0-0';
        const [plane, row, col] = locationVal.split('-').map(num => parseInt(num, 10) || 0);
        return {
          name: page.properties['Name']?.title?.[0]?.plain_text || '(No name)',
          house: page.properties['House']?.select?.name || 'Unknown',
          plane, row, column: col,
          seasons: page.properties['Seasons']?.multi_select?.map(s => s.name) || [],
          time: page.properties['Time']?.multi_select?.map(t => t.name) || [],
          accords: page.properties['Accords']?.multi_select?.map(a => a.name) || []
        };
      })
      .filter(b => b.plane === 1)
      .sort((a, b) => a.row === b.row ? a.column - b.column : a.row - b.row);

    const currentSeason = 'Fall';
    const currentMonth = new Date().getMonth(); // 0-11

    console.log('=== PLANE 1 COMPLETE ANALYSIS ===');
    console.log(`Current Season: ${currentSeason} (Month: ${currentMonth})`);
    console.log(`Total bottles in Plane 1: ${allBottles.length}\n`);

    // Get row range
    const rows = allBottles.map(b => b.row);
    const minRow = Math.min(...rows);
    const maxRow = Math.max(...rows);

    console.log(`Row range: ${minRow} to ${maxRow}`);
    console.log(`This suggests ${Math.floor(maxRow / 8)} to ${Math.ceil(maxRow / 8)} racks in Plane 1\n`);

    // Detailed row distribution
    const rowStats = {};
    allBottles.forEach(b => {
      if (!rowStats[b.row]) rowStats[b.row] = { total: 0, fall: 0, bottles: [] };
      rowStats[b.row].total++;
      if (b.seasons.includes(currentSeason)) rowStats[b.row].fall++;
      rowStats[b.row].bottles.push(b);
    });

    console.log('=== ROW-BY-ROW ANALYSIS ===');
    Object.keys(rowStats).sort((a,b) => a-b).forEach(row => {
      const stat = rowStats[row];
      const pct = stat.total > 0 ? ((stat.fall / stat.total) * 100).toFixed(0) : 0;
      const accessibility = row <= 1 ? 'MOST ACCESSIBLE' :
                          row <= 8 ? 'ACCESSIBLE (Rack 1)' :
                          row <= 16 ? 'LESS ACCESSIBLE (Rack 2)' :
                          'LEAST ACCESSIBLE (Rack 3+)';
      console.log(`Row ${row}: ${stat.total} bottles, ${stat.fall} Fall (${pct}%) - ${accessibility}`);
    });

    // Summary stats
    const totalFall = allBottles.filter(b => b.seasons.includes(currentSeason)).length;
    const totalNonFall = allBottles.length - totalFall;

    console.log(`\n=== PLANE 1 SUMMARY ===`);
    console.log(`Total: ${allBottles.length} bottles`);
    console.log(`Fall-suitable: ${totalFall} (${((totalFall/allBottles.length)*100).toFixed(0)}%)`);
    console.log(`Non-Fall: ${totalNonFall} (${((totalNonFall/allBottles.length)*100).toFixed(0)}%)`);

    // Row 1 specific analysis
    const row1 = rowStats[1] || { bottles: [], fall: 0, total: 0 };
    console.log(`\n=== ROW 1 DETAILS (Most Accessible) ===`);
    console.log(`Bottles in Row 1: ${row1.total}`);
    console.log(`Fall-suitable: ${row1.fall} (${row1.total > 0 ? ((row1.fall/row1.total)*100).toFixed(0) : 0}%)\n`);

    if (row1.bottles.length > 0) {
      row1.bottles.forEach(b => {
        const isFall = b.seasons.includes(currentSeason);
        const marker = isFall ? '✓ FALL' : '✗ ' + (b.seasons.join(', ') || 'No season');
        console.log(`  Col ${b.column}: ${b.name} (${b.house}) - ${marker}`);
      });
    }

    // Suggestions
    console.log(`\n=== OPTIMIZATION SUGGESTIONS ===`);

    // Find best Fall perfumes not in Row 1
    const fallBottles = allBottles.filter(b => b.seasons.includes(currentSeason) && b.row !== 1);
    const topFallCandidates = fallBottles.slice(0, 10);

    console.log(`\nTop 10 Fall perfumes to move TO Row 1:`);
    topFallCandidates.forEach((b, i) => {
      const timeInfo = b.time.length > 0 ? ` [${b.time.join(', ')}]` : '';
      console.log(`${i+1}. ${b.name} (${b.house}) - Currently Row ${b.row}, Col ${b.column}${timeInfo}`);
    });

    // Non-fall bottles in Row 1 that should move
    const row1NonFall = row1.bottles.filter(b => !b.seasons.includes(currentSeason));
    if (row1NonFall.length > 0) {
      console.log(`\n${row1NonFall.length} bottle(s) to move FROM Row 1 to back rows:`);
      row1NonFall.forEach((b, i) => {
        console.log(`${i+1}. ${b.name} (${b.house}) - ${b.seasons.join(', ') || 'No season data'}`);
      });
    }

    console.log(`\n=== KEY RECOMMENDATIONS ===`);
    console.log(`1. Row 1 should have 6-8 of your most-worn Fall fragrances`);
    console.log(`2. Currently Row 1 has only ${row1.total} bottles (${row1.fall} Fall-suitable)`);
    console.log(`3. Move ${row1NonFall.length} non-Fall bottle(s) from Row 1 to Row 8+`);
    console.log(`4. Add ${Math.max(0, 6 - row1.fall)} more Fall perfumes to Row 1`);
    console.log(`5. Consider frequency of use + time of day when selecting`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

analyzePlane1();
