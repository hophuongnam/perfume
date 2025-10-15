require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

async function checkDuplicates() {
  console.log('Checking for duplicate bottle positions...\n');

  const pages = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const resp = await notion.databases.query({
      database_id: databaseId,
      start_cursor: startCursor
    });
    pages.push(...resp.results);
    hasMore = resp.has_more;
    startCursor = resp.next_cursor;
  }

  const bottles = pages
    .filter(p => !p.properties['Ignore?']?.checkbox)
    .map(p => ({
      name: p.properties.Name?.title?.[0]?.plain_text || '(No name)',
      location: p.properties.Location?.rich_text?.[0]?.plain_text || '0-0-0'
    }))
    .filter(b => b.location.startsWith('1-')); // Only Plane 1

  console.log(`Total bottles in Plane 1: ${bottles.length}\n`);

  const locationCounts = {};
  bottles.forEach(b => {
    locationCounts[b.location] = locationCounts[b.location] || [];
    locationCounts[b.location].push(b.name);
  });

  const duplicates = Object.entries(locationCounts).filter(([loc, names]) => names.length > 1);

  if (duplicates.length > 0) {
    console.log(`❌ Found ${duplicates.length} locations with duplicate bottles:\n`);
    duplicates.forEach(([loc, names]) => {
      console.log(`Location ${loc}: ${names.length} bottles`);
      names.forEach(name => console.log(`  - ${name}`));
      console.log('');
    });
  } else {
    console.log('✅ No duplicate locations found. All bottles have unique positions.');
  }

  // Check for missing slots
  const expectedSlots = 240; // 8 rows x 30 columns
  const actualSlots = Object.keys(locationCounts).length;

  if (actualSlots !== expectedSlots) {
    console.log(`\n⚠️  Warning: Expected ${expectedSlots} unique positions, but found ${actualSlots}`);
  }
}

checkDuplicates().catch(console.error);
