"""
Backend Flask para el Mapa de Alcance por Trabajo (CABA)
MVP - Generador de isócronas usando OpenRouteService
"""

from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import requests
import os
from functools import lru_cache
from datetime import datetime, timedelta
from dotenv import load_dotenv
from math import cos, radians, sin, pi, sqrt, atan2

load_dotenv()

app = Flask(__name__)
CORS(app)

# Configuración
ORS_API_KEY = os.getenv('ORS_API_KEY', '')
ORS_BASE_URL = 'https://api.openrouteservice.org/v2/isochrones'
NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

# Cache simple en memoria para isócronas
isochrone_cache = {}
CACHE_DURATION = timedelta(hours=24)

# Mapeo de modos de transporte de nuestra app a OpenRouteService
TRANSPORT_MODES = {
    'walking': 'foot-walking',
    'bike': 'cycling-regular',
    'car': 'driving-car',
    'public_transport': 'foot-walking'  # MVP: usamos walking como aproximación
}

# Colores para los tiempos (hex con transparencia)
ISOCHRONE_COLORS = {
    15: '#22c55e',   # Verde
    30: '#eab308',   # Amarillo
    45: '#f97316',   # Naranja
    60: '#ef4444'    # Rojo
}


def get_cache_key(lat, lon, mode, minutes):
    """Genera una key única para cache"""
    # Redondear coordenadas para agrupar requests cercanos (aprox 100m)
    lat_rounded = round(float(lat), 3)
    lon_rounded = round(float(lon), 3)
    # Agregar 'v2' para invalidar caché anterior sin debug_info
    return f"{lat_rounded},{lon_rounded}:{mode}:{minutes}:v2"


def get_cached_isochrone(cache_key):
    """Obtiene isócrona del cache si existe y no expiró"""
    if cache_key in isochrone_cache:
        entry = isochrone_cache[cache_key]
        if datetime.now() - entry['timestamp'] < CACHE_DURATION:
            return entry['data']
        else:
            del isochrone_cache[cache_key]
    return None


def cache_isochrone(cache_key, data):
    """Guarda isócrona en cache"""
    isochrone_cache[cache_key] = {
        'data': data,
        'timestamp': datetime.now()
    }


@app.route('/')
def index():
    """Página principal"""
    return render_template('index.html')


@app.route('/api/geocode')
def geocode():
    """Geocodifica una dirección usando Nominatim"""
    query = request.args.get('q', '').strip()
    
    if not query:
        return jsonify({'error': 'Dirección requerida'}), 400
    
    # Agregar CABA si no está especificado
    if 'caba' not in query.lower() and 'buenos aires' not in query.lower():
        query += ', CABA, Argentina'
    
    try:
        response = requests.get(
            NOMINATIM_URL,
            params={
                'q': query,
                'format': 'json',
                'limit': 5,
                'countrycodes': 'ar',
                'viewbox': '-58.53,-34.53,-58.33,-34.68',  # Bbox aproximado de CABA
                'bounded': 0
            },
            headers={'User-Agent': 'RelocateApp/1.0'},
            timeout=10
        )
        response.raise_for_status()
        data = response.json()
        
        # Filtrar solo resultados dentro de CABA aproximadamente
        results = []
        for item in data:
            lat = float(item.get('lat', 0))
            lon = float(item.get('lon', 0))
            # Verificar si está dentro de CABA (coordenadas aproximadas)
            if -34.75 <= lat <= -34.52 and -58.53 <= lon <= -58.33:
                results.append({
                    'lat': lat,
                    'lon': lon,
                    'display_name': item.get('display_name', ''),
                    'type': item.get('type', '')
                })
        
        return jsonify({'results': results[:3]})
        
    except requests.RequestException as e:
        return jsonify({'error': f'Error de geocodificación: {str(e)}'}), 500


@app.route('/api/isochrone', methods=['POST'])
def get_isochrone():
    """Genera isócrona usando OpenRouteService"""
    import sys
    print('\n' + '='*50, flush=True)
    print('[API] Endpoint /api/isochrone llamado', flush=True)
    sys.stdout.flush()
    
    data = request.get_json()
    print(f'[API] Datos recibidos: lat={data.get("lat")}, lon={data.get("lon")}, mode={data.get("mode")}, minutes={data.get("minutes")}', flush=True)
    sys.stdout.flush()
    
    if not data:
        return jsonify({'error': 'Datos JSON requeridos'}), 400
    
    # Validar datos
    lat = data.get('lat')
    lon = data.get('lon')
    mode = data.get('mode', 'walking')
    minutes = data.get('minutes', 30)
    
    if lat is None or lon is None:
        return jsonify({'error': 'Latitud y longitud requeridas'}), 400
    
    if mode not in TRANSPORT_MODES:
        return jsonify({'error': f'Modo de transporte no válido: {mode}'}), 400
    
    # Validar rango de tiempo (5 a 120 minutos)
    try:
        minutes = int(minutes)
        if minutes < 5 or minutes > 120:
            return jsonify({'error': 'Tiempo debe estar entre 5 y 120 minutos'}), 400
    except (ValueError, TypeError):
        return jsonify({'error': 'Tiempo debe ser un número válido'}), 400
    
    # Verificar cache
    cache_key = get_cache_key(lat, lon, mode, minutes)
    cached = get_cached_isochrone(cache_key)
    if cached:
        print(f'[API] Cache HIT para {cache_key}', flush=True)
        # Si es transporte público y no tiene debug_info, regenerar
        if mode == 'public_transport' and 'debug_info' not in cached.get('properties', {}):
            print('[API] Cache sin debug_info, regenerando...', flush=True)
        else:
            return jsonify({'isochrone': cached, 'from_cache': True})
    
    # Para transporte público, SIEMPRE usar nuestro cálculo (la API no lo soporta)
    if mode == 'public_transport':
        print(f'[API] Modo transporte público - usando cálculo propio', flush=True)
        isochrone = generate_transit_isochrone(float(lat), float(lon), minutes)
        print(f'[API] Transporte público generado. Tiene debug_info: {"debug_info" in isochrone.get("properties", {})}', flush=True)
        return jsonify({
            'isochrone': isochrone,
            'demo': True,
            'message': 'Usando cálculo de transporte público con paradas reales'
        })
    
    # Para otros modos, usar API si está disponible
    if not ORS_API_KEY:
        print(f'[API] Generando mock isochrone para mode={mode}', flush=True)
        isochrone = generate_mock_isochrone(float(lat), float(lon), mode, minutes)
        return jsonify({
            'isochrone': isochrone,
            'demo': True,
            'message': 'Usando modo demo. Configure ORS_API_KEY para datos reales.'
        })
    
    # Llamar a OpenRouteService
    ors_mode = TRANSPORT_MODES[mode]
    seconds = minutes * 60
    
    try:
        response = requests.post(
            f"{ORS_BASE_URL}/{ors_mode}",
            headers={
                'Authorization': ORS_API_KEY,
                'Content-Type': 'application/json'
            },
            json={
                'locations': [[float(lon), float(lat)]],
                'range': [seconds],
                'range_type': 'time',
                'area_units': 'm',
                'units': 'm',
                'location_type': 'start'
            },
            timeout=30
        )
        response.raise_for_status()
        ors_data = response.json()
        
        # Extraer el polígono GeoJSON
        if 'features' in ors_data and len(ors_data['features']) > 0:
            feature = ors_data['features'][0]
            geojson = {
                'type': 'Feature',
                'properties': {
                    'mode': mode,
                    'minutes': minutes,
                    'color': ISOCHRONE_COLORS.get(minutes, '#3b82f6'),
                    'fillColor': ISOCHRONE_COLORS.get(minutes, '#3b82f6'),
                    'fillOpacity': 0.3
                },
                'geometry': feature.get('geometry', {})
            }
            
            # Guardar en cache
            cache_isochrone(cache_key, geojson)
            
            return jsonify({'isochrone': geojson, 'from_cache': False})
        else:
            return jsonify({'error': 'No se pudo generar la isócrona'}), 500
            
    except requests.RequestException as e:
        # Fallback a modo demo en caso de error de API
        return jsonify({
            'isochrone': generate_mock_isochrone(float(lat), float(lon), mode, minutes),
            'demo': True,
            'error': str(e)
        })
    except Exception as e:
        # Error general
        return jsonify({'error': f'Error interno: {str(e)}'}), 500


