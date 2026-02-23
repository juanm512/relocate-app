export const state = {
    map: null,
    workMarker: null,
    isochroneLayers: [],
    debugLayers: [],  // Capas de debug (círculos, markers)
    transportLayers: {}, // Colectivos y subtes (líneas y rutas)
    selectedLocation: null,
    currentMode: 'walking',
    currentMinutes: 30,
    apiStatus: {
        ok: true,
        usingMock: false
    },
    filterLayers: {
        hospitales: null,
        comisarias: null,
        zonasPeligrosas: null
    },
    routeLayers: [],  // Capas de rutas dibujadas del centro al marker
    activeRouteMode: 'walking',
    colectivoLines: {}
};
