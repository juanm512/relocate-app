/**
 * Relocate - Mapa de Alcance CABA
 * Frontend JavaScript para interactividad del mapa
 */

// ===== Configuración =====
const CONFIG = {
    cabaCenter: [-34.6037, -58.3816],
    defaultZoom: 13,
    
    // Cada modo tiene su propia gama de colores (hue base)
    // Los tiempos varían en saturación/luminosidad dentro de esa gama
    modeColorSchemes: {
        'walking': {
            hue: 145,  // Verde
            saturation: 70,
            label: 'Caminando',
            dashArray: null,
            weight: 3,
            icon: '🚶'
        },
        'bike': {
            hue: 210,  // Azul
            saturation: 75,
            label: 'Bici',
            dashArray: '5, 5',
            weight: 3,
            icon: '🚲'
        },
        'car': {
            hue: 15,   // Naranja/Rojo
            saturation: 85,
            label: 'Auto',
            dashArray: null,
            weight: 4,
            icon: '🚗'
        },
        'public_transport': {
            hue: 270,  // Violeta/Púrpura
            saturation: 70,
            label: 'Transporte',
            dashArray: '10, 5',
            weight: 3,
            icon: '🚌'
        }
    },
    
    // Para cálculo de colores por tiempo
    // Menor tiempo = más claro/opaco, Mayor tiempo = más intenso
    // Aumentado el rango para que el degradé sea más noticeable
    timeColorConfig: {
        minLightness: 90,  // MUY claro/casi blanco para tiempos cortos (5-15 min)
        maxLightness: 35,  // MUY intenso para tiempos largos (60+ min)
        minOpacity: 0.08,  // Casi transparente para tiempos cortos
        maxOpacity: 0.50   // Bien opaco para tiempos largos
    },
    
    transportColors: {
        'A': '#00a0e3', 'B': '#ee3d3d', 'C': '#0071bc',
        'D': '#008065', 'E': '#6f2390', 'H': '#ffd600',
        'Mitre': '#00a0e3', 'Roca': '#ee3d3d',
        'San Martín': '#ee3d3d', 'Sarmiento': '#00a651'
    }
};

// ===== Estado de la aplicación =====
const state = {
    map: null,
    workMarker: null,
    isochroneLayers: [],
    debugLayers: [],  // Capas de debug (círculos, markers)
    transportLayers: {},
    selectedLocation: null,
    viewMode: 'single',
    primaryMode: 'walking',
    secondaryMode: 'bike',
    selectedTimes: [15, 30, 45, 60],
    customTimes: [],
    showTransport: true,
    debugMode: false,
    isLoading: false,
    hasResults: false,
    routeLayers: [],  // Capas de rutas dibujadas
    activeRouteMode: 'walking'  // Modo usado para calcular rutas
};

// ===== Inicialización =====
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initEventListeners();
    loadTransportLines();
    checkApiStatus();
});

function initMap() {
    // Crear mapa centrado en CABA
    state.map = L.map('map', {
        center: CONFIG.cabaCenter,
        zoom: CONFIG.defaultZoom,
        zoomControl: false
    });
    
    // Agregar control de zoom en posición personalizada
    L.control.zoom({ position: 'topright' }).addTo(state.map);
    
    // Capa base de OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(state.map);
    
    // Limitar vista a CABA aproximadamente
    const cabaBounds = L.latLngBounds(
        [-34.75, -58.53],
        [-34.52, -58.33]
    );
    state.map.setMaxBounds(cabaBounds);
    state.map.fitBounds(cabaBounds);
    
    // Event listener para clic en el mapa
    state.map.on('click', handleMapClick);
    
    // Cambiar cursor al pasar sobre el mapa
    state.map.on('mouseover', () => {
        document.getElementById('map').classList.add('map-clickable');
    });
    
    // Mensaje de ayuda en el mapa
    const helpControl = L.control({ position: 'bottomright' });
    helpControl.onAdd = function() {
        const div = L.DomUtil.create('div', 'map-help-tooltip');
        div.innerHTML = '🖱️ Hacé clic para seleccionar ubicación';
        return div;
    };
    helpControl.addTo(state.map);
}

// Manejar clic en el mapa
function handleMapClick(e) {
    const { lat, lng } = e.latlng;
    
    // Verificar si está dentro de CABA aproximadamente
    if (lat < -34.75 || lat > -34.52 || lng < -58.53 || lng > -58.33) {
        showStatus('Por favor seleccioná una ubicación dentro de CABA', 'error');
        return;
    }
    
    // Si hay resultados, calcular ruta al punto clickeado
    if (state.hasResults) {
        calculateRouteToPoint(lat, lng);
        return;
    }
    
    // Colocar marcador
    placeWorkMarker(lat, lng);
    
    // Actualizar estado
    state.selectedLocation = { lat, lng };
    updateGenerateButton();
    
    // Intentar obtener dirección aproximada (reverse geocoding)
    reverseGeocode(lat, lng);
    
    // Feedback visual
    showStatus('📍 Ubicación seleccionada', 'success');
}

