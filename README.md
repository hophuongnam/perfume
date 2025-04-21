# Perfume Server

A Notion-powered perfume collection manager with optimized bottle arrangement features.

## Features

- Fetches perfume bottle data from Notion database
- Displays bottles in a 3D rack visualization
- Bottle Swap Manager for organizing your collection
- Seasonal optimization algorithm for perfume organization
- Minimizes the number of required swaps to arrange bottles optimally

## Optimization Features

The system automatically organizes perfume bottles based on:

1. **Seasonal Appropriateness:** Prioritizes bottles suitable for the current season
2. **Notes:** Considers notes that match well with the current season
3. **Accords:** Evaluates accords appropriate for the current season

The optimization algorithm calculates the minimum number of swaps needed to arrange bottles with the most suitable ones in the front rows (row 1) and less suitable ones in back rows (row 8).

## Usage

### Running the Server

```bash
npm install
npm start
```

The server will start on port 3000 (or the port specified in your .env file).

### Optimizing Bottle Arrangement

To generate an optimized bottle swap plan:

```bash
npm run optimize
```

This will analyze your collection and create a file called `optimalBottleSwaps.txt` with the minimum number of swaps needed to arrange bottles optimally.

To apply the optimized plan to the active swap list:

```bash
npm run optimize:apply
```

## Accessing the UI

- Main Visualization: http://localhost:3000/
- Bottle Swap Manager: http://localhost:3000/swaps
