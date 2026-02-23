import { CONFIG } from './config.js';
import { state } from './state.js';
import { checkApiStatus, fetchIsochrone, fetchPOIs, geocode } from './api.js';
import { DOM, switchStage, showLoading, hideLoading, updateStatus, updateDemoBadge, updateBlockMessage, updateInvolvedLines } from './ui.js';
import { initMap, placeWorkMarker } from './map-core.js';
import { clearIsochrones, drawIsochrone, drawTransitCircles, toggleDebugVisibility, drawPOIs, drawPolygons, drawTransitLine, removeTransitLine, highlightTransitLine } from './map-draw.js';

let debounceTimer = null;
let activeFilters = {
    hospitales: [],
    comisarias: [],
    zonasPeligrosas: []
};

document.addEventListener('DOMContentLoaded', async () => {
    initMap();
    await checkApiStatus();
    updateDemoBadge();
    bindEventListeners();
    switchStage(1);
});

function bindEventListeners() {
    // Mode selection
    DOM.modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            DOM.modeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentMode = btn.dataset.mode;
        });
    });

    // Time slider
    DOM.timeSlider.addEventListener('input', (e) => {
        DOM.timeValue.textContent = e.target.value;
        state.currentMinutes = parseInt(e.target.value, 10);
        
        // Update slider custom gradient background
        const min = e.target.min || 5;
        const max = e.target.max || 120;
        const val = e.target.value;
        const percent = ((val - min) / (max - min)) * 100;
        e.target.style.background = `linear-gradient(90deg, var(--primary) ${percent}%, #e5e7eb ${percent}%)`;
    });
    
    // Initialize slider background
    const initialPercent = ((DOM.timeSlider.value - 5) / (120 - 5)) * 100;
    DOM.timeSlider.style.background = `linear-gradient(90deg, var(--primary) ${initialPercent}%, #e5e7eb ${initialPercent}%)`;

    // Address input search
    DOM.searchBtn.addEventListener('click', handleSearch);
    DOM.addressInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });
    DOM.addressInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(handleSearch, 800);
    });

    // Actions
    DOM.generateBtn.addEventListener('click', generateIsochrones);
    DOM.resetBtn.addEventListener('click', resetCalculation);

    // Filters
    DOM.filterHospitales.addEventListener('change', (e) => toggleLayer('hospitales', e.target.checked));
    DOM.filterComisarias.addEventListener('change', (e) => toggleLayer('comisarias', e.target.checked));
    DOM.filterZonasPeligrosas.addEventListener('change', (e) => toggleLayer('barrios-populares', e.target.checked));

    // Debug toggle
    if (DOM.toggleDebugBtn) {
        DOM.toggleDebugBtn.addEventListener('click', () => {
            DOM.toggleDebugBtn.classList.toggle('active');
            const show = DOM.toggleDebugBtn.classList.contains('active');
            toggleDebugVisibility(show);
        });
    }

    // Transit Lines Toggles
    document.addEventListener('transitLinesReady', (e) => {
        const routes = e.detail.routes;
        const checkboxes = document.querySelectorAll('.route-toggle-checkbox');
        
        checkboxes.forEach(cb => {
            const routeId = cb.dataset.routeId;
            const idx = parseInt(cb.dataset.idx, 10);
            const routeData = routes.find(r => r.route_id === routeId || r.name === routeId) || routes[idx];
            
            // Extract the hsl color string from inline accent-color style
            const color = window.getComputedStyle(cb).accentColor || `hsl(${[0, 210, 120, 280, 45, 180, 320, 15, 250, 75][idx % 10]}, 80%, 45%)`;
            
            // Draw initially if checked
            if (cb.checked && routeData && routeData.polyline) {
                drawTransitLine(routeId, routeData.polyline, color, routeData.name);
            }
            
            cb.addEventListener('change', (evt) => {
                if (evt.target.checked) {
                    if (routeData && routeData.polyline) {
                        drawTransitLine(routeId, routeData.polyline, color, routeData.name);
                    }
                } else {
                    removeTransitLine(routeId);
                }
            });
        });

        const toggleAllBtn = document.getElementById('toggle-all-routes-btn');
        if (toggleAllBtn) {
            toggleAllBtn.addEventListener('click', (evt) => {
                const isAllChecked = evt.target.dataset.allChecked === 'true';
                const newState = !isAllChecked;
                
                evt.target.dataset.allChecked = newState;
                evt.target.textContent = newState ? 'Marcar todas' : 'Desmarcar todas';
                
                checkboxes.forEach(cb => {
                    if (cb.checked !== newState) {
                        cb.checked = newState;
                        cb.dispatchEvent(new Event('change'));
                    }
                });
            });
        }
        
        // --- Markers & Search Optimizations ---
        const searchInput = document.getElementById('route-search-input');
        const routeCards = document.querySelectorAll('.route-card');
        
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                routeCards.forEach(card => {
                    const idx = card.dataset.idx;
                    const name = (routes[idx] || {}).name || '';
                    if (name.toLowerCase().includes(term)) {
                        card.style.display = 'block';
                    } else {
                        card.style.display = 'none';
                    }
                });
            });
        }
        
        const markersToggleBtn = document.getElementById('toggle-markers-checkbox');
        
        // Notify map to update marker visibility based on current checked lines
        const updateAllMarkers = () => {
            if (typeof window.updateMarkersVisibility === 'function') {
                const checkedIds = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.dataset.routeId);
                const showMarkers = markersToggleBtn ? markersToggleBtn.checked : true;
                window.updateMarkersVisibility(checkedIds, showMarkers);
            }
        };

        if (markersToggleBtn) {
            markersToggleBtn.addEventListener('change', updateAllMarkers);
        }
        // Bind to line toggles as well
        checkboxes.forEach(cb => cb.addEventListener('change', updateAllMarkers));
        
        // Initial sync of marker visibility
        setTimeout(updateAllMarkers, 100);
        
        routeCards.forEach(card => {
            const routeId = card.dataset.routeId;
            const idx = parseInt(card.dataset.idx, 10);
            const routeData = routes.find(r => r.route_id === routeId || r.name === routeId) || routes[idx];
            
            const cb = card.querySelector('.route-toggle-checkbox');
            const color = window.getComputedStyle(cb).accentColor || `hsl(${[0, 210, 120, 280, 45, 180, 320, 15, 250, 75][idx % 10]}, 80%, 45%)`;
            
            card.addEventListener('mouseenter', () => {
                card.style.borderColor = color;
                card.style.boxShadow = `0 0 0 1px ${color}`;
                if (!cb.checked && routeData && routeData.polyline) {
                    drawTransitLine(routeId, routeData.polyline, color, routeData.name);
                    highlightTransitLine(routeId, true);
                } else if (cb.checked) {
                    highlightTransitLine(routeId, true);
                }
            });
            
            card.addEventListener('mouseleave', () => {
                card.style.borderColor = '#e2e8f0';
                card.style.boxShadow = 'none';
                if (!cb.checked) {
                    removeTransitLine(routeId);
                } else if (cb.checked) {
                    highlightTransitLine(routeId, false);
                }
            });
        });
    });
}

