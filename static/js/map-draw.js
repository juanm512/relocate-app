import { CONFIG, generateLineColor } from './config.js';
import { state as globalState } from './state.js';

// Init map worker for heavy geometry logic
const mapWorker = new Worker('/static/js/worker.js');

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
    
    // Store unique stops based on coordinate keys
    const uniqueStops = new Map();
    const startStops = new Map();

    const getCoordKey = (lat, lon) => `${parseFloat(lat).toFixed(5)},${parseFloat(lon).toFixed(5)}`;
    
    // Almacenamos los marcadores generados en esta corrida
    const createdMarkers = [];

    debugInfo.routes_used.forEach((route, idx) => {
        const color = generateLineColor(idx);
        
        // Track the closest stop (Start)
        if (route.closest_stop_coords) {
            const key = getCoordKey(route.closest_stop_coords[0], route.closest_stop_coords[1]);
            const stopName = typeof route.closest_stop === 'object' ? route.closest_stop.name : route.closest_stop;
            
            if (!startStops.has(key)) {
                startStops.set(key, { lat: route.closest_stop_coords[0], lon: route.closest_stop_coords[1], name: stopName, lines: [] });
            }
            startStops.get(key).lines.push({ name: route.name, color, route_id: route.route_id });
        }
        
        // Track reachable stops
        route.stops_reached.forEach(stop => {
            if (stop.lat && stop.lon && stop.walk_radius_meters > 0) {
                const radiusKm = Math.min(stop.walk_radius_meters, MAX_STOP_BUFFER_M) / 1000.0;
                try {
                    const poly = turf.circle([stop.lon, stop.lat], radiusKm, {steps: 32, units: 'kilometers'});
                    circlePolys.push(poly);
                } catch(e) { }
                
                const key = getCoordKey(stop.lat, stop.lon);
                if (!uniqueStops.has(key)) {
                    uniqueStops.set(key, { lat: stop.lat, lon: stop.lon, name: stop.name, lines: [], bestTime: 999 });
                }
                const entry = uniqueStops.get(key);
                if (stop.time_remaining < entry.bestTime) entry.bestTime = stop.time_remaining;
                
                // Avoid duplicating line names for the same stop if multiple sub-variants hit it
                if (!entry.lines.some(l => l.name === route.name)) {
                    entry.lines.push({ name: route.name, color, route_id: route.route_id });
                }
            }
        });
    });

    // -------------------------------------------------------------
    // Draw clustered Start Stops (Usually small number, synchronous is fine)
    // -------------------------------------------------------------
    startStops.forEach(stop => {
        const isMulti = stop.lines.length > 1;
        const mainColor = stop.lines[0].color;
        const lineTags = stop.lines.map(l => `<span style="background:${l.color};color:white;padding:2px 4px;border-radius:3px;font-size:10px;">${l.name}</span>`).join(' ');
        
        const html = `
            <div style="position:relative; width:28px; height:28px; display:flex; align-items:center; justify-content:center; background:${mainColor}; border:3px solid white; border-radius:50%; box-shadow:0 3px 6px rgba(0,0,0,0.3); font-size:14px; z-index:1000;">
                🚶
                ${isMulti ? `<div style="position:absolute; top:-4px; right:-4px; background:#1e293b; color:white; font-size:9px; width:14px; height:14px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:1px solid white; font-weight:bold;">${stop.lines.length}</div>` : ''}
            </div>`;
            
        const icon = L.divIcon({ className: '', html, iconAnchor: [14, 14] });
        const marker = L.marker([stop.lat, stop.lon], { icon, zIndexOffset: 1000 });
        marker.bindPopup(`<b>Origen: ${stop.name}</b><br><div style="margin-top:4px;">${lineTags}</div>`);
        marker.routeIds = stop.lines.map(l => l.route_id); // Guardamos que lineas usan la parada
        globalState.routeLayers.push(marker);
        createdMarkers.push(marker);
    });

    // -------------------------------------------------------------
    // Draw clustered Reachable Stops (Chunked rendering for performance)
    // -------------------------------------------------------------
    const stopsArray = Array.from(uniqueStops.values());
    const chunkSize = 100;
    let currentIndex = 0;

    function processChunk() {
        const end = Math.min(currentIndex + chunkSize, stopsArray.length);
        const markersToAdd = [];
        
        for (let i = currentIndex; i < end; i++) {
            const stop = stopsArray[i];
            const isMulti = stop.lines.length > 1;
            const mainColor = isMulti ? '#475569' : stop.lines[0].color;
            const lineTags = stop.lines.map(l => `<span style="background:${l.color};color:white;padding:2px 4px;border-radius:3px;font-size:10px;">${l.name}</span>`).join(' ');
            
            const marker = L.circleMarker([stop.lat, stop.lon], {
                radius: 6,
                fillColor: mainColor,
                color: '#ffffff',
                weight: 2,
                opacity: 1,
                fillOpacity: 1
            });
            
            marker.bindPopup(`<b>Parada: ${stop.name}</b><br><span style="color:#64748b;font-size:11px;">Restan aprox. ${parseFloat(stop.bestTime).toFixed(1)} min</span><br><div style="margin-top:4px;">${lineTags}</div>`);
            marker.routeIds = stop.lines.map(l => l.route_id);
            
            globalState.routeLayers.push(marker);
            createdMarkers.push(marker);
            markersToAdd.push(marker);
        }
        
        currentIndex = end;
        
        if (currentIndex < stopsArray.length) {
            requestAnimationFrame(processChunk);
        } else {
            // Done mapping markers
            globalState.stopMarkers = createdMarkers;
        }
    }
    
    // Start cluster chunking
    if (stopsArray.length > 0) {
        requestAnimationFrame(processChunk);
    } else {
        globalState.stopMarkers = createdMarkers;
    }
    
    // Asynchronous Turf Union execution via Web Worker
    const payload = {
        debugInfo: debugInfo,
        MAX_STOP_BUFFER_M: MAX_STOP_BUFFER_M,
        centerCoords: globalState.selectedLocation ? { lat: globalState.selectedLocation.lat, lon: globalState.selectedLocation.lon } : null
    };

    mapWorker.postMessage({ action: 'calculateIsochroneUnion', payload: payload });

    mapWorker.onmessage = function(e) {
        if (!e.data || !e.data.success) return;
        
        const merged = e.data.resultGeoJSON;
        if (!merged) return;

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
    };
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

export function highlightTransitLine(routeId, highlight) {
    const line = globalState.transportLayers[routeId];
    if (line) {
        line.setStyle({
            weight: highlight ? 8 : 4,
            opacity: highlight ? 1.0 : 0.9
        });
        if (highlight) {
            line.bringToFront();
        }
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

window.updateMarkersVisibility = function (checkedRouteIds, showAllMarkers) {
    if (!globalState.stopMarkers) return;
    
    globalState.stopMarkers.forEach(marker => {
        if (!showAllMarkers) {
            globalState.map.removeLayer(marker);
            return;
        }
        
        // Verifica si al menos una de las líneas que usan esta parada está marcada en la UI
        const hasActiveRoute = marker.routeIds && marker.routeIds.some(id => checkedRouteIds.includes(id));
        
        if (hasActiveRoute) {
            if (!globalState.map.hasLayer(marker)) {
                marker.addTo(globalState.map);
            }
        } else {
            globalState.map.removeLayer(marker);
        }
    });
};
