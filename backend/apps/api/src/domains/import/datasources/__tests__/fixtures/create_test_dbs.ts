import path from 'path';

import Database from 'better-sqlite3';

const fixturesDir = __dirname;

// Create Apple Contacts DB
const contactsDbPath = path.join(fixturesDir, 'AddressBook-v22.abcddb');
const contactsDb = new Database(contactsDbPath);

contactsDb.exec(`
  CREATE TABLE IF NOT EXISTS ZABCDRECORD (
    Z_PK INTEGER PRIMARY KEY,
    ZFIRSTNAME TEXT,
    ZMIDDLENAME TEXT,
    ZMAIDENNAME TEXT,
    ZLASTNAME TEXT,
    ZBIRTHDAY INTEGER,
    ZBIRTHDAYYEAR INTEGER,
    ZBIRTHDAYYEARLESS INTEGER
  );
  
  CREATE TABLE IF NOT EXISTS ZABCDPHONENUMBER (
    Z_PK INTEGER PRIMARY KEY,
    ZOWNER INTEGER,
    ZFULLNUMBER TEXT
  );
  
  CREATE TABLE IF NOT EXISTS ZABCDEMAILADDRESS (
    Z_PK INTEGER PRIMARY KEY,
    ZOWNER INTEGER,
    ZADDRESS TEXT
  );
  
  CREATE TABLE IF NOT EXISTS ZABCDURLADDRESS (
    Z_PK INTEGER PRIMARY KEY,
    ZOWNER INTEGER,
    ZURL TEXT
  );
`);

// Insert test contact
contactsDb
  .prepare('INSERT INTO ZABCDRECORD (Z_PK, ZFIRSTNAME, ZLASTNAME, ZBIRTHDAY) VALUES (?, ?, ?, ?)')
  .run(1, 'Alice', 'Anderson', 607737600);
contactsDb
  .prepare('INSERT INTO ZABCDPHONENUMBER (Z_PK, ZOWNER, ZFULLNUMBER) VALUES (?, ?, ?)')
  .run(1, 1, '+1-555-111-2222');
contactsDb
  .prepare('INSERT INTO ZABCDEMAILADDRESS (Z_PK, ZOWNER, ZADDRESS) VALUES (?, ?, ?)')
  .run(1, 1, 'alice@example.com');
contactsDb
  .prepare('INSERT INTO ZABCDURLADDRESS (Z_PK, ZOWNER, ZURL) VALUES (?, ?, ?)')
  .run(1, 1, 'https://alice.example.com');

contactsDb.close();
console.log('Created:', contactsDbPath);

// Create Firefox places.sqlite DB
const firefoxDbPath = path.join(fixturesDir, 'places.sqlite');
const firefoxDb = new Database(firefoxDbPath);

firefoxDb.exec(`
  CREATE TABLE IF NOT EXISTS moz_places (
    id INTEGER PRIMARY KEY,
    url TEXT,
    title TEXT,
    description TEXT
  );
  
  CREATE TABLE IF NOT EXISTS moz_historyvisits (
    id INTEGER PRIMARY KEY,
    place_id INTEGER,
    visit_date INTEGER
  );
`);

// Insert test browsing history (visit_date in microseconds)
const visitDate = new Date('2025-01-15T10:30:00Z').getTime() * 1000; // Convert to microseconds
firefoxDb
  .prepare('INSERT INTO moz_places (id, url, title, description) VALUES (?, ?, ?, ?)')
  .run(1, 'https://example.com', 'Example Domain', 'Test website');
firefoxDb
  .prepare('INSERT INTO moz_historyvisits (id, place_id, visit_date) VALUES (?, ?, ?)')
  .run(1, 1, visitDate);

firefoxDb.close();
console.log('Created:', firefoxDbPath);

console.log('All test databases created successfully!');