// Reverse geocoding
async function reverseGeocode(lat, lng) {
    try {
        // Usar Nominatim para reverse geocoding
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`,
            { headers: { 'User-Agent': 'RelocateApp/1.0' } }
        );
        
        if (response.ok) {
            const data = await response.json();
            if (data && data.display_name) {
                // Extraer calle y altura aproximada
                const address = data.address;
                const street = address.road || address.street || address.pedestrian || 'Ubicación seleccionada';
                const houseNumber = address.house_number ? ` ${address.house_number}` : '';
                const neighborhood = address.neighbourhood || address.suburb || '';
                
                // Mostrar en el input
                const displayText = `${street}${houseNumber}${neighborhood ? ', ' + neighborhood : ''}`;
                document.getElementById('address').value = displayText;
                
                // Actualizar popup del marcador
                if (state.workMarker) {
                    state.workMarker.setPopupContent(`
                        <strong>📍 Tu trabajo</strong><br>
                        <small>${displayText}</small><br>
                        <small style="color: #6b7280;">${lat.toFixed(5)}, ${lng.toFixed(5)}</small>
                    `);
                }
            }
        }
    } catch (error) {
        console.log('No se pudo obtener la dirección exacta');
        // Si falla el reverse geocoding, mostrar coordenadas
        document.getElementById('address').value = `Ubicación seleccionada`;
    }
}

function initEventListeners() {
    // Botón de búsqueda
    document.getElementById('search-btn').addEventListener('click', handleSearch);
    
    // Enter en input de dirección
    document.getElementById('address').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });
    
    // Botones de modo de visualización
    document.querySelectorAll('.view-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.view-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.viewMode = btn.dataset.view;
            toggleViewMode();
        });
    });
    
    // Botones de modo primario
    document.querySelectorAll('#transport-modes .transport-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#transport-modes .transport-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.primaryMode = btn.dataset.mode;
            // Si estamos en modo compare y es el mismo que secundario, cambiar secundario
            if (state.viewMode === 'compare' && state.primaryMode === state.secondaryMode) {
                const modes = ['walking', 'bike', 'car', 'public_transport'];
                state.secondaryMode = modes.find(m => m !== state.primaryMode);
                updateSecondaryModeButtons();
            }
        });
    });
    
    // Botones de modo secundario
    document.querySelectorAll('#transport-modes-secondary .transport-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            if (mode === state.primaryMode) {
                showStatus('El modo secundario debe ser diferente al primario', 'error');
                return;
            }
            document.querySelectorAll('#transport-modes-secondary .transport-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.secondaryMode = mode;
        });
    });
    
    // Botones de tiempo
    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const minutes = parseInt(btn.dataset.minutes);
            
            if (btn.classList.contains('active')) {
                if (state.selectedTimes.length > 1) {
                    btn.classList.remove('active');
                    state.selectedTimes = state.selectedTimes.filter(t => t !== minutes);
                }
            } else {
                btn.classList.add('active');
                state.selectedTimes.push(minutes);
                state.selectedTimes.sort((a, b) => a - b);
            }
            
            updateGenerateButton();
        });
    });
    
    // Checkbox de transporte público
    document.getElementById('show-transport-layer').addEventListener('change', (e) => {
        state.showTransport = e.target.checked;
        toggleTransportLayer();
    });
    
    // Checkbox de modo debug (ver círculos)
    document.getElementById('debug-mode').addEventListener('change', (e) => {
        state.debugMode = e.target.checked;
        console.log('Modo círculos:', state.debugMode ? 'ACTIVADO' : 'DESACTIVADO');
        if (state.hasResults) {
            toggleDebugVisibility();
        }
    });
    
    // Checkbox de mostrar solo envolvente
    document.getElementById('show-hull-only').addEventListener('change', (e) => {
        if (state.hasResults) {
            toggleDebugVisibility();
        }
    });
    
    // Botón generar
    document.getElementById('generate-btn').addEventListener('click', generateIsochrones);
    
    // Botón reset
    document.getElementById('reset-btn').addEventListener('click', resetCalculation);
    
    // Tiempo personalizado
    document.getElementById('add-time-btn').addEventListener('click', addCustomTime);
    document.getElementById('custom-time').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addCustomTime();
    });
    
    // Toggle todas las capas
    document.getElementById('toggle-all-layers').addEventListener('click', toggleAllLayers);
}

// ===== Tiempos personalizados =====
function addCustomTime() {
    const input = document.getElementById('custom-time');
    const minutes = parseInt(input.value);
    
    if (!minutes || minutes < 5 || minutes > 120) {
        showStatus('Ingresá un tiempo entre 5 y 120 minutos', 'error');
        return;
    }
    
    // Evitar duplicados
    if (state.selectedTimes.includes(minutes) || state.customTimes.includes(minutes)) {
        showStatus('Ese tiempo ya está agregado', 'error');
        return;
    }
    
    state.customTimes.push(minutes);
    state.customTimes.sort((a, b) => a - b);
    
    renderCustomTimes();
    input.value = '';
    showStatus(`✅ ${minutes} minutos agregado`, 'success');
}

function removeCustomTime(minutes) {
    state.customTimes = state.customTimes.filter(t => t !== minutes);
    renderCustomTimes();
}

function renderCustomTimes() {
    const container = document.getElementById('custom-times-list');
    container.innerHTML = '';
    
    state.customTimes.forEach(minutes => {
        const chip = document.createElement('div');
        chip.className = 'custom-time-chip';
        chip.innerHTML = `
            ${minutes} min
            <span class="remove" onclick="removeCustomTime(${minutes})">×</span>
        `;
        container.appendChild(chip);
    });
}

// Hacer disponible globalmente
window.removeCustomTime = removeCustomTime;

// ===== Funciones de modo de visualización =====
function toggleViewMode() {
    const primaryGroup = document.getElementById('primary-mode-group');
    const secondaryGroup = document.getElementById('secondary-mode-group');
    
    if (state.viewMode === 'single') {
        primaryGroup.querySelector('label').textContent = '🚗 Medio de transporte';
        secondaryGroup.style.display = 'none';
    } else {
        primaryGroup.querySelector('label').textContent = '🚗 Medio principal';
        secondaryGroup.style.display = 'block';
        updateSecondaryModeButtons();
    }
}

function updateSecondaryModeButtons() {
    document.querySelectorAll('#transport-modes-secondary .transport-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.mode === state.secondaryMode) {
            btn.classList.add('active');
        }
    });
}

// ===== Panel de capas =====
function updateLayersPanel() {
    const panel = document.getElementById('layers-panel');
    const list = document.getElementById('layers-list');
    
    if (state.isochroneLayers.length === 0) {
        panel.style.display = 'none';
        return;
    }
    
    panel.style.display = 'flex';
    list.innerHTML = '';
    
    // Separar capas principales de comparación
    const primaryLayers = state.isochroneLayers.filter(l => !l.isOutline);
    const outlineLayers = state.isochroneLayers.filter(l => l.isOutline);
    
    // Sección: Modo Principal
    if (primaryLayers.length > 0) {
        const primaryHeader = document.createElement('div');
        primaryHeader.className = 'layers-section-header';
        primaryHeader.innerHTML = `<strong>🎯 Modo Principal</strong>`;
        list.appendChild(primaryHeader);
        
        // Agrupar por modo
        const byMode = {};
        primaryLayers.forEach(item => {
            if (!byMode[item.mode]) byMode[item.mode] = [];
            byMode[item.mode].push(item);
        });
        
        Object.entries(byMode).forEach(([mode, items]) => {
            const scheme = CONFIG.modeColorSchemes[mode];
            items.sort((a, b) => a.minutes - b.minutes);
            
            items.forEach(item => {
                addLayerItem(list, item, scheme, false);
            });
        });
    }
    
    // Sección: Modo de Comparación
    if (outlineLayers.length > 0) {
        const compareHeader = document.createElement('div');
        compareHeader.className = 'layers-section-header secondary';
        compareHeader.style.cssText = 'background: #f3f4f6; border-left: 3px solid #9ca3af;';
        compareHeader.innerHTML = `<strong>👁️ Comparación</strong><br><small style="font-size: 10px; text-transform: none;">Líneas punteadas sin relleno</small>`;
        list.appendChild(compareHeader);
        
        const byMode = {};
        outlineLayers.forEach(item => {
            if (!byMode[item.mode]) byMode[item.mode] = [];
            byMode[item.mode].push(item);
        });
        
        Object.entries(byMode).forEach(([mode, items]) => {
            const scheme = CONFIG.modeColorSchemes[mode];
            items.sort((a, b) => a.minutes - b.minutes);
            
            items.forEach(item => {
                addLayerItem(list, item, scheme, true);
            });
        });
    }
}

function addLayerItem(list, item, scheme, isOutline) {
    const layerItem = document.createElement('div');
    layerItem.className = `layer-item ${item.visible ? '' : 'hidden'} ${isOutline ? 'outline' : ''}`;
    layerItem.innerHTML = `
        <input type="checkbox" class="layer-checkbox" 
               ${item.visible ? 'checked' : ''} 
               onchange="toggleLayerVisibility('${item.mode}', ${item.minutes}, ${isOutline})">
        <div class="layer-color ${isOutline ? 'outline' : ''}" style="background: ${item.colors.solid};"></div>
        <div class="layer-info">
            <div class="layer-label">${scheme.icon} ${scheme.label}</div>
            <div class="layer-subtitle">${item.minutes} min ${isOutline ? '(contorno)' : ''}</div>
        </div>
    `;
    list.appendChild(layerItem);
}

function toggleLayerVisibility(mode, minutes, isOutline = false) {
    const item = state.isochroneLayers.find(
        l => l.mode === mode && l.minutes === minutes && l.isOutline === isOutline
    );
    
    if (item) {
        item.visible = !item.visible;
        if (item.visible) {
            state.map.addLayer(item.layer);
        } else {
            state.map.removeLayer(item.layer);
        }
        updateLayersPanel();
    }
}

function toggleAllLayers() {
    state.allLayersVisible = !state.allLayersVisible;
    
    state.isochroneLayers.forEach(item => {
        item.visible = state.allLayersVisible;
        if (item.visible) {
            state.map.addLayer(item.layer);
        } else {
            state.map.removeLayer(item.layer);
        }
    });
    
    updateLayersPanel();
}

// Hacer disponibles globalmente
window.toggleLayerVisibility = toggleLayerVisibility;

// ===== Funciones de DEBUG =====
function toggleDebugVisibility() {
    const showCircles = document.getElementById('debug-mode').checked;
    const showHullOnly = document.getElementById('show-hull-only').checked;
    
    console.log('Toggle debug:', { showCircles, showHullOnly });
    
    // Primero limpiar todo
    hideDebugInfo();
    
    state.isochroneLayers.forEach(item => {
        if (!item.visible) return;
        
        if (showHullOnly) {
            // Modo normal: mostrar solo la envolvente
            state.map.addLayer(item.layer);
        } else {
            // Mostrar envolvente + círculos
            state.map.addLayer(item.layer);
            if (item.debugInfo) {
                drawDebugCircles(item.debugInfo, item.mode);
                if (item.debugInfo.max_walk_distance) {
                    drawInitialWalkCircle(item.debugInfo);
                }
            }
        }
    });
    
    // Si modo debug activado, ocultar envolvente y mostrar solo círculos
    if (showCircles) {
        state.isochroneLayers.forEach(item => {
            if (item.visible) state.map.removeLayer(item.layer);
        });
        state.isochroneLayers.forEach(item => {
            if (item.visible && item.debugInfo) {
                drawDebugCircles(item.debugInfo, item.mode);
                if (item.debugInfo.max_walk_distance) {
                    drawInitialWalkCircle(item.debugInfo);
                }
            }
        });
    }
}

function hideDebugInfo() {
    state.debugLayers.forEach(layer => state.map.removeLayer(layer));
    state.debugLayers = [];
}

function drawDebugCircles(debugInfo) {
    console.log('Dibujando círculos de debug:', debugInfo);
    
    if (!debugInfo || !debugInfo.routes_used) {
        console.log('No hay routes_used en debugInfo');
        return;
    }
    
    console.log('Rutas encontradas:', debugInfo.routes_used.length);
    
    debugInfo.routes_used.forEach((route, routeIndex) => {
        console.log(`Ruta ${routeIndex}: ${route.name}, paradas: ${route.stops_reached ? route.stops_reached.length : 0}`);
        
        if (!route.stops_reached) return;
        
        route.stops_reached.forEach((stop, stopIndex) => {
            console.log(`  Parada ${stopIndex}: ${stop.name}, radio: ${stop.walk_radius_meters}m`);
            
            // Círculo de caminata
            const circle = L.circle([stop.lat, stop.lon], {
                radius: stop.walk_radius_meters,
                color: '#ff0000',
                weight: 2,
                opacity: 0.9,
                fillColor: '#ff0000',
                fillOpacity: 0.05,
                dashArray: '5, 5'
            }).addTo(state.map);
            
            circle.bindTooltip(
                `<strong>${stop.name}</strong><br>` +
                `Tiempo: ${stop.time_spent}min usado, ${stop.time_remaining}min restante<br>` +
                `Caminable: ${Math.round(stop.walk_radius_meters)}m`,
                { permanent: false, direction: 'top' }
            );
            
            state.debugLayers.push(circle);
            
            // Marker en la parada
            const marker = L.circleMarker([stop.lat, stop.lon], {
                radius: 5,
                color: '#ff0000',
                fillColor: '#ffffff',
                fillOpacity: 1,
                weight: 2
            }).addTo(state.map);
            
            marker.bindTooltip(`<strong>${stop.name}</strong>`);
            state.debugLayers.push(marker);
        });
    });
}

// ===== Bloqueo y reset de interfaz =====
function lockInterface() {
    // Mostrar botón de reset y ocultar el de generar
    document.getElementById('generate-btn').style.display = 'none';
    document.getElementById('reset-btn').style.display = 'block';
    
    // Deshabilitar inputs de dirección
    document.getElementById('address').disabled = true;
    document.getElementById('search-btn').disabled = true;
    
    // Agregar clase al mapa para indicar bloqueo
    document.getElementById('map').classList.add('map-locked');
    
    // Ocultar mensaje de bloqueo si estaba visible
    document.getElementById('block-message').style.display = 'none';
}

function unlockInterface() {
    // Mostrar botón de generar y ocultar el de reset
    document.getElementById('generate-btn').style.display = 'block';
    document.getElementById('reset-btn').style.display = 'none';
    
    // Habilitar inputs de dirección
    document.getElementById('address').disabled = false;
    document.getElementById('search-btn').disabled = false;
    
    // Quitar clase de bloqueo del mapa
    document.getElementById('map').classList.remove('map-locked');
    
    // Ocultar mensaje de bloqueo
    document.getElementById('block-message').style.display = 'none';
}

function resetCalculation() {
    // Limpiar isócronas
    clearIsochrones();
    
    // Limpiar rutas
    clearRoutes();
    
    // Ocultar panel de capas
    document.getElementById('layers-panel').style.display = 'none';
    
    // Limpiar marcador de trabajo
    if (state.workMarker) {
        state.map.removeLayer(state.workMarker);
        state.workMarker = null;
    }
    
    // Resetear estado
    state.selectedLocation = null;
    state.hasResults = false;
    state.isochroneLayers = [];
    
    // Limpiar input de dirección
    document.getElementById('address').value = '';
    document.getElementById('geocode-results').innerHTML = '';
    
    // Desbloquear interfaz
    unlockInterface();
    updateGenerateButton();
    
    // Recentrar mapa en CABA
    state.map.setView(CONFIG.cabaCenter, CONFIG.defaultZoom);
    
    showStatus('🔄 Listo para un nuevo cálculo', 'success');
}

// Obtener color HSL para un modo y tiempo específico
// Cada modo tiene su propio hue, y el tiempo varía la luminosidad DRAMÁTICAMENTE
function getColorForModeAndTime(mode, minutes, alpha = 1) {
    const scheme = CONFIG.modeColorSchemes[mode];
    if (!scheme) return '#999999';
    
    // Normalizar tiempo entre 0 y 1 (5-120 minutos)
    const minTime = 5;
    const maxTime = 120;
    const normalizedTime = Math.min(1, Math.max(0, (minutes - minTime) / (maxTime - minTime)));
    
    // CURVA NO LINEAL para hacer el degradé más pronunciado en tiempos cortos
    // Usamos una curva exponencial para que la diferencia sea más marcada
    const curveFactor = Math.pow(normalizedTime, 0.6); // < 1 hace que cambie más rápido al principio
    
    // Calcular luminosidad: tiempos cortos = CASI BLANCO, tiempos largos = INTENSO
    const lightness = CONFIG.timeColorConfig.maxLightness + 
                     (CONFIG.timeColorConfig.minLightness - CONFIG.timeColorConfig.maxLightness) * curveFactor;
    
    // Calcular opacidad de relleno: tiempos cortos = CASI INVISIBLE, largos = MUY VISIBLE
    const fillOpacity = CONFIG.timeColorConfig.minOpacity + 
                       (CONFIG.timeColorConfig.maxOpacity - CONFIG.timeColorConfig.minOpacity) * curveFactor;
    
    // Para tiempos muy cortos, reducir también la saturación (más blanco/gris)
    const saturation = scheme.saturation * (0.3 + 0.7 * curveFactor);
    
    return {
        stroke: `hsl(${scheme.hue}, ${saturation}%, ${lightness}%)`,
        fill: `hsla(${scheme.hue}, ${saturation}%, ${lightness}%, ${fillOpacity})`,
        solid: `hsl(${scheme.hue}, ${saturation}%, ${lightness}%)`,
        hue: scheme.hue,
        lightness: lightness,
        fillOpacity: fillOpacity,
        saturation: saturation
    };
}

// Función legacy para compatibilidad
function getColorForMinutes(minutes) {
    const colors = getColorForModeAndTime('walking', minutes);
    return colors.solid;
}

// ===== Geocodificación =====
async function handleSearch() {
    // Si hay resultados, no permitir búsqueda nueva
    if (state.hasResults) {
        showStatus('⚠️ Tenés resultados cargados. Hacé clic en "Nuevo cálculo" para cambiar la ubicación.', 'error');
        document.getElementById('block-message').style.display = 'block';
        return;
    }
    
    const input = document.getElementById('address');
    const query = input.value.trim();
    const resultsContainer = document.getElementById('geocode-results');
    
    if (!query) return;
    
    showLoading(true, 'Buscando dirección...');
    
    try {
        const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
        const data = await response.json();
        
        resultsContainer.innerHTML = '';
        
        if (data.error) {
            showStatus(data.error, 'error');
            return;
        }
        
        if (!data.results || data.results.length === 0) {
            resultsContainer.innerHTML = '<div class="result-item">No se encontraron resultados</div>';
            return;
        }
        
        // Mostrar resultados
        data.results.forEach((result, index) => {
            const div = document.createElement('div');
            div.className = 'result-item';
            div.innerHTML = `<strong>${result.display_name.split(',')[0]}</strong><br>
                           <small style="color: #6b7280;">${result.display_name}</small>`;
            div.addEventListener('click', () => selectLocation(result, div));
            resultsContainer.appendChild(div);
        });
        
    } catch (error) {
        showStatus('Error al buscar dirección', 'error');
        console.error(error);
    } finally {
        showLoading(false);
    }
}

function selectLocation(location, element) {
    // Si hay resultados, no permitir cambiar ubicación
    if (state.hasResults) {
        showStatus('⚠️ Tenés resultados cargados. Hacé clic en "Nuevo cálculo" para cambiar la ubicación.', 'error');
        document.getElementById('block-message').style.display = 'block';
        return;
    }
    
    // Marcar como seleccionado
    document.querySelectorAll('.result-item').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
    
    // Guardar ubicación
    state.selectedLocation = {
        lat: location.lat,
        lng: location.lon
    };
    
    // Actualizar input
    document.getElementById('address').value = location.display_name.split(',')[0];
    
    // Colocar marcador
    placeWorkMarker(location.lat, location.lon);
    
    // Habilitar botón de generar
    updateGenerateButton();
    
    // Limpiar resultados después de un momento
    setTimeout(() => {
        document.getElementById('geocode-results').innerHTML = '';
    }, 300);
}

function placeWorkMarker(lat, lng) {
    // Remover marcador anterior
    if (state.workMarker) {
        state.map.removeLayer(state.workMarker);
    }
    
    // Crear icono personalizado
    const workIcon = L.divIcon({
        className: 'custom-marker',
        html: `
            <div style="
                background: #2563eb;
                width: 36px;
                height: 36px;
                border-radius: 50%;
                border: 3px solid white;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 18px;
            ">💼</div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
    });
    
    // Agregar marcador
    state.workMarker = L.marker([lat, lng], { icon: workIcon })
        .addTo(state.map)
        .bindPopup('<strong>📍 Tu trabajo</strong>')
        .openPopup();
    
    // Centrar mapa
    state.map.setView([lat, lng], 15);
}

