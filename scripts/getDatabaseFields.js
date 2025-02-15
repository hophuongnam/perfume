require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('@notionhq/client');

// Initialize the Notion client with the token from .env
const notion = new Client({ auth: process.env.NOTION_TOKEN });

// Retrieve the database ID from .env
const databaseId = process.env.NOTION_DATABASE_ID;

(async function getDatabaseFields() {
  try {
    // Retrieve the database itself (not just querying rows)
    const response = await notion.databases.retrieve({
      database_id: databaseId
    });

    // Log to console
    console.log("All fields (properties) in the Notion database:");
    console.log(response.properties);

    // Build markdown documentation
    const properties = response.properties;
    let docContent = `# Notion Database Schema
Retrieved at: ${new Date().toISOString()}

Below is a listing of all properties in the Notion database (ID: ${databaseId}).

`;

    // For each property, append details to our docContent
    for (const [propName, prop] of Object.entries(properties)) {
      docContent += `## Field: ${propName}
**Type**: ${prop.type}

\`\`\`json
${JSON.stringify(prop, null, 2)}
\`\`\`

`;
    }

    // Write to README.md in the same folder
    fs.writeFileSync(path.join(__dirname, 'README.md'), docContent, 'utf8');
    console.log("Database schema has been documented in README.md");
  } catch (error) {
    console.error('Error retrieving database fields:', error.message);
  }
})();