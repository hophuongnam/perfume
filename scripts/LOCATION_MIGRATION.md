# Migration to Single Location Field

This document explains the migration from separate `Plane`, `Column`, and `Row` fields to a single `Location` field in Notion and the corresponding code changes.

## Changes Made

1. Changed the format from three separate number fields to a single text field in the format `x-y-z` where:
   - `x` = plane number
   - `y` = row number
   - `z` = column number

2. Updated the following files to handle the new format:
   - `server.js`: Modified the `/api/bottles` endpoint to parse Location and `/api/updateBottleSlot` to update it
   - `scripts/assignSlots.js`: Updated to use the Location field instead of separate fields
   - `scripts/getBottles.js`: Updated to parse the Location field

3. Created migration scripts:
   - `testLocationField.js`: Tests the migration without making changes
   - `migrateToLocationField.js`: Performs the actual migration of data

## How to Migrate

1. First add a field named "Location" in your Notion database with the Text type.

2. Run the test script to check if everything is set up correctly:
   ```
   node scripts/testLocationField.js
   ```

3. Perform the migration:
   ```
   node scripts/migrateToLocationField.js
   ```

4. After migration is complete, you can remove the old `Plane`, `Row`, and `Column` fields from your Notion database if desired, as the code now exclusively uses the `Location` field.

## How the Code Works

1. When fetching bottle data:
   - The server reads the Location string from Notion (e.g., "1-2-3")
   - It splits this string into the three components
   - It provides these components to the rest of the code as it did before

2. When updating bottle positions:
   - The code still accepts plane, row, and column values separately
   - The server combines these values into a Location string (e.g., "1-2-3")
   - The Location field in Notion is updated with this string

This approach minimizes changes to the core application logic while simplifying the data structure in Notion.