// ===== Generación de isócronas =====
async function generateIsochrones() {
    if (!state.selectedLocation) return;
    
    // Combinar tiempos preset y custom
    const allTimes = [...state.selectedTimes, ...state.customTimes];
    
    if (allTimes.length === 0) {
        showStatus('Selecciona al menos un tiempo', 'error');
        return;
    }
    
    // Determinar qué modos calcular según el modo de visualización
    const modesToCalculate = [];
    modesToCalculate.push({ mode: state.primaryMode, isOutline: false, label: 'Principal' });
    
    if (state.viewMode === 'compare') {
        modesToCalculate.push({ mode: state.secondaryMode, isOutline: true, label: 'Comparación' });
    }
    
    const totalCount = modesToCalculate.length * allTimes.length;
    const modeText = state.viewMode === 'single' ? state.primaryMode : `${state.primaryMode} vs ${state.secondaryMode}`;
    showLoading(true, `Calculando ${totalCount} isócronas para ${modeText}...`);
    
    try {
        // Limpiar isócronas anteriores
        clearIsochrones();
        
        // Generar isócronas
        const promises = [];
        for (const { mode, isOutline } of modesToCalculate) {
            for (const minutes of allTimes) {
                promises.push(fetchIsochrone(mode, minutes, isOutline));
            }
        }
        
        await Promise.all(promises);
        
        // Actualizar panel de capas
        updateLayersPanel();
        
        // Marcar que hay resultados y bloquear interfaz
        state.hasResults = true;
        state.activeRouteMode = state.primaryMode;  // Guardar modo para rutas
        lockInterface();
        
        // Aplicar configuración de visualización
        toggleDebugVisibility();
        
        const successMsg = state.viewMode === 'single' 
            ? `✅ Mapa de ${CONFIG.modeColorSchemes[state.primaryMode].label} generado`
            : `✅ Comparación: ${CONFIG.modeColorSchemes[state.primaryMode].label} vs ${CONFIG.modeColorSchemes[state.secondaryMode].label}`;
        showStatus(successMsg + '. Hacé clic en el mapa para ver rutas.', 'success');
        
        // Si hay transporte público en los modos seleccionados
        const hasPublicTransport = modesToCalculate.some(m => m.mode === 'public_transport');
        if (hasPublicTransport && state.showTransport) {
            highlightStationsInArea();
        }
        
    } catch (error) {
        showStatus('Error al generar isócronas', 'error');
        console.error(error);
    } finally {
        showLoading(false);
    }
}

