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
        ,
        'subte': {
            hue: 45,  // Amarillo
            saturation: 80,
            label: 'Subte',
            dashArray: '6, 4',
            weight: 3,
            icon: '🚇'
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
    primaryMode: 'walking',
    selectedTime: 30,
    isLoading: false,
    hasResults: false,
    routeLayers: [],  // Capas de rutas dibujadas
    activeRouteMode: 'walking'  // Modo usado para calcular rutas
};

// Mapeo de líneas de colectivo: { lineaId: { polyline, markers: [L.Marker], group: L.LayerGroup } }
state.colectivoLines = {};

// Genera un color HSL para una línea según índice (retorna string CSS)
function generateLineColor(idx) {
    const hue = (idx * 47) % 360; // distribuir tonos
    const sat = 75;
    const light = 45;
    return `hsl(${hue}, ${sat}%, ${light}%)`;
}

// ===== Inicialización =====
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initEventListeners();
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
    
    // Do not limit view to CABA; allow whole world navigation
    
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
    
    // Si ya hay resultados, no permitir cambiar el marcador ni calcular rutas
    if (state.hasResults) {
        showStatus('Tenés resultados activos. Presioná "Nuevo cálculo" para cambiar la ubicación.', 'error');
        return;
    }

    // Colocar marcador (solo si no hay resultados activos)
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
        // console.log('No se pudo obtener la dirección exacta');
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

    // Botones de modo primario
    document.querySelectorAll('#transport-modes .transport-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#transport-modes .transport-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.primaryMode = btn.dataset.mode;
        });
    });

    // Slider de tiempo (único)
    const slider = document.getElementById('time-slider');
    const sliderValue = document.getElementById('time-slider-value');
    if (slider) {
        const updateSliderUI = (val) => {
            const min = parseInt(slider.min);
            const max = parseInt(slider.max);
            const pct = Math.round(((val - min) / (max - min)) * 100);
            slider.style.background = `linear-gradient(90deg, var(--primary) ${pct}%, #e5e7eb ${pct}%)`;
            state.selectedTime = val;
            if (sliderValue) sliderValue.textContent = val;
            updateGenerateButton();
        };

        // Initialize
        updateSliderUI(parseInt(slider.value));

        slider.addEventListener('input', (e) => {
            updateSliderUI(parseInt(e.target.value));
        });
    }

    // Debug toggle button (hidden until after a calculation)
    const debugBtn = document.getElementById('toggle-debug-btn');
    if (debugBtn) {
        debugBtn.addEventListener('click', () => toggleDebugVisibility());
    }

    // Botón generar
    document.getElementById('generate-btn').addEventListener('click', generateIsochrones);

    // Botón reset
    document.getElementById('reset-btn').addEventListener('click', resetCalculation);

    // Toggle todas las capas (button may be removed in minimal UI)
    const toggleAllBtn = document.getElementById('toggle-all-layers');
    if (toggleAllBtn) toggleAllBtn.addEventListener('click', toggleAllLayers);
}

// ===== Panel de capas =====
function updateLayersPanel() {
    // Layers panel hidden in minimal UI — keep function no-op and avoid DOM errors
    const panel = document.getElementById('layers-panel');
    if (!panel) return;
    panel.style.display = 'none';
    return;
    
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
    // Toggle internal debug visibility flag and redraw debug layers accordingly
    state.debugVisible = !state.debugVisible;
    const dbgBtn = document.getElementById('toggle-debug-btn');
    if (dbgBtn) dbgBtn.textContent = state.debugVisible ? '🧪 Ocultar círculos (debug)' : '🧪 Mostrar círculos (debug)';

    // Clear previous debug layers
    hideDebugInfo();

    if (state.debugVisible) {
        // Draw debug circles for each isochrone that has debugInfo
        state.isochroneLayers.forEach(item => {
            if (!item.debugInfo) return;
            drawDebugCircles(item.debugInfo);
            if (item.debugInfo.max_walk_distance) drawInitialWalkCircle(item.debugInfo);
        });
    }
}

function hideDebugInfo() {
    state.debugLayers.forEach(layer => state.map.removeLayer(layer));
    state.debugLayers = [];
}

