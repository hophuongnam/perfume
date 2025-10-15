# Perfume Server

A Notion-powered perfume collection manager with optimized bottle arrangement features.

## Physical Structure

### Configuration (from .env)

The collection structure is defined in `.env` file:

```
RACK_R1=(4,30)    # 4 rows × 30 columns
RACK_R2=(4,30)    # 4 rows × 30 columns
RACK_R3=(3,14)    # 3 rows × 14 columns
RACK_R4=(4,15)    # 4 rows × 15 columns

PLANE_P1=R1xR2    # Plane 1 contains Rack R1 stacked on Rack R2
PLANE_P2=R3xR4    # Plane 2 contains Rack R3 stacked on Rack R4
```

### Rack Layout

**Plane 1** (defined as `R1xR2`):
- Rack R1: 4 rows × 30 columns (120 positions)
- Rack R2: 4 rows × 30 columns (120 positions)
- **Total**: 8 rows × 30 columns = **240 positions**
- Rows are numbered **1-8** (R1 provides rows 1-4, R2 provides rows 5-8)

**Plane 2** (defined as `R3xR4`):
- Rack R3: 3 rows × 14 columns (42 positions)
- Rack R4: 4 rows × 15 columns (60 positions)
- **Total**: 7 rows × variable columns = **102 positions**

**Total collection capacity**: 342 bottle positions (240 in Plane 1 + 102 in Plane 2)

### Location Format

Each bottle's location is stored in Notion with the format: `plane-column-row`

**Example**: `1-15-3` means:
- **Plane**: 1 (Plane 1 = R1xR2)
- **Column**: 15 (horizontal position, 1-30 for Plane 1)
- **Row**: 3 (vertical position, 1-8 for Plane 1, front to back)

**IMPORTANT**: The format is `plane-column-row`, NOT `plane-row-column`!

### Row Accessibility

Within each plane, rows have different accessibility levels (front to back):

- **Row 1**: MOST accessible (front row)
- **Rows 2-3**: Very accessible
- **Rows 4-5**: Accessible
- **Rows 6-8**: Less accessible (back rows)

**Optimization Strategy**: Place frequently-used and seasonally-appropriate bottles in front rows (1-5), and less-used or off-season bottles in back rows (6-8).

### Physical Transition Move List Format

When physically rearranging bottles from current arrangement to target arrangement, the move list format is:

```
(target-slot) (new-bottle-name) (current-location)
```

**Example:**
```
(1-1-1) Dior Sauvage (1-15-3)
(1-1-2) Tom Ford Oud Wood (1-8-7)
(1-1-3) Creed Aventus (1-2-5)
```

**How to use this list:**

For each line:
1. Look at the **target slot** (e.g., `1-1-1`)
2. Remove the bottle currently at that slot → place in **temp area**
3. Find the **new bottle** that should go there (e.g., `Dior Sauvage`)
4. Look up its **current location** (e.g., `1-15-3`)
5. Remove it from current location → place in **temp area**
6. Place the new bottle into the target slot

**Location format reminder:** `plane-column-row`
- `1-15-3` = Plane 1, Column 15, Row 3

This format allows you to systematically work through the arrangement one slot at a time, using a temporary staging area for bottles being moved.

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

## Arrangement History

### October 15, 2025 - Fall Season Optimization

**Objective**: Optimize Plane 1 arrangement for Fall season with priority on seasonal appropriateness, note grouping, and house proximity.

**Process**:
1. **Analysis**: Fetched 240 active bottles from Notion database in Plane 1
2. **Optimization Criteria**:
   - Primary: Season (Fall bottles prioritized)
   - Secondary: Notes/Accords (woody, spicy, citrus, floral, etc.)
   - Tertiary: House proximity (same brands clustered together)
3. **Generated Files**:
   - `optimalArrangement.txt` - Physical move list (240 bottles)
   - `arrangementTracker.html` - Interactive progress tracker with checkboxes
   - `updateNotionLocations.js` - Notion database update script
4. **Physical Rearrangement**: Manually moved all 240 bottles according to generated plan
5. **Database Sync**: Updated all 240 bottle locations in Notion (100% success rate)

**Results**:
- **Row 1**: 30 bottles, 100% Fall coverage ⭐ MOST ACCESSIBLE
- **Row 2**: 30 bottles, 100% Fall coverage ⭐ MOST ACCESSIBLE
- **Row 3**: 30 bottles, 100% Fall coverage ⭐ MOST ACCESSIBLE
- **Row 4**: 30 bottles, 100% Fall coverage (ACCESSIBLE)
- **Row 5**: 30 bottles, 100% Fall coverage (ACCESSIBLE)
- **Row 6**: 30 bottles, 36.7% Fall coverage (LESS ACCESSIBLE - mixed)
- **Row 7**: 30 bottles, 0% Fall (LESS ACCESSIBLE - Spring/Summer)
- **Row 8**: 30 bottles, 0% Fall (LESS ACCESSIBLE - Spring/Summer)

**Top Houses**:
- Amouage: 29 bottles
- Tom Ford: 16 bottles
- Xerjoff: 15 bottles
- Creed: 10 bottles
- Mancera: 9 bottles

**Note Categories**:
- Woody: 193 bottles (dominant Fall profile)
- Spicy: 30 bottles
- Floral: 10 bottles
- Other: 7 bottles

**Script Used**: `scripts/generateOptimalArrangement.js`

**Status**: ✅ Complete - All bottles physically arranged and Notion database synchronized