async function handleSearch() {
    const address = DOM.addressInput.value.trim();
    if (!address) {
        DOM.geocodeResults.innerHTML = '';
        return;
    }
    
    // Si la búsqueda es la misma que ya tenemos seteada, ignorar (para no romper placeWorkMarker)
    if (state.selectedLocation && address === state.selectedLocation.display_name) {
        DOM.geocodeResults.innerHTML = '';
        return;
    }

    try {
        const data = await geocode(address);
        
        DOM.geocodeResults.innerHTML = '';
        if (data.results && data.results.length > 0) {
            data.results.forEach(result => {
                const div = document.createElement('div');
                div.className = 'result-item';
                div.innerHTML = `📍 ${result.display_name}`;
                div.onclick = () => {
                    placeWorkMarker(result.lat, result.lon);
                    DOM.geocodeResults.innerHTML = '';
                };
                DOM.geocodeResults.appendChild(div);
            });
        } else {
            DOM.geocodeResults.innerHTML = '<div class="result-item" style="color: #94a3b8; font-style: italic; cursor: default;">No se encontraron resultados en CABA</div>';
        }
    } catch (e) {
        console.error(e);
    }
}

async function toggleLayer(type, show) {
    if (!show) {
        if (activeFilters[type]) {
            activeFilters[type].forEach(layer => state.map.removeLayer(layer));
            activeFilters[type] = [];
        }
        return;
    }

    showLoading(`Cargando ${type}...`);
    try {
        const data = await fetchPOIs(type);
        if (type === 'hospitales') {
            activeFilters[type] = drawPOIs(data.hospitales, '🏥', '#ef4444');
        } else if (type === 'comisarias') {
            activeFilters[type] = drawPOIs(data.comisarias, '👮', '#3b82f6');
        } else if (type === 'barrios-populares') {
            activeFilters[type] = drawPolygons(data.barrios, '#ef4444');
        }
        
        activeFilters[type].forEach(layer => layer.addTo(state.map));
    } catch (e) {
        console.error(`Error loading ${type}:`, e);
        updateStatus(`No se pudo cargar la información de ${type}`, 'error');
    }
    hideLoading();
}

async function generateIsochrones() {
    if (!state.selectedLocation) {
        alert("Por favor selecciona una ubicación de trabajo");
        return;
    }

    showLoading(`Calculando zona para ${state.currentMinutes} min (${state.currentMode})...`);
    clearIsochrones();
    
    try {
        const data = await fetchIsochrone(state.currentMode, state.currentMinutes, state.selectedLocation.lat, state.selectedLocation.lon);
        
        if (data.error) {
            updateStatus(data.error, 'error');
            hideLoading();
            return;
        }

        // Advance to Stage 2
        switchStage(2);
        state.activeRouteMode = state.currentMode;
        
        // Render geometry
        drawIsochrone(data.isochrone, state.currentMode, state.currentMinutes);
        
        const modeTitle = document.querySelector(`.transport-btn[data-mode="${state.currentMode}"] span:last-child`).textContent;
        updateStatus(`✅ Área calculada para <b>${state.currentMinutes} min</b> en <b>${modeTitle}</b>.`, 'success');

        // Draw debug circles and info
        if (data.isochrone.properties && data.isochrone.properties.debug_info) {
            const di = data.isochrone.properties.debug_info;
            if (DOM.toggleDebugBtn) DOM.toggleDebugBtn.style.display = 'inline-block';
            drawTransitCircles(di, state.currentMinutes, state.currentMode);
            updateInvolvedLines(di, state.currentMode);
        } else {
            if (DOM.toggleDebugBtn) {
                DOM.toggleDebugBtn.style.display = 'none';
                DOM.toggleDebugBtn.classList.remove('active');
            }
            updateInvolvedLines(null, state.currentMode);
        }
        
        updateBlockMessage(true, 'Zona calculada existosamente.');

    } catch (error) {
        console.error(error);
        updateStatus('Ocurrió un error al conectar con el servidor', 'error');
    }
    
    hideLoading();
}

function resetCalculation() {
    clearIsochrones();
    updateStatus('');
    switchStage(1);
    state.activeRouteMode = 'walking';
}
