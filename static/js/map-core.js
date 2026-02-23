import { CONFIG } from './config.js';
import { state } from './state.js';
import { reverseGeocode, fetchRoute } from './api.js';
import { updateBlockMessage } from './ui.js';
import { clearRouteLayers, drawRoute } from './map-draw.js';

export function initMap() {
    // Inicializar mapa de Leaflet
    state.map = L.map('map', {
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true // Use HTML Canvas for vectors for high performance
    }).setView(CONFIG.cabaCenter, CONFIG.defaultZoom);

    // Controles de zoom abajo a la derecha
    L.control.zoom({ position: 'bottomright' }).addTo(state.map);

    // Tile layer base (CartoDB Positron)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
    }).addTo(state.map);

    // Attributions (custom)
    const attribution = L.control({position: 'bottomleft'});
    attribution.onAdd = function () {
        const div = L.DomUtil.create('div', 'leaflet-control-attribution');
        div.innerHTML = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
        div.style.background = 'rgba(255, 255, 255, 0.7)';
        div.style.padding = '0 5px';
        div.style.fontSize = '10px';
        return div;
    };
    attribution.addTo(state.map);

    // Eventos
    state.map.on('click', handleMapClick);
    
    // Configurar icono default
    const DefaultIcon = L.icon({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });
    L.Marker.prototype.options.icon = DefaultIcon;
}

export async function placeWorkMarker(lat, lng) {
    if (state.workMarker) {
        state.map.removeLayer(state.workMarker);
    }

    const customIcon = L.divIcon({
        className: 'custom-marker work-marker',
        html: '<div style="background-color: #3b82f6; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">🏢</div>',
        iconAnchor: [15, 15],
        popupAnchor: [0, -15]
    });

    state.workMarker = L.marker([lat, lng], {icon: customIcon}).addTo(state.map);
    state.map.setView([lat, lng], 14, {animate: true});
    
    // Address input update using Nominatim
    const addressStr = await reverseGeocode(lat, lng);
    state.selectedLocation = {
        lat: lat,
        lon: lng,
        display_name: addressStr
    };
    document.getElementById('address').value = addressStr;
    
    // Enable calculate button if mode is selected
    if (state.currentMode && state.currentMinutes) {
        document.getElementById('generate-btn').disabled = false;
        document.getElementById('generate-btn').style.opacity = '1';
    }
}

async function handleMapClick(e) {
    // Si NO se generó ninguna isócrona todavía, usar el click para establecer el marcador de trabajo
    if (state.isochroneLayers.length === 0) {
        // En etapa de setup, el click setea el origen
        await placeWorkMarker(e.latlng.lat, e.latlng.lng);
        return;
    }

    // Si tenemos results (isócrona generada), y el modo NO es subte o colectivos
    // Intentar calcular una ruta al trabajo desde el punto mode
    if (state.isochroneLayers.length > 0) {
        const mode = state.activeRouteMode;
        if (mode === 'subte' || mode === 'public_transport') {
            return; // No route line calculation for public trans yet
        }
        
        clearRouteLayers();
        updateBlockMessage(true, 'Calculando ruta...');
        
        try {
            const data = await fetchRoute(e.latlng.lat, e.latlng.lng, state.selectedLocation.lat, state.selectedLocation.lon, mode);
            
            if (data.error) throw new Error(data.error);
            if (!data.fastest || !data.fastest.success) throw new Error("No route found");
            
            const route = data.fastest;
            const geojsonLayer = drawRoute(route.geometry, mode);
            
            // Add marker at clicked pos
            const customIcon = L.divIcon({
                className: 'custom-marker origin-marker',
                html: '<div style="background-color: #10b981; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
                iconAnchor: [10, 10]
            });
            const originMarker = L.marker([e.latlng.lat, e.latlng.lng], {icon: customIcon}).addTo(state.map);
            state.routeLayers.push(originMarker);
            
            // Popup info
            const popupContent = `
                <div style="font-family: 'Inter', sans-serif;">
                    <div style="font-size: 13px; font-weight: 600; margin-bottom: 4px;">🎯 Ruta sugerida</div>
                    <div style="font-size: 12px; color: #4b5563;">
                        ⏱️ Tiempo: <span style="font-weight: 500; color: #111;">${Math.round(route.duration / 60)} min</span><br>
                        📏 Distancia: <span style="font-weight: 500; color: #111;">${(route.distance / 1000).toFixed(1)} km</span>
                    </div>
                </div>
            `;
            
            originMarker.bindPopup(popupContent).openPopup();
            updateBlockMessage(false);

        } catch (error) {
            console.error("Error drawing route:", error);
            updateBlockMessage(true, `Error al calcular ruta: ${error.message}`);
        }
    }
}