def get_transport_routes():
    """Retorna las rutas de transporte público con sus paradas ordenadas"""
    return {
        'subte_A': {
            'name': 'Subte Línea A',
            'color': '#00a0e3',
            'stops': [
                {'name': 'Plaza de Mayo', 'lat': -34.6088, 'lon': -58.3705},
                {'name': 'Perú', 'lat': -34.6085, 'lon': -58.3747},
                {'name': 'Piedras', 'lat': -34.6088, 'lon': -58.3791},
                {'name': 'Lima', 'lat': -34.6092, 'lon': -58.3826},
                {'name': 'Sáenz Peña', 'lat': -34.6094, 'lon': -58.3868},
                {'name': 'Congreso', 'lat': -34.6095, 'lon': -58.3917},
                {'name': 'Pasco', 'lat': -34.6096, 'lon': -58.3984},
                {'name': 'Alberti', 'lat': -34.6097, 'lon': -58.4013},
                {'name': 'Plaza Miserere', 'lat': -34.6098, 'lon': -58.4067},
                {'name': 'Loria', 'lat': -34.6106, 'lon': -58.4150},
                {'name': 'Castro Barros', 'lat': -34.6116, 'lon': -58.4216},
                {'name': 'Río de Janeiro', 'lat': -34.6129, 'lon': -58.4295},
                {'name': 'Acoyte', 'lat': -34.6182, 'lon': -58.4364},
                {'name': 'Primera Junta', 'lat': -34.6242, 'lon': -58.4412},
                {'name': 'Puán', 'lat': -34.6235, 'lon': -58.4488},
                {'name': 'Carabobo', 'lat': -34.6265, 'lon': -58.4560},
                {'name': 'San José de Flores', 'lat': -34.6281, 'lon': -58.4647},
                {'name': 'San Pedrito', 'lat': -34.6295, 'lon': -58.4697},
            ]
        },
        'subte_B': {
            'name': 'Subte Línea B',
            'color': '#ee3d3d',
            'stops': [
                {'name': 'Leandro N. Alem', 'lat': -34.6031, 'lon': -58.3701},
                {'name': 'Florida', 'lat': -34.6033, 'lon': -58.3745},
                {'name': 'Carlos Pellegrini', 'lat': -34.6037, 'lon': -58.3810},
                {'name': 'Uruguay', 'lat': -34.6042, 'lon': -58.3868},
                {'name': 'Callao', 'lat': -34.6045, 'lon': -58.3924},
                {'name': 'Pasteur', 'lat': -34.6047, 'lon': -58.3993},
                {'name': 'Pueyrredón', 'lat': -34.6046, 'lon': -58.4052},
                {'name': 'Carlos Gardel', 'lat': -34.6042, 'lon': -58.4120},
                {'name': 'Medrano', 'lat': -34.6032, 'lon': -58.4208},
                {'name': 'Ángel Gallardo', 'lat': -34.6015, 'lon': -58.4306},
                {'name': 'Malabia', 'lat': -34.5989, 'lon': -58.4383},
                {'name': 'Dorrego', 'lat': -34.5912, 'lon': -58.4479},
                {'name': 'Federico Lacroze', 'lat': -34.5870, 'lon': -58.4550},
                {'name': 'Tronador', 'lat': -34.5841, 'lon': -58.4674},
                {'name': 'De los Incas', 'lat': -34.5815, 'lon': -58.4738},
                {'name': 'Echeverría', 'lat': -34.5786, 'lon': -58.4806},
                {'name': 'Juan Manuel de Rosas', 'lat': -34.5746, 'lon': -58.4866},
            ]
        },
        'subte_C': {
            'name': 'Subte Línea C',
            'color': '#0071bc',
            'stops': [
                {'name': 'Retiro', 'lat': -34.5921, 'lon': -58.3759},
                {'name': 'General San Martín', 'lat': -34.5955, 'lon': -58.3775},
                {'name': 'Lavalle', 'lat': -34.6017, 'lon': -58.3783},
                {'name': 'Diagonal Norte', 'lat': -34.6048, 'lon': -58.3795},
                {'name': 'Avenida de Mayo', 'lat': -34.6089, 'lon': -58.3806},
                {'name': 'Moreno', 'lat': -34.6120, 'lon': -58.3814},
                {'name': 'Independencia', 'lat': -34.6181, 'lon': -58.3819},
                {'name': 'San Juan', 'lat': -34.6221, 'lon': -58.3828},
                {'name': 'Constitución', 'lat': -34.6283, 'lon': -58.3836},
            ]
        },
        'subte_D': {
            'name': 'Subte Línea D',
            'color': '#008065',
            'stops': [
                {'name': 'Catedral', 'lat': -34.6078, 'lon': -58.3739},
                {'name': '9 de Julio', 'lat': -34.6044, 'lon': -58.3805},
                {'name': 'Tribunales', 'lat': -34.6018, 'lon': -58.3846},
                {'name': 'Callao', 'lat': -34.5994, 'lon': -58.3930},
                {'name': 'Facultad de Medicina', 'lat': -34.5997, 'lon': -58.3978},
                {'name': 'Pueyrredón', 'lat': -34.5947, 'lon': -58.4050},
                {'name': 'Agüero', 'lat': -34.5916, 'lon': -58.4124},
                {'name': 'Bulnes', 'lat': -34.5885, 'lon': -58.4113},
                {'name': 'Scalabrini Ortiz', 'lat': -34.5850, 'lon': -58.4160},
                {'name': 'Plaza Italia', 'lat': -34.5813, 'lon': -58.4210},
                {'name': 'Palermo', 'lat': -34.5784, 'lon': -58.4253},
                {'name': 'Ministro Carranza', 'lat': -34.5752, 'lon': -58.4347},
                {'name': 'Olleros', 'lat': -34.5698, 'lon': -58.4385},
                {'name': 'José Hernández', 'lat': -34.5663, 'lon': -58.4497},
                {'name': 'Juramento', 'lat': -34.5623, 'lon': -58.4567},
                {'name': 'Congreso de Tucumán', 'lat': -34.5559, 'lon': -58.4643},
            ]
        },
        'subte_E': {
            'name': 'Subte Línea E',
            'color': '#6f2390',
            'stops': [
                {'name': 'Bolívar', 'lat': -34.6134, 'lon': -58.3739},
                {'name': 'Belgrano', 'lat': -34.6127, 'lon': -58.3779},
                {'name': 'Independencia', 'lat': -34.6177, 'lon': -58.3818},
                {'name': 'San José', 'lat': -34.6223, 'lon': -58.3845},
                {'name': 'Entre Ríos', 'lat': -34.6267, 'lon': -58.3915},
                {'name': 'Pichincha', 'lat': -34.6232, 'lon': -58.3980},
                {'name': 'Jujuy', 'lat': -34.6237, 'lon': -58.4031},
                {'name': 'General Urquiza', 'lat': -34.6228, 'lon': -58.4094},
                {'name': 'Boedo', 'lat': -34.6260, 'lon': -58.4152},
                {'name': 'Avenida La Plata', 'lat': -34.6275, 'lon': -58.4258},
                {'name': 'José María Moreno', 'lat': -34.6284, 'lon': -58.4334},
                {'name': 'Emilio Mitre', 'lat': -34.6295, 'lon': -58.4414},
                {'name': 'Medalla Milagrosa', 'lat': -34.6314, 'lon': -58.4483},
                {'name': 'Varela', 'lat': -34.6341, 'lon': -58.4578},
                {'name': 'Plaza de los Virreyes', 'lat': -34.6426, 'lon': -58.4619},
            ]
        },
        'subte_H': {
            'name': 'Subte Línea H',
            'color': '#ffd600',
            'stops': [
                {'name': 'Facultad de Derecho', 'lat': -34.5834, 'lon': -58.3920},
                {'name': 'Las Heras', 'lat': -34.5875, 'lon': -58.3946},
                {'name': 'Santa Fe', 'lat': -34.5945, 'lon': -58.4023},
                {'name': 'Córdoba', 'lat': -34.5994, 'lon': -58.4039},
                {'name': 'Corrientes', 'lat': -34.6043, 'lon': -58.4053},
                {'name': 'Once', 'lat': -34.6089, 'lon': -58.4067},
                {'name': 'Venezuela', 'lat': -34.6150, 'lon': -58.4045},
                {'name': 'Humberto I', 'lat': -34.6230, 'lon': -58.4025},
                {'name': 'Inclán', 'lat': -34.6292, 'lon': -58.4008},
                {'name': 'Caseros', 'lat': -34.6357, 'lon': -58.3987},
                {'name': 'Parque Patricios', 'lat': -34.6417, 'lon': -58.3965},
                {'name': 'Hospitales', 'lat': -34.6458, 'lon': -58.3919},
            ]
        },
        'tren_mitre': {
            'name': 'Tren Mitre',
            'color': '#00a0e3',
            'stops': [
                {'name': 'Retiro', 'lat': -34.5921, 'lon': -58.3759},
                {'name': '3 de Febrero', 'lat': -34.5806, 'lon': -58.3738},
            ]
        },
        'tren_roca': {
            'name': 'Tren Roca',
            'color': '#ee3d3d',
            'stops': [
                {'name': 'Constitución', 'lat': -34.6283, 'lon': -58.3836},
            ]
        },
        'tren_sarmiento': {
            'name': 'Tren Sarmiento',
            'color': '#00a651',
            'stops': [
                {'name': 'Once', 'lat': -34.6089, 'lon': -58.4067},
            ]
        },
        'tren_san_martin': {
            'name': 'Tren San Martín',
            'color': '#ee3d3d',
            'stops': [
                {'name': 'Retiro', 'lat': -34.5921, 'lon': -58.3759},
            ]
        },
    }


