import { CONFIG, generateLineColor } from './config.js';

// Using globalState to interface with the centralized state store
import { state as globalState } from './state.js';

export function getColorForModeAndTime(mode, minutes, alpha = 1) {
    const sConfig = CONFIG.modeColorSchemes[mode] || CONFIG.modeColorSchemes['walking'];
    const hue = sConfig.hue;
    
    // Normalize time between 5 and 60 for color intensity (60+ is max intensity)
    const normalizedTime = Math.min(Math.max(minutes, 5), 60);
    const timePercentage = (normalizedTime - 5) / (60 - 5);
    
    const lightnessSpan = CONFIG.timeColorConfig.minLightness - CONFIG.timeColorConfig.maxLightness;
    const lightness = CONFIG.timeColorConfig.minLightness - (timePercentage * lightnessSpan);
    
    return `hsla(${hue}, ${sConfig.saturation}%, ${lightness}%, ${alpha})`;
}

export function drawIsochrone(geojson, mode, minutes) {
    const sConfig = CONFIG.modeColorSchemes[mode];
    const baseColor = getColorForModeAndTime(mode, minutes, 1);
    
    // Aumentamos opacidad y bajamos lighten para public transport para que se vea
    let fillOpacity = 0.25;
    if (mode === 'subte' || mode === 'public_transport') fillOpacity = 0.4;

    const layer = L.geoJSON(geojson, {
        style: function () {
            return {
                color: baseColor,
                weight: mode === 'subte' || mode === 'public_transport' ? 4 : sConfig.weight,
                opacity: 1.0,
                fillColor: baseColor,
                fillOpacity: fillOpacity,
                dashArray: mode === 'walking' ? '5, 5' : null
            };
        }
    }).addTo(globalState.map);

    globalState.isochroneLayers.push(layer);
    
    // Solo ajustamos bounds si no es debug/rutas parciales
    globalState.map.fitBounds(layer.getBounds(), { padding: [50, 50] });
    
    return layer;
}

export function drawTransitCircles(debugInfo, minutes, mode) {
    if (!debugInfo || !debugInfo.routes_used) return;
    
    // We compute the union of all reachable circles (walk radiuses) using turf.js
    const circlePolys = [];
    const MAX_STOP_BUFFER_M = 2000;
    const baseColor = getColorForModeAndTime(mode, minutes, 1);
    
    debugInfo.routes_used.forEach((route, idx) => {
        // Individual line debug colors
        const color = generateLineColor(idx);
        
        route.stops_reached.forEach(stop => {
            if (stop.lat && stop.lon && stop.walk_radius_meters > 0) {
                const radiusKm = Math.min(stop.walk_radius_meters, MAX_STOP_BUFFER_M) / 1000.0;
                try {
                    const poly = turf.circle([stop.lon, stop.lat], radiusKm, {steps: 32, units: 'kilometers'});
                    circlePolys.push(poly);
                } catch(e) { }
                
                // Keep the circular L.circle debug layers that were here
                const circle = L.circle([stop.lat, stop.lon], {
                    radius: stop.walk_radius_meters,
                    color: color,
                    weight: 1,
                    opacity: 0.8,
                    fillColor: color,
                    fillOpacity: 0.1
                });
                circle.bindPopup(`<b>Parada:</b> ${stop.name}<br><b>Tiempo Restante:</b> ${stop.time_remaining} min`);
                globalState.debugLayers.push(circle);
                // Also show immediately if debug is currently toggled on
                if (globalState.debugVisible) {
                    circle.addTo(globalState.map);
                }
            }
        });
    });
    
    // Add the starting center walk distance as well
    if (debugInfo.max_walk_distance && globalState.selectedLocation) {
        const radiusKm = Math.min(debugInfo.max_walk_distance, MAX_STOP_BUFFER_M) / 1000.0;
        try {
            const poly = turf.circle([globalState.selectedLocation.lon, globalState.selectedLocation.lat], radiusKm, {steps: 32, units: 'kilometers'});
            circlePolys.push(poly);
            
            const startCircle = L.circle([globalState.selectedLocation.lat, globalState.selectedLocation.lon], {
                radius: debugInfo.max_walk_distance,
                color: '#000', weight: 2, dashArray: '4,4', fillOpacity: 0.1
            }).bindTooltip('Zona caminable desde origen');
            globalState.debugLayers.push(startCircle);
            if (globalState.debugVisible) {
                startCircle.addTo(globalState.map);
            }
        } catch(e) { }
    }
    
    if (circlePolys.length === 0) return;
    
    // Union the Turf polygons
    let merged = circlePolys[0];
    for (let i = 1; i < circlePolys.length; i++) {
        try {
            merged = turf.union(merged, circlePolys[i]);
        } catch(e) {
            console.warn('turf.union failed on index', i, e);
        }
    }
    
    // Smooth the polygon
    if (merged) {
        try {
            merged = turf.buffer(merged, 15/1000.0, { units: 'kilometers' });
            merged = turf.buffer(merged, -15/1000.0, { units: 'kilometers' });
        } catch(e) {}
        
        let fillOpacity = mode === 'subte' || mode === 'public_transport' ? 0.35 : 0.25;
        
        // Final unified merged geometry layer
        const unionLayer = L.geoJSON(merged, {
            style: {
                color: baseColor,
                weight: 4,
                opacity: 0.9,
                fillColor: baseColor,
                fillOpacity: fillOpacity
            }
        }).addTo(globalState.map);
        
        // Enforce isochrone tracking
        globalState.isochroneLayers.push(unionLayer);
        
        // Auto-center camera to boundaries
        if (globalState.isochroneLayers.length === 1) {
            globalState.map.fitBounds(unionLayer.getBounds(), { padding: [50, 50] });
        }
    }
}