async function fetchIsochrone(mode, minutes, isOutline = false) {
    const { lat, lng } = state.selectedLocation;
    
    try {
        const response = await fetch('/api/isochrone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                lat: lat,
                lon: lng,
                mode: mode,
                minutes: minutes
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        // Extraer debug_info - GUARDAR TODA LA DATA para debug
        console.log('Respuesta completa del servidor:', JSON.stringify(data, null, 2));
        
        let debugInfo = null;
        if (data.isochrone && data.isochrone.properties) {
            console.log('Propiedades de isochrone:', data.isochrone.properties);
            if (data.isochrone.properties.debug_info) {
                debugInfo = data.isochrone.properties.debug_info;
                console.log('✅ DEBUG INFO encontrado:', debugInfo);
            } else {
                console.log('❌ No hay debug_info en properties');
            }
        } else {
            console.log('❌ No hay isochrone o properties');
        }
        
        // Dibujar isócrona (relleno o solo contorno)
        drawIsochrone(data.isochrone, mode, minutes, isOutline, debugInfo);
        
        // Si es modo demo, mostrar badge
        if (data.demo) {
            document.getElementById('demo-badge').style.display = 'inline-block';
        }
        
    } catch (error) {
        console.error(`Error generando isócrona ${mode} ${minutes}min:`, error);
        throw error;
    }
}

function drawIsochrone(geojson, mode, minutes, isOutline = false, debugInfo = null) {
    if (!geojson || !geojson.geometry) return;
    
    // Para transporte público con debugInfo, dibujar círculos individuales
    if (mode === 'public_transport' && debugInfo && debugInfo.routes_used && !isOutline) {
        drawTransitCircles(debugInfo, minutes);
        return;
    }
    
    // Obtener colores basados en modo + tiempo
    const colors = getColorForModeAndTime(mode, minutes);
    const scheme = CONFIG.modeColorSchemes[mode];
    
    // Grosor del borde según tiempo
    const timeFactor = Math.min(1, (minutes - 5) / 55);
    const strokeWeight = isOutline ? 4 + timeFactor * 3 : scheme.weight + timeFactor * 2;
    
    // En modo comparación, hacer los estilos MÁS diferentes
    let fillOpacity, fillColor, dashArray, strokeOpacity;
    
    if (isOutline) {
        fillOpacity = 0;
        fillColor = 'transparent';
        dashArray = '12, 10';
        strokeOpacity = 1.0;
    } else {
        fillOpacity = colors.fillOpacity;
        fillColor = colors.fill;
        dashArray = scheme.dashArray;
        strokeOpacity = 0.85;
    }
    
    const layer = L.geoJSON(geojson, {
        style: {
            color: colors.stroke,
            weight: strokeWeight,
            opacity: strokeOpacity,
            fillColor: fillColor,
            fillOpacity: fillOpacity,
            dashArray: dashArray
        }
    }).addTo(state.map);
    
    // Agregar tooltip
    const tooltipText = isOutline 
        ? `${scheme.icon} ${scheme.label} - ${minutes} min (comparación)`
        : `${scheme.icon} ${scheme.label} - ${minutes} min`;
    layer.bindTooltip(tooltipText, {
        permanent: false,
        direction: 'center',
        className: 'isochrone-label'
    });
    
    // Guardar referencia
    state.isochroneLayers.push({ 
        layer, 
        mode, 
        minutes, 
        visible: true,
        isOutline,
        color: colors.solid,
        colors: colors,
        scheme: scheme,
        debugInfo: debugInfo
    });
    
    // Ajustar vista
    if (state.isochroneLayers.length === 1) {
        state.map.fitBounds(layer.getBounds(), { padding: [50, 50] });
    }
}

// Dibujar círculos individuales de transporte público
function drawTransitCircles(debugInfo, minutes) {
    const colorsByRoute = {
        'Subte Línea A': '#00a0e3',
        'Subte Línea B': '#ee3d3d', 
        'Subte Línea C': '#0071bc',
        'Subte Línea D': '#008065',
        'Subte Línea E': '#6f2390',
        'Subte Línea H': '#ffd600',
        'Tren Mitre': '#00a0e3',
        'Tren Roca': '#ee3d3d',
        'Tren Sarmiento': '#00a651',
        'Tren San Martín': '#ee3d3d'
    };
    
    const layerGroup = L.layerGroup();
    
    // Círculo inicial desde el trabajo (zona caminable a paradas)
    if (debugInfo.max_walk_distance && state.selectedLocation) {
        const initialCircle = L.circle([state.selectedLocation.lat, state.selectedLocation.lng], {
            radius: debugInfo.max_walk_distance,
            color: 'transparent',
            weight: 0,
            fillColor: '#90EE90',
            fillOpacity: 0.15
        }).bindTooltip('Zona caminable desde tu trabajo');
        
        layerGroup.addLayer(initialCircle);
    }
    
    // Círculos desde cada parada
    debugInfo.routes_used.forEach(route => {
        const routeColor = colorsByRoute[route.name] || '#666666';
        
        route.stops_reached.forEach(stop => {
            const circle = L.circle([stop.lat, stop.lon], {
                radius: stop.walk_radius_meters,
                color: 'transparent',
                weight: 0,
                fillColor: routeColor,
                fillOpacity: 0.15
            }).bindTooltip(
                `<strong>${route.name}</strong><br>` +
                `<strong>${stop.name}</strong><br>` +
                `Tiempo restante: ${stop.time_remaining} min<br>` +
                `Radio: ${Math.round(stop.walk_radius_meters)}m`
            );
            
            layerGroup.addLayer(circle);
        });
    });
    
    layerGroup.addTo(state.map);
    
    // Guardar referencia
    state.isochroneLayers.push({
        layer: layerGroup,
        mode: 'public_transport',
        minutes: minutes,
        visible: true,
        isOutline: false,
        color: '#6f2390',
        debugInfo: debugInfo
    });
    
    // Ajustar vista
    if (state.isochroneLayers.length === 1) {
        state.map.fitBounds(layerGroup.getBounds(), { padding: [50, 50] });
    }
}

function clearIsochrones() {
    state.isochroneLayers.forEach(({ layer }) => {
        state.map.removeLayer(layer);
    });
    state.isochroneLayers = [];
    
    // Limpiar también capas de debug
    hideDebugInfo();
}

// ===== Capa de transporte público =====
async function loadTransportLines() {
    try {
        const response = await fetch('/api/transport-lines');
        const data = await response.json();
        
        // Crear capas para subtes
        const subteGroup = L.layerGroup();
        data.subte.forEach(line => {
            const lineCoords = line.stations.map(s => [s.lat, s.lon]);
            
            // Dibujar línea
            L.polyline(lineCoords, {
                color: line.color,
                weight: 4,
                opacity: 0.8
            }).addTo(subteGroup);
            
            // Agregar estaciones
            line.stations.forEach(station => {
                L.circleMarker([station.lat, station.lon], {
                    radius: 6,
                    fillColor: line.color,
                    color: 'white',
                    weight: 2,
                    fillOpacity: 1
                }).bindPopup(`<strong>Línea ${line.line}</strong><br>${station.name}`)
                .addTo(subteGroup);
            });
        });
        
        // Crear capas para trenes
        const trenGroup = L.layerGroup();
        data.tren.forEach(line => {
            const lineCoords = line.stations.map(s => [s.lat, s.lon]);
            
            L.polyline(lineCoords, {
                color: line.color,
                weight: 4,
                opacity: 0.8,
                dashArray: '10, 5'
            }).addTo(trenGroup);
            
            line.stations.forEach(station => {
                L.circleMarker([station.lat, station.lon], {
                    radius: 6,
                    fillColor: line.color,
                    color: 'white',
                    weight: 2,
                    fillOpacity: 1
                }).bindPopup(`<strong>Tren ${line.line}</strong><br>${station.name}`)
                .addTo(trenGroup);
            });
        });
        
        state.transportLayers = {
            subte: subteGroup,
            tren: trenGroup
        };
        
        // Mostrar por defecto
        if (state.showTransport) {
            subteGroup.addTo(state.map);
            trenGroup.addTo(state.map);
        }
        
    } catch (error) {
        console.error('Error cargando transporte:', error);
    }
}

function toggleTransportLayer() {
    Object.values(state.transportLayers).forEach(layer => {
        if (state.showTransport) {
            layer.addTo(state.map);
        } else {
            state.map.removeLayer(layer);
        }
    });
}

function highlightStationsInArea() {
    // TODO: Implementar detección de estaciones dentro de la isócrona
    // Por ahora, mostramos todas las estaciones
}

// ===== Utilidades =====
function updateGenerateButton() {
    const btn = document.getElementById('generate-btn');
    btn.disabled = !state.selectedLocation;
}

function showLoading(show, message = '') {
    const loading = document.getElementById('loading');
    loading.style.display = show ? 'flex' : 'none';
    if (message) {
        loading.querySelector('p').textContent = message;
    }
}

function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
    
    // Auto-ocultar después de 5 segundos
    setTimeout(() => {
        status.className = 'status';
    }, 5000);
}

