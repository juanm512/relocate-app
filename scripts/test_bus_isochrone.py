from app import generate_bus_isochrone
iso = generate_bus_isochrone(-34.797232, -58.232208, 30)
props = iso.get('properties', {})
print('properties keys:', list(props.keys()))
debug = props.get('debug_info', {})
print('routes_used:', len(debug.get('routes_used', [])))