// Draws the point-to-point route
export function drawRoute(geometryGeojson, mode) {
    const scheme = CONFIG.modeColorSchemes[mode] || CONFIG.modeColorSchemes['walking'];
    const routeColor = `hsl(${scheme.hue}, 80%, 45%)`;
    
    const layer = L.geoJSON(geometryGeojson, {
        style: {
            color: routeColor,
            weight: 5,
            opacity: 0.8,
            dashArray: mode === 'walking' ? '8, 8' : null
        }
    }).addTo(globalState.map);
    
    globalState.routeLayers.push(layer);
    return layer;
}

export function clearRouteLayers() {
    globalState.routeLayers.forEach(layer => globalState.map.removeLayer(layer));
    globalState.routeLayers = [];
}

export function drawTransitLine(routeId, polylineCoords, color, tooltipName) {
    if (!polylineCoords || polylineCoords.length === 0) return;
    
    // Si ya existe la removemos para evitar duplicados
    removeTransitLine(routeId);
    
    // Leaflet polylines await [lat, lng] array
    const line = L.polyline(polylineCoords, {
        color: color,
        weight: 4,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(globalState.map);
    
    if (tooltipName) {
        line.bindTooltip(`<b>${tooltipName}</b>`, { sticky: true });
    }
    
    globalState.transportLayers[routeId] = line;
}

export function removeTransitLine(routeId) {
    if (globalState.transportLayers[routeId]) {
        globalState.map.removeLayer(globalState.transportLayers[routeId]);
        delete globalState.transportLayers[routeId];
    }
}

export function clearTransitLines() {
    Object.values(globalState.transportLayers).forEach(layer => {
        globalState.map.removeLayer(layer);
    });
    globalState.transportLayers = {};
}

export function clearDebugLayers() {
    globalState.debugLayers.forEach(layer => globalState.map.removeLayer(layer));
    globalState.debugLayers = [];
}

export function clearIsochrones() {
    globalState.isochroneLayers.forEach(layer => globalState.map.removeLayer(layer));
    globalState.isochroneLayers = [];
    
    clearDebugLayers();
    clearRouteLayers();
    clearTransitLines();
}

export function toggleDebugVisibility(show) {
    if (show) {
        globalState.debugLayers.forEach(layer => layer.addTo(globalState.map));
    } else {
        globalState.debugLayers.forEach(layer => globalState.map.removeLayer(layer));
    }
}

export function drawPOIs(pois, iconStr, color) {
    const layers = [];
    pois.forEach(poi => {
        const icon = L.divIcon({
            className: 'custom-marker',
            html: `<div style="background-color: ${color}; width: 22px; height: 22px; border-radius: 50%; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-size: 11px;">${iconStr}</div>`,
            iconAnchor: [11, 11]
        });
        const m = L.marker([poi.lat, poi.lon], {icon}).bindPopup(`<b>${poi.name || poi.nombre || 'POI'}</b>`);
        layers.push(m);
    });
    return layers;
}

export function drawPolygons(polygons, color) {
    const layers = [];
    polygons.forEach(feature => {
        if (feature.polygon) {
            const l = L.polygon(feature.polygon, {
                color: color,
                weight: 2,
                opacity: 0.8,
                fillColor: color,
                fillOpacity: 0.2
            });
            if (feature.name || feature.type) {
                l.bindPopup(`<b>Z. Peligrosa:</b> ${feature.name || 'Desconocido'}<br><small>${feature.type || ''}</small>`);
            }
            layers.push(l);
        }
    });
    return layers;
}