def generate_mock_isochrone(lat, lon, mode, minutes):
    """Genera un polígono aproximado para demo sin API (solo caminar/bici/auto)"""
    import sys
    sys.stdout.flush()
    print(f"\n[SERVER] generate_mock_isochrone: mode={mode}, minutes={minutes}", flush=True)
    
    # NOTA: public_transport ya no pasa por aquí, va directo a generate_transit_isochrone
    
    # Velocidades para otros modos
    speeds = {
        'walking': 83,       # ~5 km/h
        'bike': 250,         # ~15 km/h
        'car': 420,          # ~25 km/h
    }
    
    speed = speeds.get(mode, 83)
    radius = speed * minutes
    
    # Crear polígono circular
    points = []
    for i in range(8):
        angle = (2 * pi * i) / 8
        r = radius
        
        if mode == 'car':
            r = radius * (0.8 + 0.3 * abs(cos(angle)))
        elif mode == 'bike':
            r = radius * (0.9 + 0.1 * abs(cos(angle * 2)))
        
        point_lat = lat + (r / 111000) * cos(angle)
        point_lon = lon + (r / (111000 * abs(cos(radians(lat))))) * sin(angle)
        points.append([point_lon, point_lat])
    
    points.append(points[0])
    
    return create_geojson_feature(points, mode, minutes)


