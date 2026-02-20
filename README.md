# 🗺️ Relocate - Mapa de Alcance CABA

Herramienta visual que permite ver hasta dónde se puede vivir razonablemente según el lugar de trabajo y el medio de transporte elegido.

![MVP Relocate](https://img.shields.io/badge/version-MVP-blue)
![Python](https://img.shields.io/badge/python-3.8+-green)
![Flask](https://img.shields.io/badge/flask-3.0+-orange)

## ✨ Funcionalidades

- 🖱️ **Selección por clic en mapa** - Hacé clic directamente en el mapa para seleccionar ubicación
- 🔍 **Búsqueda por dirección** - Geocodificación de direcciones en CABA
- 🚗 **Múltiples medios de transporte**: Caminar, Bicicleta, Auto, Transporte Público
- ⏱️ **Tiempos configurables**: 15, 30, 45, 60 minutos
- 🎯 **Isócronas visuales** - Áreas alcanzables con colores diferenciados
- 🚇 **Transporte público** - Visualización de subtes y trenes
- 🔁 **Anillos concéntricos** - Comparar múltiples tiempos simultáneamente

## 🚀 Instalación Rápida

### 1. Clonar y entrar al directorio

```bash
cd relocate-app
```

### 2. Crear entorno virtual (recomendado)

```bash
python -m venv venv

# Windows:
venv\Scripts\activate

# macOS/Linux:
source venv/bin/activate
```

### 3. Instalar dependencias

```bash
pip install -r requirements.txt
```

### 4. Configurar API Key (opcional para demo)

Para obtener isócronas reales, necesitas una API key gratuita de OpenRouteService:

1. Regístrate en: https://openrouteservice.org/dev/
2. Copia el archivo de ejemplo:
   ```bash
   cp .env.example .env
   ```
3. Edita `.env` y agrega tu API key:
   ```
   ORS_API_KEY=tu_api_key_aqui
   ```

> 💡 **Sin API key**, la app funciona en **modo demo** generando polígonos aproximados.

### 5. Ejecutar

```bash
python app.py
```

La aplicación estará disponible en: **http://localhost:5000**

## 📖 Uso

### 🖱️ Opción 1: Hacer clic en el mapa (Más rápido)
1. **Hacé clic directamente en el mapa** en la ubicación de tu trabajo
2. El sistema detectará la dirección automáticamente
3. **Selecciona el medio de transporte** (caminar, bici, auto, público)
4. **Elige el tiempo máximo** de viaje deseado
5. Haz clic en **"Generar mapa de alcance"**

### 🔍 Opción 2: Buscar por dirección
1. **Ingresa la dirección de tu trabajo** en el campo de búsqueda
2. Haz clic en 🔍 buscar y selecciona la dirección correcta
3. **Selecciona el medio de transporte** y tiempo
4. Haz clic en **"Generar mapa de alcance"**

### 📊 Visualiza el área donde podrías vivir

### Opciones adicionales:
- ✅ **Mostrar anillos concéntricos** - Ver todos los tiempos a la vez
- ✅ **Mostrar transporte público** - Capa de subtes y trenes

## 🏗️ Arquitectura

```
relocate-app/
├── app.py              # Backend Flask
├── requirements.txt    # Dependencias Python
├── .env.example        # Configuración de ejemplo
├── README.md           # Este archivo
├── templates/
│   └── index.html      # Frontend HTML
└── static/
    ├── css/
    │   └── style.css   # Estilos
    └── js/
        └── map.js      # Lógica del mapa (Leaflet)
```

## 🔌 APIs Utilizadas

| Servicio | Uso | URL |
|----------|-----|-----|
| OpenRouteService | Isócronas (requiere API key) | https://openrouteservice.org/ |
| Nominatim | Geocodificación de direcciones | https://nominatim.org/ |
| OpenStreetMap | Mapa base y datos de transporte | https://www.openstreetmap.org/ |

## 🎯 Alcance del MVP

### ✅ Incluye
- Solo CABA
- Punto origen único (trabajo)
- Medios: Caminar, Bici, Auto, Transporte público
- Tiempos: 15/30/45/60 minutos
- Visualización interactiva con Leaflet

### ❌ No incluye (futuras versiones)
- Ranking de barrios
- Score de accesibilidad
- Datos demográficos
- GBA (Gran Buenos Aires)
- Escuelas/Seguridad
- Integración inmobiliaria
- Múltiples puntos de trabajo

## 🛠️ Tecnologías

- **Backend**: Python 3.8+, Flask
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Mapas**: Leaflet.js + OpenStreetMap
- **APIs**: OpenRouteService, Nominatim

## 📸 Capturas de Pantalla

*Pendiente - agregar screenshots del MVP*

## 🤝 Contribuir

Este es un MVP rápido. Para contribuir:

1. Fork el proyecto
2. Crea una rama (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -am 'Agregar nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

## 📝 Licencia

MIT License - Libre para uso y modificación.

## 🙏 Agradecimientos

- OpenStreetMap contributors
- OpenRouteService
- Leaflet.js

---

**Hecho con ❤️ para facilitar decisiones de mudanza en CABA**
