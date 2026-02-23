import { state } from './state.js';

export async function checkApiStatus() {
    try {
        const response = await fetch('/api/health');
        if (response.ok) {
            const data = await response.json();
            state.apiStatus.ok = true;
            state.apiStatus.usingMock = !data.api_key_configured;
            console.log(`[API] Estado: OK. Usando Mock: ${state.apiStatus.usingMock}`);
            return data;
        }
    } catch (error) {
        console.error('[API] Error verificando el estado del backend:', error);
        state.apiStatus.ok = false;
        return null;
    }
}

export async function geocode(address) {
    const response = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
    if (!response.ok) throw new Error('Error al geocodificar');
    return await response.json();
}

export async function reverseGeocode(lat, lng) {
    try {
        const response = await fetch(`/api/reverse?lat=${lat}&lon=${lng}`);
        if (response.ok) {
            const data = await response.json();
            return data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        }
    } catch (error) {
        console.error('Error in reverse geocoding:', error);
    }
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

export async function fetchIsochrone(mode, minutes, lat, lon) {
    const response = await fetch('/api/isochrone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lon, mode, minutes })
    });
    
    if (!response.ok) {
        throw new Error('Error al generar la isócrona desde el servidor');
    }
    
    return await response.json();
}

export async function fetchRoute(fromLat, fromLon, toLat, toLon, mode) {
    const response = await fetch(`/api/route?from_lat=${fromLat}&from_lon=${fromLon}&to_lat=${toLat}&to_lon=${toLon}&mode=${mode}`);
    if (!response.ok) throw new Error('Error al calcular la ruta');
    return await response.json();
}

export async function fetchPOIs(type) {
    // type can be 'hospitales', 'comisarias', 'barrios-populares'
    const response = await fetch(`/api/${type}`);
    if (!response.ok) throw new Error(`Error al obtener ${type}`);
    return await response.json();
}