def generate_transit_isochrone(lat, lon, minutes):
    """
    Genera isócrona de transporte público realista:
    1. Círculo inicial: caminando desde origen hasta paradas (70% tiempo máx)
    2. Desde cada parada alcanzable: viajar en subte + caminar tiempo restante
    3. Unir TODO en una sola isócrona coherente
    """
    import sys
    sys.stdout.flush()
    print(f"\n[SERVER] ===== generate_transit_isochrone INICIADO =====", flush=True)
    print(f"[SERVER] lat={lat}, lon={lon}, minutes={minutes}", flush=True)
    
    # Velocidades REALISTAS
    WALK_SPEED = 80      # m/min = 4.8 km/h (caminata normal)
    SUBTE_SPEED = 500    # m/min = 30 km/h (promedio real con paradas)
    
    # Máximo 70% del tiempo para llegar a la primera parada caminando
    MAX_WALK_TO_STATION = minutes * 0.70
    MAX_WALK_DISTANCE = MAX_WALK_TO_STATION * WALK_SPEED  # metros
    
    print(f"[SERVER] Max caminata a parada: {MAX_WALK_TO_STATION}min = {MAX_WALK_DISTANCE}m", flush=True)
    
    routes = get_transport_routes()
    center_lat, center_lon = lat, lon
    
    all_reachable_points = []
    debug_info = {
        'max_walk_time': MAX_WALK_TO_STATION,
        'max_walk_distance': MAX_WALK_DISTANCE,
        'total_time': minutes,
        'walk_speed': WALK_SPEED,
        'subte_speed': SUBTE_SPEED,
        'routes_used': []
    }
    
    # 1. CÍRCULO INICIAL: zona caminable desde origen (para llegar a paradas)
    # Radio = 70% del tiempo caminando
    print(f"[SERVER] Creando círculo inicial de caminata: {MAX_WALK_DISTANCE}m", flush=True)
    for angle_deg in range(0, 360, 15):  # Cada 15 grados = 24 puntos
        angle = radians(angle_deg)
        walk_lat = center_lat + (MAX_WALK_DISTANCE / 111000) * cos(angle)
        walk_lon = center_lon + (MAX_WALK_DISTANCE / (111000 * abs(cos(radians(center_lat))))) * sin(angle)
        all_reachable_points.append([walk_lon, walk_lat])
    
    # Para cada ruta de transporte
    for route_id, route in routes.items():
        stops = route['stops']
        
        # 2. ENCONTRAR LA PARADA MÁS CERCANA AL ORIGEN
        closest_stop = None
        min_walk_distance = float('inf')
        closest_stop_index = -1
        
        for i, stop in enumerate(stops):
            lat_diff = (stop['lat'] - center_lat) * 111000
            lon_diff = (stop['lon'] - center_lon) * 111000 * abs(cos(radians(center_lat)))
            distance = sqrt(lat_diff**2 + lon_diff**2)
            
            if distance < min_walk_distance:
                min_walk_distance = distance
                closest_stop = stop
                closest_stop_index = i
        
        walk_time_to_closest = min_walk_distance / WALK_SPEED
        
        # Si está fuera del alcance caminable, saltear
        if walk_time_to_closest > MAX_WALK_TO_STATION:
            continue
        
        route_debug = {
            'name': route['name'],
            'closest_stop': closest_stop['name'],
            'walk_time_to_stop': round(walk_time_to_closest, 1),
            'stops_reached': []
        }
        
        print(f"[SERVER] Ruta {route['name']}: parada más cercana {closest_stop['name']} a {walk_time_to_closest}min", flush=True)
        
        # Tiempo restante después de subir
        time_after_boarding = minutes - walk_time_to_closest
        
        if time_after_boarding <= 0:
            continue
        
        # 3. RECORRER EL SUBTE EN AMBAS DIRECCIONES
        directions = []
        if closest_stop_index > 0:
            directions.append(-1)  # Hacia atrás
        if closest_stop_index < len(stops) - 1:
            directions.append(1)   # Hacia adelante
        
        for direction in directions:
            accumulated_distance = 0
            prev_stop = closest_stop
            idx = closest_stop_index
            
            while 0 <= idx + direction < len(stops):
                idx += direction
                current_stop = stops[idx]
                
                # Distancia entre paradas
                lat_diff = (current_stop['lat'] - prev_stop['lat']) * 111000
                lon_diff = (current_stop['lon'] - prev_stop['lon']) * 111000 * abs(cos(radians(prev_stop['lat'])))
                segment_distance = sqrt(lat_diff**2 + lon_diff**2)
                accumulated_distance += segment_distance
                
                # Tiempo de viaje en subte
                transit_time = accumulated_distance / SUBTE_SPEED
                total_time = walk_time_to_closest + transit_time
                
                # Si todavía tenemos tiempo al llegar a esta parada
                if total_time < minutes:
                    time_remaining = minutes - total_time
                    walk_radius = time_remaining * WALK_SPEED
                    
                    print(f"[SERVER]   Parada {current_stop['name']}: tiempo usado {total_time:.1f}min, restante {time_remaining:.1f}min, radio caminable {walk_radius:.0f}m", flush=True)
                    
                    # DEBUG info
                    stop_debug = {
                        'name': current_stop['name'],
                        'lat': current_stop['lat'],
                        'lon': current_stop['lon'],
                        'time_spent': round(total_time, 1),
                        'time_remaining': round(time_remaining, 1),
                        'walk_radius_meters': round(walk_radius, 0)
                    }
                    route_debug['stops_reached'].append(stop_debug)
                    
                    # CÍRCULO DE CAMINATA desde esta parada
                    for angle_deg in range(0, 360, 20):  # Cada 20 grados = 18 puntos
                        angle = radians(angle_deg)
                        walk_lat = current_stop['lat'] + (walk_radius / 111000) * cos(angle)
                        walk_lon = current_stop['lon'] + (walk_radius / (111000 * abs(cos(radians(current_stop['lat']))))) * sin(angle)
                        all_reachable_points.append([walk_lon, walk_lat])
                else:
                    # Nos pasamos del tiempo
                    break
                
                prev_stop = current_stop
        
        debug_info['routes_used'].append(route_debug)
    
    print(f"[SERVER] Total puntos generados: {len(all_reachable_points)}", flush=True)
    
    # Si no hay rutas alcanzables, solo el círculo inicial
    if len(all_reachable_points) < 24:
        print(f"[SERVER] No se encontraron rutas, usando solo caminata", flush=True)
    
    # CREAR POLÍGONO CONCAVO (hull)
    # Ordenar por ángulo desde el centro y crear polígono
    def angle_from_center(point):
        return atan2(point[1] - center_lat, point[0] - center_lon)
    
    all_reachable_points.sort(key=angle_from_center)
    
    # Cerrar el polígono
    if all_reachable_points and all_reachable_points[0] != all_reachable_points[-1]:
        all_reachable_points.append(all_reachable_points[0])
    
    print(f"[SERVER] Rutas usadas: {len(debug_info['routes_used'])}", flush=True)
    for route in debug_info['routes_used']:
        print(f"  - {route['name']}: {len(route['stops_reached'])} paradas alcanzadas")
    
    # Guardar los círculos individuales en debug_info para que el frontend los dibuje
    # La geometría principal será simple (círculo desde el trabajo)
    print(f"[SERVER] Total puntos generados: {len(all_reachable_points)}", flush=True)
    
    # Crear geometría simple: un círculo grande desde el centro
    # El frontend usará los círculos individuales del debug_info
    simple_geometry = create_circle_geometry([center_lon, center_lat], debug_info.get('max_walk_distance', 1000))
    
    return create_geojson_feature(simple_geometry, 'public_transport', minutes, debug_info)


def create_circle_geometry(center, radius_meters, num_points=32):
    """Crea un círculo simple"""
    points = []
    for i in range(num_points):
        angle = (2 * pi * i) / num_points
        lat = center[1] + (radius_meters / 111000) * cos(angle)
        lon = center[0] + (radius_meters / (111000 * abs(cos(radians(center[1]))))) * sin(angle)
        points.append([lon, lat])
    points.append(points[0])
    return points


def extract_stop_circles(debug_info, center_lat, center_lon):
    """Extrae la información de cada círculo (centro y radio)"""
    circles = []
    
    # Círculo inicial desde el trabajo
    if debug_info.get('max_walk_distance'):
        circles.append({
            'center': [center_lon, center_lat],
            'radius': debug_info['max_walk_distance'],
            'name': 'Zona inicial (trabajo)',
            'is_initial': True
        })
        print(f"[SERVER] Círculo inicial: radio {debug_info['max_walk_distance']}m", flush=True)
    
    # Círculos desde cada parada
    for route in debug_info.get('routes_used', []):
        for stop in route.get('stops_reached', []):
            circles.append({
                'center': [stop['lon'], stop['lat']],
                'radius': stop['walk_radius_meters'],
                'name': stop['name'],
                'route': route['name'],
                'is_initial': False
            })
    
    return circles