async function checkApiStatus() {
    try {
        const response = await fetch('/api/health');
        const data = await response.json();
        
        if (!data.api_key_configured) {
            console.log('Modo demo activo - configure ORS_API_KEY para datos reales');
        }
    } catch (error) {
        console.error('Error verificando API:', error);
    }
}

// ===== Funciones de Rutas (click en mapa después de calcular isócronas) =====

function clearRoutes() {
    // Limpia las rutas dibujadas del mapa
    state.routeLayers.forEach(layer => {
        state.map.removeLayer(layer);
    });
    state.routeLayers = [];
}

async function calculateRouteToPoint(lat, lng) {
    // Calcula y dibuja rutas desde el trabajo hasta el punto clickeado
    if (!state.selectedLocation) return;
    if (!state.hasResults) {
        showStatus('Primero calculá una isócrona', 'error');
        return;
    }
    
    // Limpiar rutas anteriores
    clearRoutes();
    
    const fromLat = state.selectedLocation.lat;
    const fromLng = state.selectedLocation.lng;
    const mode = state.activeRouteMode;
    
    showStatus('Calculando rutas...', 'success');
    
    try {
        const response = await fetch(
            `/api/route?from_lat=${fromLat}&from_lon=${fromLng}&to_lat=${lat}&to_lon=${lng}&mode=${mode}`
        );
        
        if (!response.ok) {
            const error = await response.json();
            showStatus(error.error || 'Error calculando rutas', 'error');
            return;
        }
        
        const data = await response.json();
        
        // Colores según modo
        const modeColors = {
            'walking': '#22c55e',
            'bike': '#3b82f6',
            'car': '#ef4444'
        };
        const baseColor = modeColors[mode] || '#666';
        
        // Dibujar ruta más corta (línea continua)
        if (data.shortest && data.shortest.geometry) {
            const distKm = (data.shortest.distance / 1000).toFixed(2);
            const timeMin = Math.round(data.shortest.duration / 60);
            
            const shortestLayer = L.geoJSON(data.shortest.geometry, {
                style: {
                    color: baseColor,
                    weight: 6,
                    opacity: 0.9,
                    dashArray: null,
                    lineCap: 'round',
                    lineJoin: 'round'
                }
            }).addTo(state.map);
            
            // Tooltip en hover
            shortestLayer.bindTooltip(
                `<strong>🛣️ Más corta</strong><br>${distKm} km • ${timeMin} min`,
                {
                    sticky: true,
                    direction: 'top',
                    className: 'route-tooltip',
                    opacity: 1
                }
            );
            
            // Abrir tooltip en hover
            shortestLayer.on('mouseover', function(e) {
                this.openTooltip();
            });
            shortestLayer.on('mouseout', function(e) {
                this.closeTooltip();
            });
            
            // Popup al hacer clic
            shortestLayer.bindPopup(
                `<strong>🛣️ Ruta más corta</strong><br>` +
                `📏 Distancia: ${distKm} km<br>` +
                `⏱️ Tiempo: ${timeMin} min`
            );
            
            state.routeLayers.push(shortestLayer);
        }
        
        // Dibujar ruta más rápida (línea punteada)
        if (data.fastest && data.fastest.geometry) {
            const isSameRoute = data.fastest.distance === data.shortest?.distance;
            
            if (!isSameRoute) {
                const distKm = (data.fastest.distance / 1000).toFixed(2);
                const timeMin = Math.round(data.fastest.duration / 60);
                
                const fastestLayer = L.geoJSON(data.fastest.geometry, {
                    style: {
                        color: baseColor,
                        weight: 5,
                        opacity: 0.7,
                        dashArray: '10, 10',
                        lineCap: 'round',
                        lineJoin: 'round'
                    }
                }).addTo(state.map);
                
                // Tooltip en hover
                fastestLayer.bindTooltip(
                    `<strong>⚡ Más rápida</strong><br>${distKm} km • ${timeMin} min`,
                    {
                        sticky: true,
                        direction: 'top',
                        className: 'route-tooltip',
                        opacity: 1
                    }
                );
                
                // Abrir tooltip en hover
                fastestLayer.on('mouseover', function(e) {
                    this.openTooltip();
                });
                fastestLayer.on('mouseout', function(e) {
                    this.closeTooltip();
                });
                
                // Popup al hacer clic
                fastestLayer.bindPopup(
                    `<strong>⚡ Ruta más rápida</strong><br>` +
                    `📏 Distancia: ${distKm} km<br>` +
                    `⏱️ Tiempo: ${timeMin} min`
                );
                
                state.routeLayers.push(fastestLayer);
            }
        }
        
        // Agregar marcador en el destino
        const destMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'route-destination-marker',
                html: '<div style="background: ' + baseColor + '; width: 14px; height: 14px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(state.map);
        
        destMarker.bindPopup('<strong>Destino seleccionado</strong><br>Haz clic en otro punto para calcular nueva ruta');
        state.routeLayers.push(destMarker);
        
        showStatus('✅ Rutas calculadas', 'success');
        
    } catch (error) {
        console.error('Error calculando rutas:', error);
        showStatus('Error calculando rutas', 'error');
    }
}

// Handler para click en modo rutas (después de calcular isócronas)
function onRouteMapClick(e) {
    // Solo si ya hay isócronas calculadas
    if (!state.hasResults) return;
    
    const { lat, lng } = e.latlng;
    calculateRouteToPoint(lat, lng);
}

// ===== Estilos adicionales para labels =====
const style = document.createElement('style');
style.textContent = `
    .isochrone-label {
        background: rgba(255, 255, 255, 0.9) !important;
        border: none !important;
        border-radius: 4px !important;
        padding: 4px 8px !important;
        font-weight: 600 !important;
        font-size: 12px !important;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1) !important;
    }
    .leaflet-tooltip-left:before, .leaflet-tooltip-right:before {
        display: none !important;
    }
    .route-tooltip {
        background: rgba(0, 0, 0, 0.85) !important;
        color: white !important;
        border: none !important;
        border-radius: 6px !important;
        padding: 6px 12px !important;
        font-weight: 500 !important;
        font-size: 13px !important;
        white-space: nowrap !important;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
    }
    .route-tooltip:before {
        border-top-color: rgba(0, 0, 0, 0.85) !important;
    }
`;
document.head.appendChild(style);
