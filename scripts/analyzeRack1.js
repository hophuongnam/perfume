require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

async function analyzeRack1() {
  const pages = await notion.databases.query({ database_id: databaseId });
  const bottles = pages.results
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

  // Current season (Fall)
  const currentSeason = 'Fall';

  // Analyze current row 1
  const row1 = bottles.filter(b => b.row === 1);
  console.log('=== CURRENT ROW 1 (Most Accessible) ===');
  console.log(`Total bottles: ${row1.length}\n`);
  row1.forEach(b => {
    const seasonMatch = b.seasons.includes(currentSeason) ? '✓ FALL' : '✗ ' + (b.seasons.join(', ') || 'No season');
    console.log(`Col ${b.column}: ${b.name} (${b.house}) - ${seasonMatch}`);
  });

  // Analyze all rows
  const rowStats = {};
  bottles.forEach(b => {
    if (!rowStats[b.row]) rowStats[b.row] = { total: 0, fallSuitable: 0, bottles: [] };
    rowStats[b.row].total++;
    if (b.seasons.includes(currentSeason)) rowStats[b.row].fallSuitable++;
    rowStats[b.row].bottles.push(b);
  });

  console.log(`\n=== ROW DISTRIBUTION (Total: ${bottles.length} bottles) ===`);
  Object.keys(rowStats).sort((a,b) => a-b).forEach(row => {
    const stat = rowStats[row];
    const pct = ((stat.fallSuitable / stat.total) * 100).toFixed(0);
    console.log(`Row ${row}: ${stat.total} bottles, ${stat.fallSuitable} Fall-suitable (${pct}%)`);
  });

  // Find best Fall perfumes currently NOT in row 1
  const fallPerfumes = bottles
    .filter(b => b.seasons.includes(currentSeason))
    .map(b => ({ ...b, inRow1: b.row === 1 }));

  const notInRow1 = fallPerfumes.filter(b => !b.inRow1).slice(0, 30);

  console.log(`\n=== TOP FALL PERFUMES NOT IN ROW 1 (showing 30) ===`);
  notInRow1.forEach((b, i) => {
    console.log(`${i+1}. ${b.name} (${b.house}) - Currently: Row ${b.row}, Col ${b.column}`);
  });

  // Suggestions for row 1
  console.log(`\n\n=== RECOMMENDATIONS FOR ROW 1 ===`);
  console.log(`\nCurrent situation:`);
  const row1FallCount = row1.filter(b => b.seasons.includes(currentSeason)).length;
  console.log(`- Row 1 has ${row1.length} bottles, only ${row1FallCount} are Fall-suitable (${((row1FallCount/row1.length)*100).toFixed(0)}%)`);

  console.log(`\nRecommendation:`);
  console.log(`- Move non-Fall perfumes from Row 1 to back rows`);
  console.log(`- Move Fall perfumes from back rows to Row 1`);
  console.log(`- Prioritize fragrances you wear most often for night time (if applicable)`);

  // Show non-fall perfumes in row 1 that should move back
  const row1NonFall = row1.filter(b => !b.seasons.includes(currentSeason));
  console.log(`\n=== PERFUMES TO MOVE FROM ROW 1 TO BACK (${row1NonFall.length} bottles) ===`);
  row1NonFall.forEach((b, i) => {
    console.log(`${i+1}. ${b.name} (${b.house}) - Seasons: ${b.seasons.join(', ') || 'None'}`);
  });
}

analyzeRack1().catch(console.error);