def create_all_circles_geometry(circles):
    """Crea geometría suave que abarca TODOS los círculos sin picos"""
    if not circles:
        return []
    
    # Calcular centro de masa de todos los círculos
    avg_lon = sum(c['center'][0] for c in circles) / len(circles)
    avg_lat = sum(c['center'][1] for c in circles) / len(circles)
    
    print(f"[SERVER] Centro de geometría: {avg_lat}, {avg_lon}", flush=True)
    
    # Crear envolvente radial: para cada ángulo, tomar el punto más lejano
    num_angles = 72  # Cada 5 grados
    hull_points = []
    
    for i in range(num_angles):
        angle = (2 * pi * i) / num_angles
        
        max_distance = -1
        best_point = None
        
        # Revisar todos los círculos
        for circle in circles:
            # Punto en el borde del círculo en esta dirección
            circle_lat = circle['center'][1] + (circle['radius'] / 111000) * cos(angle)
            circle_lon = circle['center'][0] + (circle['radius'] / (111000 * abs(cos(radians(circle['center'][1]))))) * sin(angle)
            
            # Distancia desde el centro global
            dx = (circle_lon - avg_lon) * 111000 * abs(cos(radians(avg_lat)))
            dy = (circle_lat - avg_lat) * 111000
            distance = sqrt(dx*dx + dy*dy)
            
            if distance > max_distance:
                max_distance = distance
                best_point = [circle_lon, circle_lat]
        
        if best_point:
            hull_points.append(best_point)
    
    # Suavizar: promediar con vecinos para quitar picos
    smoothed = []
    n = len(hull_points)
    for i in range(n):
        prev_idx = (i - 1) % n
        next_idx = (i + 1) % n
        
        # Promedio con vecinos (40% vecino anterior, 20% actual, 40% vecino siguiente)
        avg_point_lon = (hull_points[prev_idx][0] * 0.4 + 
                         hull_points[i][0] * 0.2 + 
                         hull_points[next_idx][0] * 0.4)
        avg_point_lat = (hull_points[prev_idx][1] * 0.4 + 
                         hull_points[i][1] * 0.2 + 
                         hull_points[next_idx][1] * 0.4)
        
        smoothed.append([avg_point_lon, avg_point_lat])
    
    # Cerrar el polígono
    if smoothed:
        smoothed.append(smoothed[0])
    
    print(f"[SERVER] Envolvente creada con {len(smoothed)} puntos", flush=True)
    return smoothed


def group_connected_circles(circles):
    """Agrupa círculos que están conectados (solapados o cercanos)"""
    if not circles:
        return []
    
    # Umbral de conexión: círculos se tocan si distancia < radio1 + radio2 + tolerancia
    CONNECTION_TOLERANCE = 200  # metros de tolerancia adicional
    
    # Algoritmo de Union-Find para agrupar círculos conectados
    n = len(circles)
    parent = list(range(n))
    
    def find(x):
        if parent[x] != x:
            parent[x] = find(parent[x])
        return parent[x]
    
    def union(x, y):
        px, py = find(x), find(y)
        if px != py:
            parent[px] = py
    
    # Conectar círculos que se tocan
    for i in range(n):
        for j in range(i + 1, n):
            c1, c2 = circles[i], circles[j]
            
            # Distancia entre centros
            dx = (c1['center'][0] - c2['center'][0]) * 111000 * abs(cos(radians(c1['center'][1])))
            dy = (c1['center'][1] - c2['center'][1]) * 111000
            distance = sqrt(dx*dx + dy*dy)
            
            # Si se tocan o están muy cerca, unirlos
            if distance < (c1['radius'] + c2['radius'] + CONNECTION_TOLERANCE):
                union(i, j)
    
    # Agrupar por componente conexa
    groups_dict = {}
    for i in range(n):
        root = find(i)
        if root not in groups_dict:
            groups_dict[root] = []
        groups_dict[root].append(circles[i])
    
    return list(groups_dict.values())


def create_grouped_geometry(groups, center_lat, center_lon):
    """Crea geometría: unión de círculos conectados"""
    all_points = []
    
    for group in groups:
        if len(group) == 1:
            # Círculo aislado: crear círculo completo
            circle = group[0]
            points = create_circle_points(circle['center'], circle['radius'])
            all_points.extend(points)
        else:
            # Grupo conectado: crear unión (envolvente del grupo)
            group_points = create_group_hull(group)
            all_points.extend(group_points)
    
    # Ordenar todos los puntos para crear polígono
    def angle_from_center(point):
        return atan2(point[1] - center_lat, point[0] - center_lon)
    
    if len(all_points) < 3:
        return all_points
    
    all_points.sort(key=angle_from_center)
    all_points.append(all_points[0])  # Cerrar
    
    return all_points


def create_circle_points(center, radius_meters, num_points=24):
    """Crea puntos de un círculo"""
    points = []
    for i in range(num_points):
        angle = (2 * pi * i) / num_points
        lat = center[1] + (radius_meters / 111000) * cos(angle)
        lon = center[0] + (radius_meters / (111000 * abs(cos(radians(center[1]))))) * sin(angle)
        points.append([lon, lat])
    return points


def create_group_hull(circles):
    """Crea la envolvente de un grupo de círculos conectados"""
    # Generar muchos puntos alrededor de cada círculo del grupo
    all_points = []
    for circle in circles:
        points = create_circle_points(circle['center'], circle['radius'], num_points=16)
        all_points.extend(points)
    
    # Crear envolvente convexa de estos puntos
    if len(all_points) < 3:
        return all_points
    
    # Calcular centro del grupo
    avg_lon = sum(p[0] for p in all_points) / len(all_points)
    avg_lat = sum(p[1] for p in all_points) / len(all_points)
    
    # Envolvente radial (como antes pero solo para este grupo)
    num_angles = 36
    hull_points = []
    
    for i in range(num_angles):
        angle = (2 * pi * i) / num_angles
        max_dist = 0
        farthest = None
        
        for point in all_points:
            dx = (point[0] - avg_lon) * 111000 * abs(cos(radians(avg_lat)))
            dy = (point[1] - avg_lat) * 111000
            dist = sqrt(dx*dx + dy*dy)
            point_angle = atan2(dy, dx)
            
            angle_diff = abs(point_angle - angle)
            if angle_diff > pi:
                angle_diff = 2 * pi - angle_diff
            
            if angle_diff < pi/6 and dist > max_dist:
                max_dist = dist
                farthest = point
        
        if farthest:
            hull_points.append(farthest)
    
    # Ordenar y cerrar
    def angle_from_center(point):
        return atan2(point[1] - avg_lat, point[0] - avg_lon)
    
    hull_points.sort(key=angle_from_center)
    if hull_points:
        hull_points.append(hull_points[0])
    
    return hull_points


def create_geojson_feature(points, mode, minutes, debug_info=None):
    """Crea un feature GeoJSON con info de debug opcional"""
    properties = {
        'mode': mode,
        'minutes': minutes,
        'color': ISOCHRONE_COLORS.get(minutes, '#3b82f6'),
        'fillColor': ISOCHRONE_COLORS.get(minutes, '#3b82f6'),
        'fillOpacity': 0.3,
        'demo': True
    }
    
    # Agregar debug_info si existe
    if debug_info:
        properties['debug_info'] = debug_info
    
    return {
        'type': 'Feature',
        'properties': properties,
        'geometry': {
            'type': 'Polygon',
            'coordinates': [points]
        }
    }


