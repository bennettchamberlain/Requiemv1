import fs from 'node:fs';
import path from 'node:path';

import { AmazonMusicFileImporter } from '../amazon_music';
import type { Graph, ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

const FOLLOWED_HEADER = 'ASIN,"Device Type","Entity Type","Last Updated Date","Product Name",Rating';
const followedRow = (asin: string, entityType: string, name: string): string =>
  `${asin},"Not Available",${entityType},2024-03-18T05:37:50.776Z,"${name}",POSITIVE`;

const PLAYLISTS_HEADER =
  '"Number of Followers","Playlist Title","Track Album Name","Track Artist Name","Track Name"';
const playlistRow = (playlist: string, album: string, artist: string, track: string): string =>
  `0,"${playlist}","${album}","${artist}","${track}"`;

// A representative subset of Saved Music.csv's 45 columns — the importer reads
// by name, so absent columns simply read as ''.
const SAVED_HEADER =
  'ASIN,"Album ASIN","Album Artist Name","Album Name","Album Primary Genre","Artist ASIN","Artist Name",' +
  '"Disc Number",Duration,"File Extension","Primary Genre",Purchased,Title,"Track Number"';
const savedRow = (o: {
  asin: string;
  albumAsin?: string;
  albumArtist?: string;
  album?: string;
  albumGenre?: string;
  artistAsin?: string;
  artist?: string;
  disc?: string;
  duration?: string;
  ext?: string;
  genre?: string;
  purchased?: string;
  title: string;
  trackNo?: string;
}): string =>
  [
    o.asin,
    o.albumAsin ?? 'Not Available',
    `"${o.albumArtist ?? o.artist ?? 'Not Available'}"`,
    `"${o.album ?? 'Not Available'}"`,
    `"${o.albumGenre ?? 'Not Available'}"`,
    o.artistAsin ?? 'Not Available',
    `"${o.artist ?? 'Not Available'}"`,
    o.disc ?? '1',
    o.duration ?? '200',
    o.ext ?? 'mp3',
    `"${o.genre ?? 'Not Available'}"`,
    o.purchased ?? 'No',
    `"${o.title}"`,
    o.trackNo ?? '1',
  ].join(',');

const runImport = async (target: string): Promise<Graph[]> => {
  const pipeline: Graph[] = [];
  await new AmazonMusicFileImporter().fileImport({}, { filename: path.basename(target), fullPath: target }, {
    pipeline: { push: (g: Graph) => pipeline.push(g as EmittedGraph) },
    timeframe: {},
    log: () => {},
  } as unknown as ImportParams);

  return pipeline;
};

const items = (graphs: Graph[]) =>
  graphs.filter((g) => g.item).map((g) => ({ item: g.item!, edges: g.edges ?? [] }));
const entities = (graphs: Graph[]) => graphs.filter((g) => g.entity && !g.item).map((g) => g.entity!);

/** Write a "Your Music Library" tree holding the given CSVs, run, clean up. */
const importLibrary = async (
  name: string,
  csvs: Partial<Record<'followed' | 'playlists' | 'saved', string>>,
  target?: 'followed' | 'playlists' | 'saved',
): Promise<Graph[]> => {
  const dir = path.join(FIXTURES_DIR, name);
  const lib = path.join(dir, 'Your Music Library');
  await fs.promises.mkdir(lib, { recursive: true });
  const names = {
    followed: 'Followed Artists and Accounts.csv',
    playlists: 'Playlists.csv',
    saved: 'Saved Music.csv',
  } as const;
  try {
    for (const [kind, csv] of Object.entries(csvs)) {
      await fs.promises.writeFile(path.join(lib, names[kind as keyof typeof names]), '﻿' + csv);
    }

    return await runImport(target ? path.join(lib, names[target]) : dir);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
};

describe('Amazon Music datasource', () => {
  it('recognizes each library CSV by name or header, rejects near-miss Amazon CSVs', async () => {
    const fi = new AmazonMusicFileImporter();
    const cases: Array<[string, string, number]> = [
      ['Followed Artists and Accounts.csv', FOLLOWED_HEADER, 0.95],
      ['Playlists.csv', PLAYLISTS_HEADER, 0.95],
      ['Saved Music.csv', SAVED_HEADER, 0.95],
      ['renamed-library.csv', SAVED_HEADER, 0.85],
      // Order history also carries ASIN + Product Name — but no Entity Type.
      ['Retail.OrderHistory.1.csv', '"Order ID","Order Date",ASIN,"Product Name"', 0],
      // Playlist-level sibling: has Playlist Title but no Track Name.
      ['Playlist Metadata.csv', '"Creation Date","Number of Followers","Playlist Title","Track Ids"', 0],
    ];
    const dir = path.join(FIXTURES_DIR, '__amzmusic_rec__');
    await fs.promises.mkdir(dir, { recursive: true });
    try {
      for (const [name, header, confidence] of cases) {
        const tmp = path.join(dir, name);
        await fs.promises.writeFile(tmp, '﻿' + header + '\n');
        const rec = await fi.recognize({}, { filename: name, fullPath: tmp });
        // Filename rides along in the asserted value — this loop covers every
        // candidate name inside one test.
        expect({ name, confidence: rec.confidence }).toEqual({ name, confidence });
      }
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('imports followed tracks/albums as undated content and artists as person entities', async () => {
    const graphs = await importLibrary('__amzmusic_followed__', {
      followed: [
        FOLLOWED_HEADER,
        followedRow('B0TRACK0001', 'TRACK', 'Suteki da Ne (Final Fantasy X)'),
        followedRow('B0TRACK0002', 'TRACK', 'Not Available'),
        followedRow('B0ALBUM0001', 'ALBUM', 'Wish You Were Here'),
        followedRow('B0ARTIST001', 'ARTIST', 'Crosby, Stills, Nash & Young'),
        followedRow('B0ARTIST002', 'ARTIST', 'Not Available'),
      ].join('\n'),
    });

    const people = entities(graphs);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ type: 'person', name: 'Crosby, Stills, Nash & Young' });
    expect(people[0].metadata?.ASIN).toBe('B0ARTIST001');

    const emitted = items(graphs);
    expect(emitted).toHaveLength(2); // the two Not Available rows are skipped
    const track = emitted.find((e) => e.item.id === 'amazonmusic:track:B0TRACK0001')!;
    expect(track.item.classification).toBe('saved_media');
    expect(track.item.timestamp).toBeUndefined();
    // No Saved Music row to inherit a File Extension from: Amazon's usual mp3.
    expect(track.item.content!.mediaType).toBe('audio/mpeg');
    expect(track.item.metadata).toMatchObject({
      Title: 'Suteki da Ne (Final Fantasy X)',
      ASIN: 'B0TRACK0001',
      Followed: true,
      URI: 'amazonmusic:track:B0TRACK0001',
      Source: 'Amazon Music',
    });
    const album = emitted.find((e) => e.item.id === 'amazonmusic:album:B0ALBUM0001')!;
    expect(album.item.metadata).toMatchObject({ Title: 'Wish You Were Here', Followed: true });
    expect(album.item.content!.mediaType).toBe('text/plain'); // no album file exists
  });

  it('imports playlist tracks with membership, artist edges, and no artist entity for Not Available', async () => {
    const graphs = await importLibrary('__amzmusic_playlists__', {
      playlists: [
        PLAYLISTS_HEADER,
        playlistRow('NY', 'Not Available', 'Not Available', 'Not Available'),
        playlistRow('My Discovery Mix', 'Wish You Were Here', 'Pink Floyd', 'Have a Cigar'),
        playlistRow('My Year in Review 2021', 'Wish You Were Here', 'Pink Floyd', 'Have a Cigar'),
        playlistRow('My Discovery Mix', 'Not Available', 'Not Available', 'Mystery Song'),
      ].join('\n'),
    });

    const emitted = items(graphs);
    expect(emitted).toHaveLength(2);
    const cigar = emitted.find((e) => e.item.metadata!.Title === 'Have a Cigar')!;
    expect(cigar.item.metadata).toMatchObject({
      Artist: 'Pink Floyd',
      Album: 'Wish You Were Here',
      Playlists: ['My Discovery Mix', 'My Year in Review 2021'],
    });
    expect(cigar.edges).toHaveLength(1);
    expect(cigar.edges[0].relation).toBe('by');
    expect(cigar.edges[0].to.entity).toMatchObject({ type: 'person', name: 'Pink Floyd' });
    // A playlist-only track has no Saved Music extension to inherit.
    expect(cigar.item.content!.mediaType).toBe('audio/mpeg');

    const mystery = emitted.find((e) => e.item.metadata!.Title === 'Mystery Song')!;
    expect(mystery.item.metadata!.Artist).toBeUndefined();
    expect(mystery.edges).toHaveLength(0);
  });

  it('imports saved music with genre concept entities and full track metadata', async () => {
    const graphs = await importLibrary('__amzmusic_saved__', {
      saved: [
        SAVED_HEADER,
        savedRow({
          asin: 'B0SAVED0001',
          albumAsin: 'B0SALBUM001',
          album: 'Wish You Were Here',
          albumGenre: 'Psychedelic Rock',
          artistAsin: 'B0SARTIST01',
          artist: 'Pink Floyd',
          duration: '334',
          ext: 'm4a',
          purchased: 'Yes',
          title: 'Have a Cigar',
          trackNo: '3',
        }),
        // No album genre: the track's own Primary Genre fills metadata.Genre,
        // but no genre entity is created (the entity source is the album's).
        savedRow({ asin: 'B0SAVED0002', artist: 'Neil Young', genre: 'Folk', title: 'I Am a Child' }),
      ].join('\n'),
    });

    const emitted = items(graphs);
    expect(emitted).toHaveLength(2);
    const cigar = emitted.find((e) => e.item.id === 'amazonmusic:track:B0SAVED0001')!;
    expect(cigar.item.metadata).toMatchObject({
      Title: 'Have a Cigar',
      Artist: 'Pink Floyd',
      Album: 'Wish You Were Here',
      Genre: 'Psychedelic Rock',
      Duration: 334,
      'Track Number': 3,
      ASIN: 'B0SAVED0001',
      'Album ASIN': 'B0SALBUM001',
      'Artist ASIN': 'B0SARTIST01',
      Purchased: true,
    });
    const genreEdge = cigar.edges!.find((e) => e.relation === 'genre')!;
    expect(genreEdge.to.entity).toMatchObject({ type: 'music_genre', name: 'Psychedelic Rock' });
    // The File Extension column drives the mimetype: m4a → audio/mp4.
    expect(cigar.item.content!.mediaType).toBe('audio/mp4');

    const child = emitted.find((e) => e.item.id === 'amazonmusic:track:B0SAVED0002')!;
    expect(child.item.metadata!.Genre).toBe('Folk');
    expect(child.edges!.map((e) => e.relation)).toEqual(['by']);
    expect(child.item.content!.mediaType).toBe('audio/mpeg'); // mp3
  });

  it('cross-references followed tracks/albums and playlist rows against Saved Music', async () => {
    const graphs = await importLibrary('__amzmusic_xref__', {
      saved: [
        SAVED_HEADER,
        savedRow({
          asin: 'B0XTRACK001',
          albumAsin: 'B0XALBUM001',
          album: 'Harvest',
          albumGenre: 'Folk',
          artistAsin: 'B0XARTIST01',
          artist: 'Neil Young',
          ext: 'm4a',
          title: 'Heart of Gold',
        }),
      ].join('\n'),
      followed: [
        FOLLOWED_HEADER,
        followedRow('B0XTRACK001', 'TRACK', 'Heart of Gold'),
        followedRow('B0XALBUM001', 'ALBUM', 'Harvest'),
      ].join('\n'),
      playlists: [
        PLAYLISTS_HEADER,
        playlistRow('My Discovery Mix', 'Harvest', 'Neil Young', 'Heart of Gold'),
      ].join('\n'),
    });

    const emitted = items(graphs);
    // One merged track (not three) plus the followed album.
    expect(emitted).toHaveLength(2);
    const track = emitted.find((e) => e.item.id === 'amazonmusic:track:B0XTRACK001')!;
    expect(track.item.metadata).toMatchObject({
      Title: 'Heart of Gold',
      Artist: 'Neil Young',
      Album: 'Harvest',
      Genre: 'Folk',
      Followed: true,
      Playlists: ['My Discovery Mix'],
    });
    // The saved row's File Extension reaches the merged record.
    expect(track.item.content!.mediaType).toBe('audio/mp4');
    // The followed album inherits artist and genre from the saved rows' album columns.
    const album = emitted.find((e) => e.item.id === 'amazonmusic:album:B0XALBUM001')!;
    expect(album.item.metadata).toMatchObject({
      Title: 'Harvest',
      Artist: 'Neil Young',
      Genre: 'Folk',
      Followed: true,
    });
    expect(album.edges!.map((e) => e.relation).sort()).toEqual(['by', 'genre']);
  });

  it('enriches a bare followed-file drop from its Saved Music sibling without importing it', async () => {
    const graphs = await importLibrary(
      '__amzmusic_bare__',
      {
        saved: [
          SAVED_HEADER,
          savedRow({
            asin: 'B0BTRACK001',
            album: 'Harvest',
            albumGenre: 'Folk',
            artist: 'Neil Young',
            title: 'Heart of Gold',
          }),
          savedRow({ asin: 'B0BTRACK002', artist: 'Neil Young', title: 'Old Man' }),
        ].join('\n'),
        followed: [FOLLOWED_HEADER, followedRow('B0BTRACK001', 'TRACK', 'Heart of Gold')].join('\n'),
      },
      'followed',
    );

    const emitted = items(graphs);
    // Only the followed track — the sibling's saved-only row stays out.
    expect(emitted).toHaveLength(1);
    expect(emitted[0].item.id).toBe('amazonmusic:track:B0BTRACK001');
    expect(emitted[0].item.metadata).toMatchObject({ Artist: 'Neil Young', Genre: 'Folk', Followed: true });
    expect(emitted[0].item.content!.mediaType).toBe('audio/mpeg'); // sibling's mp3 extension
  });

  it('recognizes the library directory and yields stable ids across re-imports', async () => {
    const dir = path.join(FIXTURES_DIR, '__amzmusic_dir__');
    const lib = path.join(dir, 'Your Music Library');
    await fs.promises.mkdir(lib, { recursive: true });
    await fs.promises.writeFile(
      path.join(lib, 'Playlists.csv'),
      '﻿' + [PLAYLISTS_HEADER, playlistRow('NY', 'Harvest', 'Neil Young', 'Heart of Gold')].join('\n'),
    );
    try {
      const rec = await new AmazonMusicFileImporter().recognize(
        {},
        { filename: path.basename(dir), fullPath: dir },
      );
      expect(rec.confidence).toBeGreaterThan(0.9);
      const a = await runImport(dir);
      const b = await runImport(dir);
      expect(items(a).map((e) => e.item.id)).toEqual(items(b).map((e) => e.item.id));
      expect(items(a)[0].item.id).toMatch(/^amazonmusic:track:t:[0-9a-f]{16}$/);
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });
});
