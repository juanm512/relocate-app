// Web Worker for processing heavy geospatial operations (turf.union, turf.circle, etc.)
importScripts('https://unpkg.com/@turf/turf@6.5.0/turf.min.js');

self.onmessage = function(e) {
    const data = e.data;
    const { action, payload } = data;
    
    if (action === 'calculateIsochroneUnion') {
        const { debugInfo, MAX_STOP_BUFFER_M } = payload;
        const circlePolys = [];
        const addedClosestStops = new Set();
        
        // 1. Generate all base circles based on reachable stops
        debugInfo.routes_used.forEach((route) => {
            route.stops_reached.forEach(stop => {
                if (stop.lat && stop.lon && stop.walk_radius_meters > 0) {
                    const radiusKm = Math.min(stop.walk_radius_meters, MAX_STOP_BUFFER_M) / 1000.0;
                    try {
                        const poly = turf.circle([stop.lon, stop.lat], radiusKm, {steps: 32, units: 'kilometers'});
                        circlePolys.push(poly);
                    } catch(err) { }
                }
            });
        });
        
        // 2. Center starting point walk distance
        if (debugInfo.max_walk_distance && payload.centerCoords) {
            const radiusKm = Math.min(debugInfo.max_walk_distance, MAX_STOP_BUFFER_M) / 1000.0;
            try {
                const poly = turf.circle([payload.centerCoords.lon, payload.centerCoords.lat], radiusKm, {steps: 32, units: 'kilometers'});
                circlePolys.push(poly);
            } catch(e) { }
        }
        
        if (circlePolys.length === 0) {
            self.postMessage({ success: true, resultGeoJSON: null });
            return;
        }
        
        // 3. Union them all
        let merged = circlePolys[0];
        for (let i = 1; i < circlePolys.length; i++) {
            try {
                merged = turf.union(merged, circlePolys[i]);
            } catch(err) {
                console.warn('Worker: turf.union exception on index', i, err);
            }
        }
        
        // 4. Smooth polygon shapes
        if (merged) {
            try {
                merged = turf.buffer(merged, 15/1000.0, { units: 'kilometers' });
                merged = turf.buffer(merged, -15/1000.0, { units: 'kilometers' });
            } catch(e) {}
        }
        
        // Return the final merged GeoJSON back to the UI thread
        self.postMessage({ success: true, resultGeoJSON: merged });
    }
};