@app.route('/api/transport-lines')
def get_transport_lines():
    """Obtiene líneas de transporte público cercanas"""
    # Datos estáticos de subtes y trenes de CABA
    # En producción, esto vendría de una base de datos PostGIS
    
    transport_lines = {
        'subte': [
            {'line': 'A', 'color': '#00a0e3', 'stations': [
                {'name': 'Plaza de Mayo', 'lat': -34.6088, 'lon': -58.3705},
                {'name': 'Perú', 'lat': -34.6085, 'lon': -58.3747},
                {'name': 'Piedras', 'lat': -34.6088, 'lon': -58.3791},
                {'name': 'Lima', 'lat': -34.6092, 'lon': -58.3826},
                {'name': 'Sáenz Peña', 'lat': -34.6094, 'lon': -58.3868},
                {'name': 'Congreso', 'lat': -34.6095, 'lon': -58.3917},
                {'name': 'Pasco', 'lat': -34.6096, 'lon': -58.3984},
                {'name': 'Alberti', 'lat': -34.6097, 'lon': -58.4013},
                {'name': 'Plaza Miserere', 'lat': -34.6098, 'lon': -58.4067},
                {'name': 'Loria', 'lat': -34.6106, 'lon': -58.4150},
                {'name': 'Castro Barros', 'lat': -34.6116, 'lon': -58.4216},
                {'name': 'Río de Janeiro', 'lat': -34.6129, 'lon': -58.4295},
                {'name': 'Acoyte', 'lat': -34.6182, 'lon': -58.4364},
                {'name': 'Primera Junta', 'lat': -34.6242, 'lon': -58.4412},
                {'name': 'Puán', 'lat': -34.6235, 'lon': -58.4488},
                {'name': 'Carabobo', 'lat': -34.6265, 'lon': -58.4560},
                {'name': 'San José de Flores', 'lat': -34.6281, 'lon': -58.4647},
                {'name': 'San Pedrito', 'lat': -34.6295, 'lon': -58.4697}
            ]},
            {'line': 'B', 'color': '#ee3d3d', 'stations': [
                {'name': 'Leandro N. Alem', 'lat': -34.6031, 'lon': -58.3701},
                {'name': 'Florida', 'lat': -34.6033, 'lon': -58.3745},
                {'name': 'Carlos Pellegrini', 'lat': -34.6037, 'lon': -58.3810},
                {'name': 'Uruguay', 'lat': -34.6042, 'lon': -58.3868},
                {'name': 'Callao', 'lat': -34.6045, 'lon': -58.3924},
                {'name': 'Pasteur', 'lat': -34.6047, 'lon': -58.3993},
                {'name': 'Pueyrredón', 'lat': -34.6046, 'lon': -58.4052},
                {'name': 'Carlos Gardel', 'lat': -34.6042, 'lon': -58.4120},
                {'name': 'Medrano', 'lat': -34.6032, 'lon': -58.4208},
                {'name': 'Ángel Gallardo', 'lat': -34.6015, 'lon': -58.4306},
                {'name': 'Malabia', 'lat': -34.5989, 'lon': -58.4383},
                {'name': 'Dorrego', 'lat': -34.5912, 'lon': -58.4479},
                {'name': 'Federico Lacroze', 'lat': -34.5870, 'lon': -58.4550},
                {'name': 'Tronador', 'lat': -34.5841, 'lon': -58.4674},
                {'name': 'De los Incas', 'lat': -34.5815, 'lon': -58.4738},
                {'name': 'Echeverría', 'lat': -34.5786, 'lon': -58.4806},
                {'name': 'Juan Manuel de Rosas', 'lat': -34.5746, 'lon': -58.4866}
            ]},
            {'line': 'C', 'color': '#0071bc', 'stations': [
                {'name': 'Retiro', 'lat': -34.5921, 'lon': -58.3759},
                {'name': 'General San Martín', 'lat': -34.5955, 'lon': -58.3775},
                {'name': 'Lavalle', 'lat': -34.6017, 'lon': -58.3783},
                {'name': 'Diagonal Norte', 'lat': -34.6048, 'lon': -58.3795},
                {'name': 'Avenida de Mayo', 'lat': -34.6089, 'lon': -58.3806},
                {'name': 'Moreno', 'lat': -34.6120, 'lon': -58.3814},
                {'name': 'Independencia', 'lat': -34.6181, 'lon': -58.3819},
                {'name': 'San Juan', 'lat': -34.6221, 'lon': -58.3828},
                {'name': 'Constitución', 'lat': -34.6283, 'lon': -58.3836}
            ]},
            {'line': 'D', 'color': '#008065', 'stations': [
                {'name': 'Catedral', 'lat': -34.6078, 'lon': -58.3739},
                {'name': '9 de Julio', 'lat': -34.6044, 'lon': -58.3805},
                {'name': 'Tribunales', 'lat': -34.6018, 'lon': -58.3846},
                {'name': 'Callao', 'lat': -34.5994, 'lon': -58.3930},
                {'name': 'Facultad de Medicina', 'lat': -34.5997, 'lon': -58.3978},
                {'name': 'Pueyrredón', 'lat': -34.5947, 'lon': -58.4050},
                {'name': 'Agüero', 'lat': -34.5916, 'lon': -58.4124},
                {'name': 'Bulnes', 'lat': -34.5885, 'lon': -58.4113},
                {'name': 'Scalabrini Ortiz', 'lat': -34.5850, 'lon': -58.4160},
                {'name': 'Plaza Italia', 'lat': -34.5813, 'lon': -58.4210},
                {'name': 'Palermo', 'lat': -34.5784, 'lon': -58.4253},
                {'name': 'Ministro Carranza', 'lat': -34.5752, 'lon': -58.4347},
                {'name': 'Olleros', 'lat': -34.5698, 'lon': -58.4385},
                {'name': 'José Hernández', 'lat': -34.5663, 'lon': -58.4497},
                {'name': 'Juramento', 'lat': -34.5623, 'lon': -58.4567},
                {'name': 'Congreso de Tucumán', 'lat': -34.5559, 'lon': -58.4643}
            ]},
            {'line': 'E', 'color': '#6f2390', 'stations': [
                {'name': 'Bolívar', 'lat': -34.6134, 'lon': -58.3739},
                {'name': 'Belgrano', 'lat': -34.6127, 'lon': -58.3779},
                {'name': 'Independencia', 'lat': -34.6177, 'lon': -58.3818},
                {'name': 'San José', 'lat': -34.6223, 'lon': -58.3845},
                {'name': 'Entre Ríos', 'lat': -34.6267, 'lon': -58.3915},
                {'name': 'Pichincha', 'lat': -34.6232, 'lon': -58.3980},
                {'name': 'Jujuy', 'lat': -34.6237, 'lon': -58.4031},
                {'name': 'General Urquiza', 'lat': -34.6228, 'lon': -58.4094},
                {'name': 'Boedo', 'lat': -34.6260, 'lon': -58.4152},
                {'name': 'Avenida La Plata', 'lat': -34.6275, 'lon': -58.4258},
                {'name': 'José María Moreno', 'lat': -34.6284, 'lon': -58.4334},
                {'name': 'Emilio Mitre', 'lat': -34.6295, 'lon': -58.4414},
                {'name': 'Medalla Milagrosa', 'lat': -34.6314, 'lon': -58.4483},
                {'name': 'Varela', 'lat': -34.6341, 'lon': -58.4578},
                {'name': 'Plaza de los Virreyes', 'lat': -34.6426, 'lon': -58.4619}
            ]},
            {'line': 'H', 'color': '#ffd600', 'stations': [
                {'name': 'Facultad de Derecho', 'lat': -34.5834, 'lon': -58.3920},
                {'name': 'Las Heras', 'lat': -34.5875, 'lon': -58.3946},
                {'name': 'Santa Fe', 'lat': -34.5945, 'lon': -58.4023},
                {'name': 'Córdoba', 'lat': -34.5994, 'lon': -58.4039},
                {'name': 'Corrientes', 'lat': -34.6043, 'lon': -58.4053},
                {'name': 'Once', 'lat': -34.6089, 'lon': -58.4067},
                {'name': 'Venezuela', 'lat': -34.6150, 'lon': -58.4045},
                {'name': 'Humberto I', 'lat': -34.6230, 'lon': -58.4025},
                {'name': 'Inclán', 'lat': -34.6292, 'lon': -58.4008},
                {'name': 'Caseros', 'lat': -34.6357, 'lon': -58.3987},
                {'name': 'Parque Patricios', 'lat': -34.6417, 'lon': -58.3965},
                {'name': 'Hospitales', 'lat': -34.6458, 'lon': -58.3919}
            ]}
        ],
        'tren': [
            {'line': 'Mitre', 'color': '#00a0e3', 'stations': [
                {'name': 'Retiro', 'lat': -34.5921, 'lon': -58.3759},
                {'name': '3 de Febrero', 'lat': -34.5806, 'lon': -58.3738},
                {'name': 'Ministro Carranza', 'lat': -34.5752, 'lon': -58.4347}
            ]},
            {'line': 'Roca', 'color': '#ee3d3d', 'stations': [
                {'name': 'Constitución', 'lat': -34.6283, 'lon': -58.3836},
                {'name': 'La Plata', 'lat': -34.6565, 'lon': -58.3834}
            ]},
            {'line': 'San Martín', 'color': '#ee3d3d', 'stations': [
                {'name': 'Retiro', 'lat': -34.5921, 'lon': -58.3759},
                {'name': 'Lima', 'lat': -34.6092, 'lon': -58.3826}
            ]},
            {'line': 'Sarmiento', 'color': '#00a651', 'stations': [
                {'name': 'Once', 'lat': -34.6089, 'lon': -58.4067},
                {'name': 'Caballito', 'lat': -34.6221, 'lon': -58.4412}
            ]}
        ]
    }
    
    return jsonify(transport_lines)