function drawDebugCircles(debugInfo) {
    // console.log('Dibujando círculos de debug:', debugInfo);
    
    if (!debugInfo || !debugInfo.routes_used) {
        // console.log('No hay routes_used en debugInfo');
        return;
    }
    
    // console.log('Rutas encontradas:', debugInfo.routes_used.length);
    
    debugInfo.routes_used.forEach((route, routeIndex) => {
        // console.log(`Ruta ${routeIndex}: ${route.name}, paradas: ${route.stops_reached ? route.stops_reached.length : 0}`);
        
        if (!route.stops_reached) return;
        
        route.stops_reached.forEach((stop, stopIndex) => {
            // console.log(`  Parada ${stopIndex}: ${stop.name}, radio: ${stop.walk_radius_meters}m`);
            
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
    // Mostrar botón de debug
    const dbg = document.getElementById('toggle-debug-btn');
    if (dbg) {
        dbg.style.display = 'inline-block';
        dbg.textContent = '🧪 Mostrar círculos (debug)';
        state.debugVisible = false;
    }
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
    // Ocultar botón de debug
    const dbg = document.getElementById('toggle-debug-btn');
    if (dbg) dbg.style.display = 'none';
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
    
    // Recentrar mapa en centro por defecto
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
    if (state.hasResults) {
        showStatus('Hay un cálculo activo. Presioná "Nuevo cálculo" para iniciar otro.', 'error');
        return;
    }
    // Solo un tiempo seleccionado (slider)
    const minutes = state.selectedTime || 30;
    showLoading(true, `Calculando isócrona de ${minutes} min para ${state.primaryMode}...`);

    try {
        // Limpiar isócronas anteriores
        clearIsochrones();

        // Generar una sola isócrona
        await fetchIsochrone(state.primaryMode, minutes, false);

        // Actualizar panel de capas
        updateLayersPanel();

        // Marcar que hay resultados y bloquear interfaz
        state.hasResults = true;
        state.activeRouteMode = state.primaryMode;
        lockInterface();

        showStatus(`✅ Mapa de ${CONFIG.modeColorSchemes[state.primaryMode].label} generado. Presioná "Nuevo cálculo" para cambiar ubicación.`, 'success');

        // Si el modo es transporte público o Subte, resaltar estaciones en área
        if (state.primaryMode === 'public_transport' || state.primaryMode === 'subte') {
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
        // console.log('Respuesta completa del servidor:', JSON.stringify(data, null, 2));
        
        let debugInfo = null;
        if (data.isochrone && data.isochrone.properties) {
            // console.log('Propiedades de isochrone:', data.isochrone.properties);
            if (data.isochrone.properties.debug_info) {
                debugInfo = data.isochrone.properties.debug_info;
                // console.log('✅ DEBUG INFO encontrado:', debugInfo);
            } else {
                // console.log('❌ No hay debug_info en properties');
            }
        } else {
            // console.log('❌ No hay isochrone o properties');
        }
        
        // Dibujar isócrona (relleno o solo contorno)
        drawIsochrone(data.isochrone, mode, minutes, isOutline, debugInfo);
        // Si tenemos debugInfo y es transporte, resaltar paradas/recorridos usados
        if (debugInfo && (mode === 'public_transport' || mode === 'subte')) {
            highlightUsedTransit(debugInfo, mode);
        }
        
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
    
    // Para transporte público o Subte con debugInfo, dibujar círculos individuales
    if ((mode === 'public_transport' || mode === 'subte') && debugInfo && debugInfo.routes_used && !isOutline) {
        drawTransitCircles(debugInfo, minutes, mode);
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
function drawTransitCircles(debugInfo, minutes, mode = 'public_transport') {
    // Colors based on mode + minutes
    const colors = getColorForModeAndTime(mode, minutes);
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

    // Build Turf polygons (one polygon per stop buffer)
    const circlePolys = [];
    const MAX_STOP_BUFFER_M = 2000; // clamp max per-stop walk radius to 2km to avoid runaway unions
    debugInfo.routes_used.forEach(route => {
        route.stops_reached.forEach(stop => {
            if (!stop || !stop.lon || !stop.lat || !stop.walk_radius_meters) return;
            try {
                // clamp radius to avoid overly large buffers
                const radiusMeters = Math.min(stop.walk_radius_meters || 0, MAX_STOP_BUFFER_M);
                if (radiusMeters <= 0) return;
                // turf.circle center: [lon, lat], radius in kilometers
                const radiusKm = radiusMeters / 1000.0;
                const poly = turf.circle([stop.lon, stop.lat], radiusKm, {steps: 32, units: 'kilometers'});
                circlePolys.push(poly);
            } catch (e) {
                console.warn('Error creando círculo Turf para parada', stop, e);
            }
        });
    });

    // Include initial walk circle (from origin) to anchor the union and ensure origin inclusion
    if (debugInfo.max_walk_distance && state.selectedLocation) {
        try {
            const initialRadiusKm = Math.min(debugInfo.max_walk_distance, MAX_STOP_BUFFER_M) / 1000.0;
            const initialPoly = turf.circle([state.selectedLocation.lng, state.selectedLocation.lat], initialRadiusKm, {steps: 32, units: 'kilometers'});
            circlePolys.push(initialPoly);
        } catch (e) {
            console.warn('Error creando círculo inicial Turf:', e);
        }
    }

    // If no circle polygons, fallback to drawing the initial walk circle(s)
    const layerGroup = L.layerGroup();
    if ((!circlePolys || circlePolys.length === 0) && debugInfo.max_walk_distance && state.selectedLocation) {
        const initialCircle = L.circle([state.selectedLocation.lat, state.selectedLocation.lng], {
            radius: debugInfo.max_walk_distance,
            color: 'transparent',
            weight: 0,
            fillColor: colors.fill,
            fillOpacity: Math.min(0.35, colors.fillOpacity || 0.25)
        }).bindTooltip('Zona caminable desde tu trabajo');
        layerGroup.addLayer(initialCircle);
        layerGroup.addTo(state.map);
        state.isochroneLayers.push({ layer: layerGroup, mode: mode, minutes: minutes, visible: true, isOutline: false, color: colors.solid || '#6f2390', debugInfo: debugInfo });
        if (state.isochroneLayers.length === 1) state.map.fitBounds(layerGroup.getBounds(), { padding: [50, 50] });
        return;
    }

    // console.log('[DEBUG] circlePolys count:', circlePolys.length);
    // Merge polygons using Turf.js (cascaded union)
    let merged = null;
    try {
        merged = circlePolys[0];
        for (let i = 1; i < circlePolys.length; i++) {
            try {
                merged = turf.union(merged, circlePolys[i]);
            } catch (e) {
                // union can fail for some geometry edge cases; skip polygon on error
                console.warn('turf.union failed on polygon index', i, e);
            }
        }
    } catch (e) {
        console.error('Error durante unión de círculos:', e);
    }

    if (!merged) {
        // fallback: draw individual circles as before
        circlePolys.forEach(p => {
            const coords = p.geometry.coordinates[0];
            const latlng = [coords[0][1], coords[0][0]];
            const marker = L.circle(latlng, { radius: 10, color: colors.fill }).addTo(layerGroup);
        });
        layerGroup.addTo(state.map);
        state.isochroneLayers.push({ layer: layerGroup, mode: mode, minutes: minutes, visible: true, isOutline: false, color: colors.solid || '#6f2390', debugInfo: debugInfo });
        return;
    }

    // Flatten multipolygons to individual polygons
    let flattened = turf.flatten(merged);
    let candidates = [];
    if (flattened && flattened.features && flattened.features.length > 0) candidates = flattened.features;
    else candidates = [merged];

    // Choose the polygon that contains the origin point (if any)
    const originPt = turf.point([state.selectedLocation.lng, state.selectedLocation.lat]);
    let chosen = candidates.find(p => turf.booleanPointInPolygon(originPt, p));

    // If none contains origin, try buffering candidates outward incrementally
    if (!chosen) {
        const maxExpand = 200; // meters
        let expand = 25;
        while (expand <= maxExpand && !chosen) {
            for (let p of candidates) {
                const buff = turf.buffer(p, expand / 1000.0, { units: 'kilometers' });
                if (turf.booleanPointInPolygon(originPt, buff)) { chosen = buff; break; }
            }
            expand += 25;
        }
    }

    // If still none, pick the largest polygon (area)
    if (!chosen) {
        let largest = candidates[0];
        for (let i = 1; i < candidates.length; i++) {
            if (turf.area(candidates[i]) > turf.area(largest)) largest = candidates[i];
        }
        chosen = largest;
    }

    // Smooth edges: small positive buffer then negative buffer
    const smoothMeters = 15; // configurable; could expose UI control
    let smooth = turf.buffer(chosen, smoothMeters / 1000.0, { units: 'kilometers' });
    smooth = turf.buffer(smooth, -smoothMeters / 1000.0, { units: 'kilometers' });

    // If MultiPolygon after smoothing, select the piece with origin or the largest
    if (smooth.geometry && smooth.geometry.type === 'MultiPolygon') {
        const flat2 = turf.flatten(smooth);
        let selected = flat2.features.find(f => turf.booleanPointInPolygon(originPt, f));
        if (!selected) selected = flat2.features.reduce((a, b) => (turf.area(b) > turf.area(a) ? b : a));
        smooth = selected;
    }

    // Draw final unified polygon with double/styled outline and solid background
    const strokeColor = colors.stroke || colors.solid || '#6f2390';
    const fillColor = colors.fill || colors.solid || '#6f2390';

    // Base soft outline (underlay) to give a halo/double-border effect
    const baseLayer = L.geoJSON(smooth, {
        style: {
            color: strokeColor,
            weight: 10,
            opacity: 0.18,
            fillColor: fillColor,
            fillOpacity: Math.min(0.28, (colors.fillOpacity || 0.25) * 0.9)
        }
    });

    // Top dashed outline for clear edge
    const topLayer = L.geoJSON(smooth, {
        style: {
            color: strokeColor,
            weight: 3,
            opacity: 0.95,
            dashArray: '8,6',
            fillOpacity: 0 // keep fill only on baseLayer
        }
    });

    // Solid fill layer (slightly translucent) placed between base and top
    const fillLayer = L.geoJSON(smooth, {
        style: {
            color: 'transparent',
            weight: 0,
            fillColor: fillColor,
            fillOpacity: Math.min(0.42, colors.fillOpacity || 0.32)
        }
    });

    const group = L.layerGroup([baseLayer.addTo(state.map), fillLayer.addTo(state.map), topLayer.addTo(state.map)]);

    // Optionally draw debug circles if debug mode enabled
    // Optionally draw debug circles if debug toggle is active
    if (state.debugVisible) {
        circlePolys.forEach(p => {
            try {
                const coords = p.geometry.coordinates[0][0];
                const marker = L.circle([coords[1], coords[0]], { radius: 4, color: '#000', fillOpacity: 0.2 }).addTo(state.map);
                state.debugLayers.push(marker);
            } catch (e) {}
        });
    }

    state.isochroneLayers.push({ layer: group, mode: mode, minutes: minutes, visible: true, isOutline: false, color: strokeColor, debugInfo: debugInfo });
    if (state.isochroneLayers.length === 1) state.map.fitBounds(group.getBounds(), { padding: [50, 50] });
}

function clearIsochrones() {
    state.isochroneLayers.forEach(({ layer }) => {
        state.map.removeLayer(layer);
    });
    state.isochroneLayers = [];
    
    // Limpiar también capas de debug
    hideDebugInfo();
}

function clearUsedTransitHighlight() {
    if (state.usedTransitLayers) {
        try { state.map.removeLayer(state.usedTransitLayers.stops); } catch (e) {}
        try { state.map.removeLayer(state.usedTransitLayers.recorridos); } catch (e) {}
        state.usedTransitLayers = null;
    }
    // Restablecer capas base si estaban visibles
    if (state.servicesLayers) {
        const sc = document.getElementById('show-colectivos');
        if (state.servicesLayers.colectivos && sc && sc.checked) {
            state.servicesLayers.colectivos.addTo(state.map);
        }
        const scr = document.getElementById('show-colectivos-recorridos');
        if (state.servicesLayers.colectivosRecorridos && scr && scr.checked) {
            state.servicesLayers.colectivosRecorridos.addTo(state.map);
        }
    }
}

// Distancia en metros entre dos pares lat/lon
function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1*toRad) * Math.cos(lat2*toRad) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

async function highlightUsedTransit(debugInfo, mode = 'public_transport') {
    try {
        // Limpiar previo resaltado
        clearUsedTransitHighlight();

        const neon = '#00ff00';
        const stopRadius = 8;

        // Recolectar paradas usadas únicas
        const usedStops = {};
        debugInfo.routes_used.forEach(route => {
            (route.stops_reached || []).forEach(s => {
                if (!s || !s.lat || !s.lon) return;
                const key = s.stop_id || s.name || `${s.lat}_${s.lon}`;
                usedStops[key] = s;
            });
        });

        // Crear capa de paradas usadas
        const stopsLayer = L.layerGroup();
        Object.values(usedStops).forEach(s => {
            const m = L.circleMarker([s.lat, s.lon], {
                radius: stopRadius,
                fillColor: neon,
                color: '#ffffff',
                weight: 2,
                fillOpacity: 1
            }).bindPopup(`<strong>${s.name || s.stop_id || 'Parada'}</strong><br>Tiempo restante: ${s.time_remaining || s.time_remaining_min || '-'} min`);
            stopsLayer.addLayer(m);
        });

        // Crear capa de recorridos usados (detectar por proximidad a paradas)
        const recorridosLayer = L.layerGroup();

        // Volver a pedir los recorridos y buscar coincidencias por distancia
        const resp = await fetch('/api/colectivos-recorridos');
        if (resp.ok) {
            const data = await resp.json();
            const tolerancia = 50; // metros

            (data.recorridos || []).forEach(rec => {
                const pts = rec.polyline || [];
                let matches = false;
                for (let i = 0; i < pts.length && !matches; i++) {
                    const p = pts[i];
                    const lat = p[0];
                    const lon = p[1];
                    for (const key in usedStops) {
                        const s = usedStops[key];
                        const d = distanceMeters(lat, lon, s.lat, s.lon);
                        if (d <= tolerancia) { matches = true; break; }
                    }
                }

                if (matches) {
                    const line = L.polyline(rec.polyline.map(pt => [pt[0], pt[1]]), {
                        color: neon,
                        weight: 4,
                        opacity: 0.95
                    }).bindPopup(`<strong>🚌 Línea ${rec.linea}</strong><br>${rec.descripcion || ''}`);
                    recorridosLayer.addLayer(line);
                }
            });
        }

        // Ocultar capas base de colectivos si existen
        if (state.servicesLayers && state.servicesLayers.colectivos) {
            try { state.map.removeLayer(state.servicesLayers.colectivos); } catch(e){}
        }
        if (state.servicesLayers && state.servicesLayers.colectivosRecorridos) {
            try { state.map.removeLayer(state.servicesLayers.colectivosRecorridos); } catch(e){}
        }

        // Ocultar capas base de subte/tren si existen
        if (state.transportLayers && state.transportLayers.subte) {
            try { state.map.removeLayer(state.transportLayers.subte); } catch(e){}
        }
        if (state.transportLayers && state.transportLayers.tren) {
            try { state.map.removeLayer(state.transportLayers.tren); } catch(e){}
        }

        // Añadir capas resaltadas por tipo
        stopsLayer.addTo(state.map);
        recorridosLayer.addTo(state.map);

        // Además, resaltar sólo las líneas de subte/tren usadas (si aplica)
        const usedRouteNames = (debugInfo.routes_used || []).map(r => (r.name || (r.route_id ? `${r.route_id}` : ''))).filter(Boolean);
        try {
            const tlResp = await fetch('/api/transport-lines');
            if (tlResp.ok) {
                const tl = await tlResp.json();
                const transitLayer = L.layerGroup();

                // Subte
                (tl.subte || []).forEach(line => {
                    const displayName1 = `Subte Línea ${line.line}`;
                    const displayName2 = `${line.line}`;
                    const matches = usedRouteNames.some(rn => rn.includes(displayName1) || rn.includes(displayName2) || displayName1.includes(rn));
                    if (matches) {
                        const lineCoords = line.stations.map(s => [s.lat, s.lon]);
                        L.polyline(lineCoords, { color: neon, weight: 4, opacity: 0.95 }).addTo(transitLayer);
                    }
                });

                // Tren
                (tl.tren || []).forEach(line => {
                    const displayName = line.line || line.name || '';
                    const matches = usedRouteNames.some(rn => rn.includes(displayName) || displayName.includes(rn));
                    if (matches) {
                        const lineCoords = line.stations.map(s => [s.lat, s.lon]);
                        L.polyline(lineCoords, { color: neon, weight: 4, opacity: 0.95, dashArray: '6,4' }).addTo(transitLayer);
                    }
                });

                transitLayer.addTo(state.map);
                // store additionally in usedTransitLayers
                state.usedTransitLayers = { stops: stopsLayer, recorridos: recorridosLayer, transit: transitLayer };
            } else {
                state.usedTransitLayers = { stops: stopsLayer, recorridos: recorridosLayer };
            }
        } catch (e) {
            console.warn('No se pudieron cargar transport-lines para resaltar subte/tren:', e);
            state.usedTransitLayers = { stops: stopsLayer, recorridos: recorridosLayer };
        }

    } catch (e) {
        console.error('Error resaltando transporte usado:', e);
    }
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
        
        // Añadir subte si el checkbox está marcado
        const subteCheckbox = document.getElementById('show-subte');
        if (subteCheckbox && subteCheckbox.checked) {
            subteGroup.addTo(state.map);
        }
        
    } catch (error) {
        console.error('Error cargando transporte:', error);
    }
}

// (toggleTransportLayer removed - subte is controlled via its checkbox)

function highlightStationsInArea() {
    // TODO: Implementar detección de estaciones dentro de la isócrona
    // Por ahora, mostramos todas las estaciones
}

// ===== Capas de servicios y seguridad =====

async function loadServicesLayers() {
    // Carga hospitales, comisarías, barrios populares y colectivos
    
    // Crear grupos de capas
    state.servicesLayers = {
        hospitales: L.layerGroup(),
        comisarias: L.layerGroup(),
        barrios: L.layerGroup(),
        colectivos: L.layerGroup(),
        colectivosRecorridos: L.layerGroup()
    };
    
    // Cargar hospitales
    try {
        const response = await fetch('/api/hospitales');
        const data = await response.json();
        
        data.hospitales.forEach(h => {
            const marker = L.circleMarker([h.lat, h.lon], {
                radius: 8,
                fillColor: '#e11d48',  // Rojo médico
                color: '#fff',
                weight: 2,
                fillOpacity: 0.9
            }).bindPopup(
                `<strong>🏥 ${h.name}</strong><br>` +
                `<em>${h.type}</em><br>` +
                `${h.specialty ? h.specialty + '<br>' : ''}` +
                `📍 ${h.address}, ${h.neighborhood}<br>` +
                `${h.phone ? '📞 ' + h.phone + '<br>' : ''}` +
                `${h.web ? '🌐 <a href="http://' + h.web.replace(/^https?:\/\//, '') + '" target="_blank">Web</a>' : ''}`
            );
            state.servicesLayers.hospitales.addLayer(marker);
        });
        
        // console.log(`[SERVICES] Cargados ${data.count} hospitales`);
    } catch (e) {
        console.error('Error cargando hospitales:', e);
    }
    
    // Cargar comisarías
    try {
        const response = await fetch('/api/comisarias');
        const data = await response.json();
        
        data.comisarias.forEach(c => {
            const marker = L.circleMarker([c.lat, c.lon], {
                radius: 7,
                fillColor: '#2563eb',  // Azul policía
                color: '#fff',
                weight: 2,
                fillOpacity: 0.9
            }).bindPopup(
                `<strong>👮 ${c.name}</strong><br>` +
                `📍 ${c.address}, ${c.neighborhood}<br>` +
                `${c.phone ? '📞 ' + c.phone : ''}`
            );
            state.servicesLayers.comisarias.addLayer(marker);
        });
        
        // console.log(`[SERVICES] Cargadas ${data.count} comisarías`);
    } catch (e) {
        console.error('Error cargando comisarías:', e);
    }
    
    // Cargar barrios populares (polígonos)
    try {
        const response = await fetch('/api/barrios-populares');
        const data = await response.json();
        
        data.barrios.forEach(b => {
            const polygon = L.polygon(b.polygon, {
                color: '#b91c1c',
                weight: 2,
                fillColor: '#fca5a5',
                fillOpacity: 0.35
            }).bindPopup(
                `<strong>⚠️ ${b.name}</strong><br>` +
                `<em>${b.type}</em><br>` +
                `<small>Zona de precaución</small>`
            );
            state.servicesLayers.barrios.addLayer(polygon);
        });
        
        // console.log(`[SERVICES] Cargados ${data.count} barrios populares`);
    } catch (e) {
        console.error('Error cargando barrios populares:', e);
    }
    
    // Cargar colectivos (paradas)
    try {
        const response = await fetch('/api/colectivos');
        const data = await response.json();
        
        data.paradas.forEach(p => {
            const marker = L.circleMarker([p.lat, p.lon], {
                radius: 4,
                fillColor: '#16a34a',  // Verde colectivo
                color: '#fff',
                weight: 1,
                fillOpacity: 0.7
            }).bindPopup(`<strong>🚌 ${p.name}</strong>`);
            state.servicesLayers.colectivos.addLayer(marker);
        });
        
        // console.log(`[SERVICES] Cargadas ${data.count} paradas de colectivo`);
    } catch (e) {
        console.error('Error cargando colectivos:', e);
    }
    
    // Cargar recorridos de colectivos
    try {
        const response = await fetch('/api/colectivos-recorridos');
        const data = await response.json();
        
        // Dibujar recorridos con color único por línea y marcadores por parada (si vienen en la API)
        data.recorridos.forEach((rec, idx) => {
            const color = generateLineColor(idx);
            const lineKey = rec.linea || `line_${idx}`;

            const lineGroup = L.layerGroup();

            const polyline = L.polyline(rec.polyline, {
                color: color,
                weight: 3,
                opacity: 0.9
            }).bindPopup(
                `<strong>🚌 Línea ${rec.linea}</strong><br>` +
                `<small>${rec.descripcion}</small>`
            );

            polyline.bindTooltip(`Línea ${rec.linea}`, { sticky: true, direction: 'top', className: 'route-tooltip', opacity: 1 });

            // Mantener estilos originales para revertir
            const origStyle = { color: color, weight: 3, opacity: 0.9 };

            // Array para guardar marcadores de esta línea
            const markers = [];

            // Si la API incluye paradas/estaciones para la línea, usarlas
            const stops = rec.stops || rec.stations || rec.paradas || [];
            if (stops && stops.length > 0) {
                stops.forEach(s => {
                    const lat = s.lat || s.latitude || s[0];
                    const lon = s.lon || s.longitude || s[1];
                    if (lat == null || lon == null) return;
                    const marker = L.circleMarker([lat, lon], {
                        radius: 5,
                        fillColor: color,
                        color: '#ffffff',
                        weight: 2,
                        fillOpacity: 1
                    }).bindPopup(`<strong>🚌 ${rec.linea} - ${s.name || s.nombre || ''}</strong>`);

                    // Hover en parada resalta la línea
                    marker.on('mouseover', () => highlightColectivoLine(lineKey, true));
                    marker.on('mouseout', () => highlightColectivoLine(lineKey, false));

                    markers.push(marker);
                    lineGroup.addLayer(marker);
                });
            }

            // Hover en polyline resalta la línea y sus paradas
            polyline.on('mouseover', function() { highlightColectivoLine(lineKey, true); this.bringToFront(); });
            polyline.on('mouseout', function() { highlightColectivoLine(lineKey, false); });

            lineGroup.addLayer(polyline);

            // Guardar referencia en el estado
            state.colectivoLines[lineKey] = {
                polyline: polyline,
                markers: markers,
                group: lineGroup,
                origStyle: origStyle
            };

            // Añadir al grupo general de recorridos
            state.servicesLayers.colectivosRecorridos.addLayer(lineGroup);
        });
        
        // console.log(`[SERVICES] Cargados ${data.count} recorridos de colectivo`);
    } catch (e) {
        console.error('Error cargando recorridos de colectivos:', e);
    }
}

function toggleServicesLayer(type, show) {
    // Muestra u oculta una capa de servicios
    if (!state.servicesLayers || !state.servicesLayers[type]) return;
    
    if (show) {
        state.servicesLayers[type].addTo(state.map);
    } else {
        state.map.removeLayer(state.servicesLayers[type]);
    }
}

function highlightColectivoLine(lineKey, on) {
    const info = state.colectivoLines[lineKey];
    if (!info) return;

    if (on) {
        try {
            info.polyline.setStyle({ weight: 6, opacity: 1 });
        } catch (e) {}
        info.markers.forEach(m => {
            try { m.setStyle({ radius: 8, weight: 3 }); } catch (e) {}
        });
    } else {
        try {
            info.polyline.setStyle({ weight: info.origStyle.weight, opacity: info.origStyle.opacity });
        } catch (e) {}
        info.markers.forEach(m => {
            try { m.setStyle({ radius: 5, weight: 2 }); } catch (e) {}
        });
    }
}

// ===== Utilidades =====
function updateGenerateButton() {
    const btn = document.getElementById('generate-btn');
    btn.disabled = !state.selectedLocation || state.hasResults;
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
            // console.log('Modo demo activo - configure ORS_API_KEY para datos reales');
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
