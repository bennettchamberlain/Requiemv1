# Test Fixtures

This directory contains test data fixtures for all data source importers.

## Purpose

The fixtures provide standardized test data for:
- **Recognition testing**: Verify that each importer correctly recognizes its expected data format
- **Import testing**: Validate that each importer can successfully parse and import data
- **Regression testing**: Ensure consistent behavior across code changes

## Structure

Each fixture represents a minimal valid export from a specific data source:

### Text-based Formats

- **`sample.ics`**: Calendar events in iCalendar format
- **`sample.vcf`**: vCard contacts with multiple contact entries
- **`sample.geojson`**: GeoJSON location data with points and line strings

### SQLite Databases

- **`AddressBook-v22.abcddb`**: Apple Contacts database with sample contact
- **`places.sqlite`**: Firefox browsing history database

### Directory-based Exports

- **`google-location-legacy/`**: Google Location History legacy format
  - Contains `Records.json` with location data in E7 coordinate format
  
- **`google-voice-export/`**: Google Voice HTML conversation export
  - `Phones.vcf`: Owner phone information
  - `Bills.html`: Billing history placeholder
  - `Calls/conversation-1.html`: Sample conversation HTML

- **`twitter-archive/`**: Twitter data archive format
  - `data/manifest.js`: Archive metadata
  - `data/tweets.js`: Sample tweets data

## Creating Database Fixtures

The SQLite database fixtures were created using the `create_test_dbs.ts` script. To regenerate them:

```bash
npx tsx src/datasources/__tests__/fixtures/create_test_dbs.ts
```

## Using Fixtures in Tests

Tests should use the fixtures directory constant:

```typescript
const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');
const samplePath = path.join(FIXTURES_DIR, 'sample.ics');
```

## Best Practices

1. **Minimal Data**: Fixtures should contain the minimum data needed to test the importer
2. **Representative**: Data should represent typical structure from real exports
3. **Stable**: Fixtures should not change unnecessarily to avoid breaking tests
4. **Documented**: Complex formats should have comments explaining the structure

## Coverage

All 21 data sources now have corresponding test fixtures:

✅ Apple Contacts  
✅ Apple Photos (via tmpdir creation)  
✅ Calendar  
✅ Contact List (via tmpdir creation)  
✅ Email (via tmpdir creation)  
✅ Firefox  
✅ Flighty (via tmpdir creation)  
✅ Generic (implicit coverage)  
✅ GeoJSON  
✅ GitHub (via tmpdir creation)  
✅ Gmail (via tmpdir creation)  
✅ Google Location History  
✅ Google Photos (via tmpdir creation)  
✅ Google Voice  
✅ GPX/KML (via tmpdir creation)  
✅ iMessage (via tmpdir creation)  
✅ NMEA (via tmpdir creation)  
✅ Twitter  
✅ vCard  

Some data sources use temporary directory creation in tests rather than persistent fixtures because they require minimal setup or dynamic test data.
