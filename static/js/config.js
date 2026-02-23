export const CONFIG = {
    cabaCenter: [-34.6037, -58.3816],
    defaultZoom: 13,
    
    // Cada modo tiene su propia gama de colores (hue base)
    modeColorSchemes: {
        'walking': {
            hue: 142,      // Verde (#22c55e)
            saturation: 80,
            weight: 3,     // stroke
            icon: '🚶'
        },
        'bike': {
            hue: 200,      // Celeste (#38bdf8)
            saturation: 90,
            weight: 3,
            icon: '🚲'
        },
        'car': {
            hue: 24,       // Naranja/Rojo cálido (#f97316)
            saturation: 85,
            weight: 3,
            icon: '🚗'
        },
        'public_transport': {
            hue: 280,      // Violeta (#a855f7)
            saturation: 75,
            weight: 3,
            icon: '🚌'
        },
        'subte': {
            hue: 45,       // Amarillo dorado (#eab308)
            saturation: 90,
            weight: 3,
            icon: '🚇'
        }
    },
    
    timeColorConfig: {
        minLightness: 90,  // Tiempos cortos
        maxLightness: 35,  // Tiempos largos
        minOpacity: 0.08,
        maxOpacity: 0.6
    },
    
    transportColors: {
        'A': '#00a0e3', 'B': '#ee3d3d', 'C': '#0071bc',
        'D': '#008065', 'E': '#6f2390', 'H': '#ffd600',
        'Mitre': '#00a0e3', 'Roca': '#ee3d3d',
        'San Martín': '#ee3d3d', 'Sarmiento': '#00a651'
    }
};

export function generateLineColor(index) {
    const hues = [0, 210, 120, 280, 45, 180, 320, 15, 250, 75];
    const hue = hues[index % hues.length];
    return `hsl(${hue}, 80%, 45%)`;
}
