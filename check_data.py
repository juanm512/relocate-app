import app

# Ver hospitales
hospitales = app.load_hospitales()
print('=== HOSPITALES ===')
for h in hospitales[:5]:
    print(f"{h['name']}: lat={h['lat']:.4f}, lon={h['lon']:.4f}")

# Ver barrios
barrios = app.load_barrios_populares()
print('\n=== BARRIOS ===')
print(f'Cargados: {len(barrios)}')
if barrios:
    b = barrios[0]
    print(f"Primer barrio: {b['name']}")
    print(f"Primer punto del polígono: {b['polygon'][0]}")

# Ver colectivos
colectivos = app.load_colectivos_caba()
print('\n=== COLECTIVOS ===')
print(f'Cargados: {len(colectivos)}')
for c in colectivos[:5]:
    print(f"{c['name']}: lat={c['lat']:.4f}, lon={c['lon']:.4f}")