# ===== Datos de servicios y seguridad =====

def load_hospitales():
    """Carga hospitales desde CSV con coordenadas corregidas manualmente para los principales"""
    import csv
    
    # Coordenadas manuales para hospitales principales (lat, lon)
    # Basado en Google Maps / datos abiertos BA
    COORDS_MANUALES = {
        'Dr. J. Garrahan': (-34.6285, -58.3840),  # Combate de los Pozos 1881
        'Emerg Psiquiatricas Torcuato de Alvear': (-34.5960, -58.4620),  # Warnes 2630
        'Gastroenterologia B. Udaondo': (-34.6325, -58.3845),  # Caseros 2061
        'Infecciosas F. Muñiz': (-34.6365, -58.3865),  # Uspallata 2272
        'Odontologia  J. Dueñas': (-34.6075, -58.4200),  # Muñiz 15
        'Odontologia Infantil Don Benito Quinquela Martin': (-34.6350, -58.3530),  # Pedro de Mendoza 1795
        'Oftalmologia Santa Lucia': (-34.6140, -58.3845),  # San Juan 2021
        'Quemados Dr. Arturo Umberto Illia': (-34.6220, -58.4270),  # Pedro Goyena 369
        'Rehabilitacion M. Rocca': (-34.6140, -58.5080),  # Segurola 1949
        'Rehabilitacion Respiratoria Maria Ferrer': (-34.6280, -58.3660),  # Finochietto 849
        'Salud Mental Braulio Moyano': (-34.6360, -58.3630),  # Brandsen 2570
        'Salud Mental J. Borda': (-34.6365, -58.3605),  # Ramón Carrillo 375
        'Infanto Juvenil C. Tobar Garcia': (-34.6360, -58.3600),  # Ramón Carrillo 315
        'Materno Infantil R. Sarda': (-34.6305, -58.3855),  # Esteban de Luca 2151
        'Odontologico Dr. R. Carrillo': (-34.5895, -58.4055),  # Sánchez de Bustamante 2529
        'Oftalmologico Dr. P. Lagleyze': (-34.6030, -58.4730),  # Juan B. Justo 4151
        'A. Zubizarreta': (-34.6000, -58.5120),  # Nueva York 3952
        'B. Rivadavia': (-34.5880, -58.4040),  # Las Heras 2670
        'Cecilia Grierson': (-34.6520, -58.4560),  # Fernández de la Cruz 4402
        'C. Durand': (-34.6095, -58.4375),  # Chiclana 3400
        'Dr. C. Argerich': (-34.6225, -58.3650),  # Pi y Margall 750
        'Dr. J. A. Fernandez': (-34.5885, -58.3975),  # Córdoba 3351
        'General de Agudos Dr. I. Pirovano': (-34.5850, -58.4600),  # Warnes 1240
        'J. M. Ramos Mejia': (-34.6035, -58.4100),  # General Urquiza 609
        'Pedro de Elizalde': (-34.6280, -58.3750),  # Manuel García 353
        'Santojanni': (-34.6580, -58.5150),  # Pilcomayo 950
        'T. Alvarez': (-34.6120, -58.4720),  # Olivera 1880
        'A. Posadas': (-34.6310, -58.5250),  # Mariano Castex 3150
        'C. H. Gallardo': (-34.5940, -58.4290),  # Gallardo 450
        'D. Velez Sarsfield': (-34.6250, -58.4930),  # Calderón de la Barca 1550
        'Gutierrez': (-34.5930, -58.4120),  # Gallo 1330
        'J. P. Garrahan': (-34.6285, -58.3840),  # Combate de los Pozos 1881 (mismo)
    }
    
    hospitales = []
    csv_path = os.path.join(os.path.dirname(__file__), 'data', 'hospitales.csv')
    
    if not os.path.exists(csv_path):
        return []
    
    try:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = row.get('nam', '')
                
                # Buscar coordenadas manuales
                lat, lon = None, None
                for key, coords in COORDS_MANUALES.items():
                    if key in name:
                        lat, lon = coords
                        break
                
                # Si no hay coordenadas manuales, intentar convertir del CSV
                if lat is None:
                    geom = row.get('geometry', '')
                    if 'POINT' in geom:
                        coords = geom.replace('POINT (', '').replace(')', '').split()
                        if len(coords) == 2:
                            x = float(coords[0])
                            y = float(coords[1])
                            # Conversión aproximada ajustada
                            lat = -34.62 + (y - 68000) / 111000
                            lon = -58.47 + (x - 22000) / 92000
                
                if lat and lon and -34.75 <= lat <= -34.52 and -58.53 <= lon <= -58.33:
                    hospitales.append({
                        'name': name,
                        'type': row.get('gna', ''),
                        'specialty': row.get('esp', ''),
                        'address': row.get('dir', ''),
                        'neighborhood': row.get('bar', ''),
                        'phone': row.get('tel', ''),
                        'web': row.get('web', ''),
                        'lat': lat,
                        'lon': lon
                    })
    except Exception as e:
        print(f'[DATA] Error cargando hospitales: {e}', flush=True)
    
    return hospitales


