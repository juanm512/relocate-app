import { state } from './state.js';
import { toggleDebugVisibility as toggleDebug } from './map-draw.js';

const DOM = {
    setupView: document.getElementById('setup-view'),
    resultsView: document.getElementById('results-view'),
    addressInput: document.getElementById('address'),
    searchBtn: document.getElementById('search-btn'),
    geocodeResults: document.getElementById('geocode-results'),
    generateBtn: document.getElementById('generate-btn'),
    resetBtn: document.getElementById('reset-btn'),
    modeButtons: document.querySelectorAll('.transport-btn'),
    timeSlider: document.getElementById('time-slider'),
    timeValue: document.getElementById('time-slider-value'),
    statusText: document.getElementById('status'),
    loadingOverlay: document.getElementById('loading'),
    loadingText: document.getElementById('loading-text'),
    demoBadge: document.getElementById('demo-badge'),
    blockMessage: document.getElementById('block-message'),
    toggleDebugBtn: document.getElementById('toggle-debug-btn'),
    filterHospitales: document.getElementById('filter-hospitales'),
    filterComisarias: document.getElementById('filter-comisarias'),
    filterZonasPeligrosas: document.getElementById('filter-zonas-peligrosas'),
    involvedLinesContainer: document.getElementById('involved-lines-container')
};

export { DOM };

export function switchStage(stage) {
    if (stage === 1) {
        DOM.setupView.style.display = 'block';
        DOM.resultsView.style.display = 'none';
        
        // Reset results UI state
        DOM.involvedLinesContainer.innerHTML = '<p style="color: #64748b; font-size: 0.85em;">Los detalles del cálculo aparecerán aquí.</p>';
        DOM.filterHospitales.checked = false;
        DOM.filterComisarias.checked = false;
        DOM.filterZonasPeligrosas.checked = false;
        DOM.toggleDebugBtn.classList.remove('active');
        DOM.toggleDebugBtn.style.display = 'none'; // Only show when calculations run
        updateStatus('');
        updateBlockMessage(false);
    } else if (stage === 2) {
        DOM.setupView.style.display = 'none';
        DOM.resultsView.style.display = 'block';
        // Invalidate map size so it renders correctly after side panel change
        setTimeout(() => state.map.invalidateSize(), 300);
    }
}

export function showLoading(text = 'Cargando...') {
    DOM.loadingText.textContent = text;
    DOM.loadingOverlay.style.display = 'flex';
}

export function hideLoading() {
    DOM.loadingOverlay.style.display = 'none';
}

export function updateStatus(html, type = 'info') {
    DOM.statusText.innerHTML = html;
    DOM.statusText.className = `status status-${type}`;
    if (!html) DOM.statusText.style.display = 'none';
    else DOM.statusText.style.display = 'block';
}

export function updateBlockMessage(show, title = null) {
    if (show) {
        if (title) {
            DOM.blockMessage.innerHTML = `<strong>${title}</strong>`;
        } else {
            DOM.blockMessage.innerHTML = `⚠️ Tenés resultados cargados. <strong>Hacé clic en el mapa</strong> para calcular una ruta al trabajo, o "Nuevo cálculo" para cambiar.`;
        }
        DOM.blockMessage.style.display = 'block';
    } else {
        DOM.blockMessage.style.display = 'none';
    }
}

export function updateInvolvedLines(debugInfo, rootMode) {
    DOM.involvedLinesContainer.innerHTML = '';
    if (!debugInfo || !debugInfo.routes_used || debugInfo.routes_used.length === 0) {
        if (rootMode === 'walking' || rootMode === 'bike' || rootMode === 'car') {
            DOM.involvedLinesContainer.innerHTML = `<p style="color: #64748b; font-size: 0.85em;">Caminos directos calculados. No aplican líneas de transporte. Haz clic en la zona para calcular una ruta punto a punto.</p>`;
        } else {
            DOM.involvedLinesContainer.innerHTML = `<p style="color: #64748b; font-size: 0.85em;">No se encontraron líneas utilizables en el rango de tiempo seleccionado.</p>`;
        }
        return;
    }

    let html = '';
    
    // Almacenamos los routesData para referenciarlos al asignar eventos
    globalThis._lastInvolvedRoutes = debugInfo.routes_used;

    debugInfo.routes_used.forEach((route, idx) => {
        const color = `hsl(${[0, 210, 120, 280, 45, 180, 320, 15, 250, 75][idx % 10]}, 80%, 45%)`;
        html += `
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px; margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <h5 style="margin: 0; font-size: 13px; color: #334155;">🚇 ${route.name}</h5>
                    <label style="display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" class="route-toggle-checkbox" data-route-id="${route.route_id}" data-idx="${idx}" checked style="accent-color: ${color}; width: 14px; height: 14px;">
                        <span style="font-size: 11px; margin-left: 4px; color: #64748b;">Ruta</span>
                    </label>
                </div>
                <p style="margin: 0 0 4px 0; font-size: 11px; color: #64748b;">
                    Abordaje cercano: <b>${route.closest_stop !== null && typeof route.closest_stop === 'object' ? route.closest_stop.name : route.closest_stop}</b> (${route.walk_time_to_stop || route.walk_time_min} min caminado)
                </p>
                <div style="font-size: 10px; color: #94a3b8; margin-top: 4px;">Paradas alcanzables:</div>
                <ul style="margin: 2px 0 0; padding-left: 14px; color: #475569; font-size: 11px;">
        `;
        
        // Show up to 4 stops, then "and x more"
        const maxStops = 4;
        const total = route.stops_reached.length;
        route.stops_reached.slice(0, maxStops).forEach(stop => {
            html += `<li>${stop.name} (Restan ${stop.time_remaining} min)</li>`;
        });

        if (total > maxStops) {
            html += `<li style="font-style: italic; color: #94a3b8;">... y ${total - maxStops} paradas más</li>`;
        }

        html += `</ul></div>`;
    });
    
    DOM.involvedLinesContainer.innerHTML = html;
    
    // Dispara evento indicando que hay checks listos
    const event = new CustomEvent('transitLinesReady', { detail: { routes: debugInfo.routes_used } });
    document.dispatchEvent(event);
}

export function updateDemoBadge() {
    if (state.apiStatus.usingMock) {
        DOM.demoBadge.style.display = 'inline-block';
        DOM.demoBadge.textContent = 'Modo Demo (Sin API Key)';
    } else {
        DOM.demoBadge.style.display = 'none';
    }
}
