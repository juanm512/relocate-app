#!/usr/bin/env python3
"""Build adjacency file by route and shape from GTFS stop_times and trips.

Output format (CSV): route_id,shape_id,stop_id,prev_stop_id,next_stop_id
One row per (route_id,shape_id,stop_id) using the most common prev/next observed across trips.
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
            trips[trip_id] = (r.get('route_id',''), r.get('shape_id',''))
    logging.info('Loaded %d trips', len(trips))
    return trips


def build_sqlite(stop_times_path):
    tmp = tempfile.NamedTemporaryFile(delete=False)
    db_path = tmp.name
    tmp.close()
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    # store arrival/departure times and shape_dist_traveled to compute travel times/distances
    cur.execute('CREATE TABLE st (trip_id TEXT, stop_sequence INTEGER, stop_id TEXT, arrival_time TEXT, departure_time TEXT, shape_dist REAL)')
    cur.execute('CREATE INDEX ix_trip ON st(trip_id)')
    conn.commit()
    with open(stop_times_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        to_insert = []
        for r in reader:
            trip_id = r.get('trip_id')
            stop_id = r.get('stop_id')
            seq = r.get('stop_sequence')
            arrival = r.get('arrival_time')
            departure = r.get('departure_time')
            shape_dist = r.get('shape_dist_traveled')
            if not trip_id or not stop_id:
                continue
            try:
                seq_i = int(seq)
            except Exception:
                seq_i = 0
            try:
                sd = float(shape_dist) if shape_dist not in (None, '') else None
            except Exception:
                sd = None
            to_insert.append((trip_id, seq_i, stop_id, arrival, departure, sd))
            if len(to_insert) >= 10000:
                cur.executemany('INSERT INTO st VALUES (?,?,?,?,?,?)', to_insert)
                conn.commit()
                to_insert = []
        if to_insert:
            cur.executemany('INSERT INTO st VALUES (?,?,?,?,?,?)', to_insert)
            conn.commit()
    return conn, db_path


def choose_most_common(counter):
    if not counter:
        return ''
    most, _ = counter.most_common(1)[0]
    return most


def parse_time_to_seconds(t):
    # GTFS times can be >24:00:00; handle H:M:S
    if not t:
        return None
    try:
        parts = t.split(':')
        if len(parts) != 3:
            return None
        h, m, s = map(int, parts)
        return h * 3600 + m * 60 + s
    except Exception:
        return None


def median(lst):
    if not lst:
        return None
    s = sorted(lst)
    n = len(s)
    mid = n // 2
    if n % 2 == 1:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2.0


def build_adjacency(conn, trips_map, fallback_speed=4.0):
    cur = conn.cursor()
    cur.execute('SELECT DISTINCT trip_id FROM st')
    trip_ids = [r[0] for r in cur.fetchall()]
    logging.info('Found %d trips in sqlite table', len(trip_ids))

    next_counts = defaultdict(Counter)
    # store observed travel times and distances per (route,shape,stop,next_stop)
    travel_times = defaultdict(list)
    travel_dists = defaultdict(list)

    for tid in trip_ids:
        cur.execute('SELECT stop_id, arrival_time, departure_time, shape_dist FROM st WHERE trip_id = ? ORDER BY stop_sequence', (tid,))
        rows = cur.fetchall()
        if not rows:
            continue
        route_id, shape_id = trips_map.get(tid, ('',''))
        for i in range(len(rows)):
            stop_id, arrival, departure, shape_dist = rows[i]
            next_row = rows[i+1] if i+1 < len(rows) else None
            if not next_row:
                continue
            next_stop_id, next_arrival, next_departure, next_shape_dist = next_row
            key = (route_id, shape_id, stop_id)
            # count next occurrence
            next_counts[key][next_stop_id] += 1

            # compute travel time using departure at current and arrival at next
            dep_sec = parse_time_to_seconds(departure) or parse_time_to_seconds(arrival)
            arr_sec = parse_time_to_seconds(next_arrival) or parse_time_to_seconds(next_departure)
            dt = None
            if dep_sec is not None and arr_sec is not None:
                dt = arr_sec - dep_sec
                if dt < 0:
                    dt += 24 * 3600
            # compute distance delta if available
            dist = None
            try:
                if shape_dist is not None and next_shape_dist is not None:
                    dist = float(next_shape_dist) - float(shape_dist)
                    if dist < 0:
                        dist = None
            except Exception:
                dist = None

            if dt is not None:
                travel_times[(key, next_stop_id)].append(dt)
            if dist is not None:
                travel_dists[(key, next_stop_id)].append(dist)

    # Build final mapping: choose most common next stop per key and compute median travel time/distance
    adjacency = {}
    for key, counter in next_counts.items():
        most_next = choose_most_common(counter)
        tlist = travel_times.get((key, most_next), [])
        dlist = travel_dists.get((key, most_next), [])
        travel_time = median(tlist)
        travel_dist = median(dlist)
        # if no direct times but have distance, estimate using fallback_speed (m/s)
        if travel_time is None and travel_dist is not None:
            try:
                travel_time = travel_dist / fallback_speed
            except Exception:
                travel_time = None
        # normalize/format
        if travel_time is not None:
            travel_time = int(round(travel_time))
        if travel_dist is not None:
            travel_dist = float(travel_dist)

        adjacency[key] = (most_next, travel_time, travel_dist)

    return adjacency


def write_adjacency(adjacency, out_path):
    with open(out_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['route_id','shape_id','stop_id','next_stop_id','travel_time_to_next','travel_distance_to_next'])
        for (route_id, shape_id, stop_id), (next_id, travel_time, travel_dist) in adjacency.items():
            writer.writerow([route_id, shape_id, stop_id, next_id or '', travel_time if travel_time is not None else '', travel_dist if travel_dist is not None else ''])
    logging.info('Wrote adjacency file to %s', out_path)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--data-dir', required=True)
    p.add_argument('--trips', default='trips.txt')
    p.add_argument('--stop-times', default='stop_times.txt')
    p.add_argument('--output', default=None)
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

    trips_path = os.path.join(args.data_dir, args.trips)
    stop_times_path = os.path.join(args.data_dir, args.stop_times)
    if args.output:
        out_path = args.output
    else:
        out_path = os.path.join(args.data_dir, 'adjacency_by_route.txt')

    trips_map = read_trips(trips_path)
    conn, db_path = build_sqlite(stop_times_path)
    try:
        adjacency = build_adjacency(conn, trips_map)
        write_adjacency(adjacency, out_path)
    finally:
        conn.close()
        try:
            os.unlink(db_path)
        except Exception:
            pass


if __name__ == '__main__':
    main()