def load_comisarias():
    """Carga comisarías desde CSV"""
    comisarias = []
    csv_path = os.path.join(os.path.dirname(__file__), 'data', 'comisarias_policia.csv')
    
    if not os.path.exists(csv_path):
        return []
    
    try:
        import csv
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                geom = row.get('geometry', '')
                if 'POINT' in geom:
                    coords = geom.replace('POINT (', '').replace(')', '').split()
                    if len(coords) == 2:
                        lon = float(coords[0])
                        lat = float(coords[1])
                        
                        comisarias.append({
                            'name': row.get('nombre', ''),
                            'address': row.get('direccion', ''),
                            'neighborhood': row.get('barrio', ''),
                            'phone': row.get('telefonos', ''),
                            'lat': lat,
                            'lon': lon
                        })
    except Exception as e:
        print(f'[DATA] Error cargando comisarias: {e}', flush=True)
    
    return comisarias


def load_barrios_populares():
    """Carga barrios populares (zonas vulnerables) desde CSV"""
    barrios = []
    csv_path = os.path.join(os.path.dirname(__file__), 'data', 'barrios_populares_poligono.csv')
    
    if not os.path.exists(csv_path):
        return []
    
    try:
        import csv
        import re
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                geom = row.get('geometry', '')
                if 'POLYGON' in geom:
                    # Extraer coordenadas del polígono
                    # Formato: POLYGON ((lon lat, lon lat, ...))
                    match = re.search(r'\(\(([^)]+)\)\)', geom)
                    if match:
                        coords_str = match.group(1)
                        coords = coords_str.split(',')
                        polygon = []
                        for coord in coords:
                            parts = coord.strip().split()
                            if len(parts) == 2:
                                try:
                                    lon = float(parts[0])
                                    lat = float(parts[1])
                                    # Leaflet usa [lat, lon], no [lon, lat]
                                    polygon.append([lat, lon])
                                except ValueError:
                                    continue
                        
                        if len(polygon) >= 3:
                            barrios.append({
                                'name': row.get('nombre', ''),
                                'type': row.get('tipo', ''),
                                'polygon': polygon
                            })
    except Exception as e:
        print(f'[DATA] Error cargando barrios populares: {e}', flush=True)
    
    return barrios


def load_colectivos_caba():
    """Carga paradas de colectivos dentro de CABA desde GTFS"""
    paradas = []
    stops_path = os.path.join(os.path.dirname(__file__), 'data', 'colectivos-gtfs', 'stops.txt')
    
    if not os.path.exists(stops_path):
        return []
    
    try:
        import csv
        import random
        
        # Límites aproximados de CABA
        min_lat, max_lat = -34.75, -34.52
        min_lon, max_lon = -58.53, -58.33
        
        # Primero recolectar todas las paradas de CABA
        paradas_caba = []
        
        with open(stops_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    lat = float(row.get('stop_lat', 0))
                    lon = float(row.get('stop_lon', 0))
                    
                    # Filtrar solo paradas dentro de CABA
                    if min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
                        paradas_caba.append({
                            'name': row.get('stop_name', ''),
                            'lat': lat,
                            'lon': lon
                        })
                except:
                    continue
        
        # Limitar a 500 paradas aleatorias para no sobrecargar
        if len(paradas_caba) > 500:
            paradas = random.sample(paradas_caba, 500)
        else:
            paradas = paradas_caba
            
        print(f'[DATA] Colectivos: {len(paradas_caba)} en CABA, mostrando {len(paradas)}', flush=True)
                    
    except Exception as e:
        print(f'[DATA] Error cargando colectivos: {e}', flush=True)
    
    return paradas


@app.route('/api/hospitales')
def get_hospitales():
    """Retorna lista de hospitales en CABA"""
    hospitales = load_hospitales()
    return jsonify({'count': len(hospitales), 'hospitales': hospitales})


@app.route('/api/comisarias')
def get_comisarias():
    """Retorna lista de comisarías en CABA"""
    comisarias = load_comisarias()
    return jsonify({'count': len(comisarias), 'comisarias': comisarias})


@app.route('/api/barrios-populares')
def get_barrios_populares():
    """Retorna polígonos de barrios populares/asentamientos"""
    barrios = load_barrios_populares()
    return jsonify({'count': len(barrios), 'barrios': barrios})


@app.route('/api/colectivos')
def get_colectivos():
    """Retorna paradas de colectivos dentro de CABA"""
    paradas = load_colectivos_caba()
    return jsonify({
        'count': len(paradas), 
        'paradas': paradas,
        'note': 'Muestra paradas filtradas dentro de CABA (máx 500)'
    })


@app.route('/api/health')
def health_check():
    """Endpoint de salud"""
    return jsonify({
        'status': 'ok',
        'api_key_configured': bool(ORS_API_KEY),
        'cache_entries': len(isochrone_cache)
    })


# URL base para direcciones (rutas)
ORS_DIRECTIONS_URL = 'https://api.openrouteservice.org/v2/directions'

@app.route('/api/route')
def get_route():
    """
    Calcula rutas desde origen hasta destino.
    Retorna ruta rápida (fastest) y ruta más corta (shortest).
    """
    # Parámetros requeridos
    from_lat = request.args.get('from_lat')
    from_lon = request.args.get('from_lon')
    to_lat = request.args.get('to_lat')
    to_lon = request.args.get('to_lon')
    mode = request.args.get('mode', 'car')
    
    # Validación
    if not all([from_lat, from_lon, to_lat, to_lon]):
        return jsonify({'error': 'Faltan parámetros: from_lat, from_lon, to_lat, to_lon'}), 400
    
    if mode not in TRANSPORT_MODES:
        return jsonify({'error': f'Modo no válido. Use: {list(TRANSPORT_MODES.keys())}'}), 400
    
    if not ORS_API_KEY:
        return jsonify({'error': 'API key no configurada'}), 503
    
    ors_mode = TRANSPORT_MODES[mode]
    
    # Coordenadas [lon, lat] para ORS
    from_coord = [float(from_lon), float(from_lat)]
    to_coord = [float(to_lon), float(to_lat)]
    
    def fetch_route(preference):
        """Llama a ORS Directions API"""
        try:
            response = requests.post(
                f"{ORS_DIRECTIONS_URL}/{ors_mode}/geojson",
                headers={
                    'Authorization': ORS_API_KEY,
                    'Content-Type': 'application/json'
                },
                json={
                    'coordinates': [from_coord, to_coord],
                    'preference': preference,
                    'units': 'm',
                    'geometry': True
                },
                timeout=30
            )
            response.raise_for_status()
            data = response.json()
            
            if 'features' in data and len(data['features']) > 0:
                feature = data['features'][0]
                props = feature.get('properties', {})
                segments = props.get('segments', [{}])[0]
                
                return {
                    'geometry': feature.get('geometry'),
                    'distance': segments.get('distance', 0),  # metros
                    'duration': segments.get('duration', 0),  # segundos
                    'success': True
                }
        except Exception as e:
            print(f'[ROUTE] Error en preference={preference}: {e}', flush=True)
        
        return {'success': False}
    
    # Obtener ambas rutas
    fastest = fetch_route('fastest')  # Menor tiempo
    shortest = fetch_route('shortest')  # Menor distancia
    
    result = {
        'from': {'lat': float(from_lat), 'lon': float(from_lon)},
        'to': {'lat': float(to_lat), 'lon': float(to_lon)},
        'mode': mode,
        'fastest': fastest if fastest['success'] else None,
        'shortest': shortest if shortest['success'] else None
    }
    
    if not fastest['success'] and not shortest['success']:
        return jsonify({'error': 'No se pudieron calcular las rutas'}), 500
    
    return jsonify(result)


if __name__ == '__main__':
    app.run(debug=True, port=5000)
