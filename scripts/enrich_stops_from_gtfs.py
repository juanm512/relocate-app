#!/usr/bin/env python3
"""Enrich stops.txt with next/prev stop and route/shape ids from GTFS files.

Usage:
  python scripts/enrich_stops_from_gtfs.py --data-dir data/colectivos-gtfs --output data/colectivos-gtfs/stops_enriched.txt

By default this script assumes `stop_times.txt` is grouped by `trip_id` and ordered by `stop_sequence`.
If that's not true, pass `--use-sqlite` to build a temporary sqlite table and iterate grouped rows (slower, but robust for large unsorted files).
"""
import argparse
import csv
import logging
import os
import sqlite3
import tempfile
from collections import Counter, defaultdict


def read_trips(trips_path):
    trips = {}
    with open(trips_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for r in reader:
            trip_id = r.get('trip_id')
            if not trip_id:
                continue
            route_id = r.get('route_id', '')
            shape_id = r.get('shape_id', '')
            trips[trip_id] = (route_id, shape_id)
    logging.info('Loaded %d trips', len(trips))
    return trips


def load_stops(stops_path):
    stops = []
    with open(stops_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for r in reader:
            stops.append(r)
    logging.info('Loaded %d stops', len(stops))
    return stops, fieldnames


def process_stop_times_stream(stop_times_path, trips_map, next_counts, prev_counts, routes_for_stop, shapes_for_stop):
    with open(stop_times_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        last_trip = None
        last_stop = None
        for r in reader:
            trip_id = r.get('trip_id')
            stop_id = r.get('stop_id')
            if not trip_id or not stop_id:
                continue
            if trip_id != last_trip:
                last_trip = trip_id
                last_stop = None
            # consecutive pair last_stop -> stop_id
            if last_stop is not None:
                next_counts[last_stop][stop_id] += 1
                prev_counts[stop_id][last_stop] += 1
            last_stop = stop_id
            # attach route/shape from trips_map if available
            t = trips_map.get(trip_id)
            if t:
                route_id, shape_id = t
                if route_id:
                    routes_for_stop[stop_id].add(route_id)
                if shape_id:
                    shapes_for_stop[stop_id].add(shape_id)


def process_stop_times_sqlite(stop_times_path, trips_map, next_counts, prev_counts, routes_for_stop, shapes_for_stop):
    # Insert minimal columns into sqlite, then iterate grouped
    tmp = tempfile.NamedTemporaryFile(delete=False)
    db_path = tmp.name
    tmp.close()
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute('CREATE TABLE st (trip_id TEXT, stop_sequence INTEGER, stop_id TEXT)')
    cur.execute('CREATE INDEX ix_trip ON st(trip_id)')
    conn.commit()
    with open(stop_times_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        to_insert = []
        for r in reader:
            trip_id = r.get('trip_id')
            stop_id = r.get('stop_id')
            seq = r.get('stop_sequence')
            if not trip_id or not stop_id:
                continue
            try:
                seq_i = int(seq)
            except Exception:
                seq_i = 0
            to_insert.append((trip_id, seq_i, stop_id))
            if len(to_insert) >= 10000:
                cur.executemany('INSERT INTO st VALUES (?,?,?)', to_insert)
                conn.commit()
                to_insert = []
        if to_insert:
            cur.executemany('INSERT INTO st VALUES (?,?,?)', to_insert)
            conn.commit()
    # iterate grouped trips
    cur.execute('SELECT DISTINCT trip_id FROM st')
    trips = [r[0] for r in cur.fetchall()]
    for trip_id in trips:
        cur.execute('SELECT stop_id FROM st WHERE trip_id = ? ORDER BY stop_sequence', (trip_id,))
        rows = [r[0] for r in cur.fetchall()]
        last = None
        for stop_id in rows:
            if last is not None:
                next_counts[last][stop_id] += 1
                prev_counts[stop_id][last] += 1
            last = stop_id
            t = trips_map.get(trip_id)
            if t:
                route_id, shape_id = t
                if route_id:
                    routes_for_stop[stop_id].add(route_id)
                if shape_id:
                    shapes_for_stop[stop_id].add(shape_id)
    conn.close()
    try:
        os.unlink(db_path)
    except Exception:
        pass


def choose_most_common(counter):
    if not counter:
        return ''
    most, _ = counter.most_common(1)[0]
    return most


def write_enriched(stops, fieldnames, out_path, next_counts, prev_counts, routes_for_stop, shapes_for_stop):
    extra = ['next_stop_id', 'prev_stop_id', 'route_ids', 'shape_ids']
    out_fields = list(fieldnames) + extra
    with open(out_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=out_fields)
        writer.writeheader()
        for r in stops:
            sid = r.get('stop_id')
            row = dict(r)
            row['next_stop_id'] = choose_most_common(next_counts.get(sid, Counter()))
            row['prev_stop_id'] = choose_most_common(prev_counts.get(sid, Counter()))
            row['route_ids'] = ';'.join(sorted(routes_for_stop.get(sid, [])))
            row['shape_ids'] = ';'.join(sorted(shapes_for_stop.get(sid, [])))
            writer.writerow(row)
    logging.info('Wrote enriched stops to %s', out_path)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--data-dir', required=True)
    p.add_argument('--stops', default='stops.txt')
    p.add_argument('--trips', default='trips.txt')
    p.add_argument('--stop-times', default='stop_times.txt')
    p.add_argument('--output', default=None)
    p.add_argument('--use-sqlite', action='store_true', help='Fallback: load stop_times into sqlite to group by trip_id (robust for unsorted file).')
    p.add_argument('--inplace', action='store_true', help='Overwrite original stops file with enriched version')
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

    stops_path = os.path.join(args.data_dir, args.stops)
    trips_path = os.path.join(args.data_dir, args.trips)
    stop_times_path = os.path.join(args.data_dir, args.stop_times)
    if args.output:
        out_path = args.output
    else:
        out_path = os.path.join(args.data_dir, 'stops_enriched.txt')
    if args.inplace:
        out_path = stops_path

    trips_map = read_trips(trips_path)
    stops, fieldnames = load_stops(stops_path)

    next_counts = defaultdict(Counter)
    prev_counts = defaultdict(Counter)
    routes_for_stop = defaultdict(set)
    shapes_for_stop = defaultdict(set)

    if args.use_sqlite:
        logging.info('Using sqlite fallback to process stop_times (slower)')
        process_stop_times_sqlite(stop_times_path, trips_map, next_counts, prev_counts, routes_for_stop, shapes_for_stop)
    else:
        logging.info('Processing stop_times in streaming mode (assumes grouped by trip_id)')
        process_stop_times_stream(stop_times_path, trips_map, next_counts, prev_counts, routes_for_stop, shapes_for_stop)

    write_enriched(stops, fieldnames, out_path, next_counts, prev_counts, routes_for_stop, shapes_for_stop)


if __name__ == '__main__':
    main()
