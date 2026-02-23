#!/usr/bin/env python3
"""Compute simple bus-based reachable areas from a work point.

Algorithm (simplified, schedule-less):
- For each (route_id,shape_id) find nearest stop to work.
- walking_time = min(distance_to_stop / WALK_SPEED, TOTAL_TIME * 0.7)
- remaining_time = TOTAL_TIME - walking_time - BOARD_TIME
- Traverse route forward using `adjacency_by_route.txt` in-vehicle times; for each reached stop,
  compute walk_radius = remaining_time_at_stop * WALK_SPEED (if >0) and record it.

Output: CSV `bus_areas_<time>min_<lat>_<lon>.txt` with columns:
  stop_id,route_id,shape_id,stop_lat,stop_lon,next_stop_id,travel_time_to_next,area_radius_m

Only configurable parameter: `--time-minutes` (TOTAL_TIME). All speeds/times constants are hardcoded.
"""
import argparse
import csv
import math
import os
from collections import defaultdict


WALK_SPEED = 1.4  # m/s
BOARD_TIME = 20  # seconds to board
BUS_SPEED_FALLBACK = 8.0  # m/s (used if travel_time missing and distance available)


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2.0)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2.0)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def load_stops(stops_path):
    stops = {}
    with open(stops_path, newline='', encoding='utf-8') as f:
        r = csv.DictReader(f)
        for row in r:
            sid = row.get('stop_id')
            try:
                lat = float(row.get('stop_lat'))
                lon = float(row.get('stop_lon'))
            except Exception:
                lat = lon = None
            stops[sid] = {'row': row, 'lat': lat, 'lon': lon}
    return stops


def load_adjacency(adj_path):
    # return mapping per (route,shape) -> {stop_id: (next_stop, travel_time_s, travel_dist_m)}
    per_shape = defaultdict(dict)
    with open(adj_path, newline='', encoding='utf-8') as f:
        r = csv.DictReader(f)
        for row in r:
            route = row.get('route_id')
            shape = row.get('shape_id')
            stop = row.get('stop_id')
            next_stop = row.get('next_stop_id')
            tt = row.get('travel_time_to_next')
            td = row.get('travel_distance_to_next')
            try:
                tt_s = int(tt) if tt not in (None, '') else None
            except Exception:
                tt_s = None
            try:
                td_m = float(td) if td not in (None, '') else None
            except Exception:
                td_m = None
            per_shape[(route, shape)][stop] = (next_stop, tt_s, td_m)
    return per_shape


def find_nearest_stop_for_shape(stops, shape_map, work_lat, work_lon):
    # For each (route,shape) find nearest stop and distance
    nearest = {}
    for key, stops_map in shape_map.items():
        best = (None, float('inf'))
        for stop_id in stops_map.keys():
            s = stops.get(stop_id)
            if not s:
                continue
            lat = s['lat']
            lon = s['lon']
            if lat is None:
                continue
            d = haversine_m(work_lat, work_lon, lat, lon)
            if d < best[1]:
                best = (stop_id, d)
        if best[0] is not None:
            nearest[key] = best
    return nearest


def traverse_from_stop(shape_map, start_stop, total_seconds, stops, route_shape_key):
    # total_seconds is remaining after walking and boarding
    results = []
    cur = start_stop
    acc = 0
    visited = set()
    stops_map = shape_map.get(route_shape_key, {})
    while cur and cur not in visited:
        visited.add(cur)
        entry = stops_map.get(cur)
        if not entry:
            break
        next_stop, tt_s, td = entry
        # compute time left at current stop before boarding? we assume boarding occurs at start and then in-vehicle
        time_left_at_stop = total_seconds - acc
        if time_left_at_stop > 0:
            results.append((cur, next_stop, time_left_at_stop))
        # advance
        if tt_s is None:
            # fallback to distance / BUS_SPEED
            if td is not None:
                dt = td / BUS_SPEED_FALLBACK
            else:
                break
        else:
            dt = tt_s
        acc += dt
        if acc > total_seconds:
            break
        cur = next_stop
    return results


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--data-dir', required=True)
    p.add_argument('--lat', type=float, required=True)
    p.add_argument('--lon', type=float, required=True)
    p.add_argument('--time-minutes', type=float, required=True)
    p.add_argument('--stops', default='stops.txt')
    p.add_argument('--adjacency', default='adjacency_by_route.txt')
    args = p.parse_args()

    stops_path = os.path.join(args.data_dir, args.stops)
    adj_path = os.path.join(args.data_dir, args.adjacency)

    stops = load_stops(stops_path)
    shape_map = load_adjacency(adj_path)

    work_lat = args.lat
    work_lon = args.lon
    total_seconds = int(args.time_minutes * 60)

    nearest = find_nearest_stop_for_shape(stops, shape_map, work_lat, work_lon)

    out_rows = []
    for (route, shape), (stop_id, dist_m) in nearest.items():
        # walking time limited to 70% of total
        max_walk = total_seconds * 0.7
        walk_time = min(dist_m / WALK_SPEED, max_walk)
        remaining = total_seconds - walk_time - BOARD_TIME
        if remaining <= 0:
            continue
        # traverse forward using remaining time
        results = traverse_from_stop(shape_map, stop_id, remaining, stops, (route, shape))
        for sid, next_sid, time_left in results:
            # radius = time_left * WALK_SPEED (meters)
            radius = time_left * WALK_SPEED
            s = stops.get(sid)
            lat = s['lat'] if s else ''
            lon = s['lon'] if s else ''
            out_rows.append({'stop_id': sid, 'route_id': route, 'shape_id': shape, 'stop_lat': lat, 'stop_lon': lon, 'next_stop_id': next_sid or '', 'travel_time_to_next': shape_map[(route, shape)].get(sid)[1] if sid in shape_map[(route, shape)] else '', 'area_radius_m': int(round(radius))})

    # write output CSV
    out_name = f'bus_areas_{int(args.time_minutes)}min_{work_lat:.5f}_{work_lon:.5f}.txt'
    out_path = os.path.join(args.data_dir, out_name)
    fieldnames = ['stop_id','route_id','shape_id','stop_lat','stop_lon','next_stop_id','travel_time_to_next','area_radius_m']
    with open(out_path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in out_rows:
            w.writerow(r)

    print('Wrote', out_path)


if __name__ == '__main__':
    main()
