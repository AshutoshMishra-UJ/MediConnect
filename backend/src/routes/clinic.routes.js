import express from 'express';
import axios from 'axios';

const router = express.Router();

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter'
];

const OVERPASS_TIMEOUT_MS = 12000;

const fetchFromOverpass = async (query) => {
  let lastError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await axios.post(endpoint, query, {
        headers: { 'Content-Type': 'text/plain' },
        timeout: OVERPASS_TIMEOUT_MS,
      });

      return response.data;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
};

// Helper function to build Overpass query
const buildOverpassQuery = (lat, lng, amenityTypes, delta = 0.05) => {
  const south = parseFloat(lat) - delta;
  const north = parseFloat(lat) + delta;
  const west = parseFloat(lng) - delta;
  const east = parseFloat(lng) + delta;

  const typeQueries = amenityTypes.map(type => `
    node["amenity"="${type}"](${south},${west},${north},${east});
    way["amenity"="${type}"](${south},${west},${north},${east});
    relation["amenity"="${type}"](${south},${west},${north},${east});
  `).join('');

  return `
    [out:json];
    (
      ${typeQueries}
    );
    out center;
  `;
};

// Helper function to process elements
const processElements = (elements, defaultName) => {
  return elements.map((e) => ({
    id: e.id,
    name: e.tags?.name || defaultName,
    lat: e.lat || e.center?.lat,
    lng: e.lon || e.center?.lon,
    address: e.tags?.['addr:full'] ||
      `${e.tags?.['addr:housenumber'] || ''} ${e.tags?.['addr:street'] || ''}`.trim() ||
      'Address not available',
    phone: e.tags?.phone || 'Phone not available',
    website: e.tags?.website || null,
    opening_hours: e.tags?.opening_hours || 'Hours not available',
    emergency: e.tags?.emergency || null,
    healthcare: e.tags?.healthcare || null,
    medical_system: e.tags?.medical_system || null,
    tags: e.tags,
  }));
};

const distanceInKm = (lat1, lng1, lat2, lng2) => {
  const earthRadiusKm = 6371;
  const toRadians = (value) => value * Math.PI / 180;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const fetchFromNominatim = async (lat, lng, radius, amenityTypes) => {
  const centerLat = parseFloat(lat);
  const centerLng = parseFloat(lng);
  const searchRadius = Math.max(parseFloat(radius) || 5, 1);
  const delta = searchRadius / 111;
  const viewbox = `${centerLng - delta},${centerLat + delta},${centerLng + delta},${centerLat - delta}`;
  const facilities = [];

  for (const amenity of amenityTypes) {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        format: 'jsonv2',
        q: amenity,
        viewbox,
        bounded: 1,
        limit: 50,
      },
      headers: { 'User-Agent': 'MediConnect-local-dev/1.0' },
      timeout: 10000,
    });

    response.data.forEach((place) => {
      const placeLat = parseFloat(place.lat);
      const placeLng = parseFloat(place.lon);
      if (!Number.isFinite(placeLat) || !Number.isFinite(placeLng)) return;
      if (distanceInKm(centerLat, centerLng, placeLat, placeLng) > searchRadius) return;

      const category = amenity === 'hospital' ? 'hospital' :
        amenity === 'pharmacy' ? 'dispensary' : 'clinic';
      facilities.push({
        id: `nominatim-${place.osm_type}-${place.osm_id}`,
        name: place.name || place.display_name?.split(',')[0] || `Unnamed ${category}`,
        lat: placeLat,
        lng: placeLng,
        address: place.display_name || 'Address not available',
        phone: 'Phone not available',
        website: null,
        opening_hours: 'Hours not available',
        emergency: null,
        type: category,
        tags: { amenity },
      });
    });
  }

  return facilities.filter((facility, index, all) =>
    all.findIndex((item) => item.id === facility.id) === index
  );
};

const categorizeFacilities = (facilities) => facilities.reduce((result, facility) => {
  const category = facility.type === 'hospital' ? 'hospitals' :
    facility.type === 'dispensary' ? 'dispensaries' : 'clinics';
  result[category].push(facility);
  return result;
}, { hospitals: [], clinics: [], dispensaries: [] });

// Get nearby medical facilities (dispensaries, clinics, hospitals)
router.get('/nearby-medical', async (req, res) => {
  const { lat, lng, radius } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  const delta = radius ? parseFloat(radius) / 111 : 0.05; // Convert km to degrees (~111km per degree)
  const query = buildOverpassQuery(lat, lng, ['clinic', 'hospital', 'doctors', 'pharmacy'], delta);

  try {
    const overpassData = await fetchFromOverpass(query);
    const elements = processElements(overpassData.elements || [], 'Unnamed Medical Facility');

    // Categorize the results
    const categorized = {
      hospitals: [],
      clinics: [],
      dispensaries: []
    };

    elements.forEach(facility => {
      const amenity = facility.tags?.amenity;
      const healthcare = facility.tags?.healthcare;
      const name = facility.name.toLowerCase();

      if (amenity === 'hospital' || healthcare === 'hospital') {
        categorized.hospitals.push({ ...facility, type: 'hospital' });
      } else if (amenity === 'pharmacy' || healthcare === 'pharmacy' ||
        name.includes('dispensary') || name.includes('pharmacy')) {
        categorized.dispensaries.push({ ...facility, type: 'dispensary' });
      } else {
        categorized.clinics.push({ ...facility, type: 'clinic' });
      }
    });

    res.json({
      success: true,
      medical_facilities: categorized,
      total_count: elements.length
    });
  } catch (err) {
    console.error("Overpass API error:", err.message);
    try {
      const fallbackFacilities = await fetchFromNominatim(lat, lng, radius, ['hospital', 'clinic', 'pharmacy']);
      const medicalFacilities = categorizeFacilities(fallbackFacilities);
      res.json({ success: true, degraded: true, medical_facilities: medicalFacilities, total_count: fallbackFacilities.length });
    } catch (fallbackError) {
      console.error("Nominatim fallback error:", fallbackError.message);
      res.status(200).json({ success: true, degraded: true, medical_facilities: { hospitals: [], clinics: [], dispensaries: [] }, total_count: 0 });
    }
  }
});

// Get nearby hospitals only
router.get('/nearby-hospitals', async (req, res) => {
  const { lat, lng, radius } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  const delta = radius ? parseFloat(radius) / 111 : 0.05;
  const query = buildOverpassQuery(lat, lng, ['hospital'], delta);

  try {
    const overpassData = await fetchFromOverpass(query);
    const elements = processElements(overpassData.elements || [], 'Unnamed Hospital');

    res.json({ success: true, hospitals: elements });
  } catch (err) {
    console.error("Overpass API error:", err.message);
    try {
      const hospitals = await fetchFromNominatim(lat, lng, radius, ['hospital']);
      res.json({ success: true, degraded: true, hospitals });
    } catch (fallbackError) {
      console.error("Nominatim fallback error:", fallbackError.message);
      res.status(200).json({ success: true, degraded: true, hospitals: [] });
    }
  }
});

// Get nearby clinics only
router.get('/nearby-clinics', async (req, res) => {
  const { lat, lng, radius } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  const delta = radius ? parseFloat(radius) / 111 : 0.05;
  const query = buildOverpassQuery(lat, lng, ['clinic', 'doctors'], delta);

  try {
    const overpassData = await fetchFromOverpass(query);
    const elements = processElements(overpassData.elements || [], 'Unnamed Clinic');

    res.json({ success: true, clinics: elements });
  } catch (err) {
    console.error("Overpass API error:", err.message);
    try {
      const clinics = await fetchFromNominatim(lat, lng, radius, ['clinic']);
      res.json({ success: true, degraded: true, clinics });
    } catch (fallbackError) {
      console.error("Nominatim fallback error:", fallbackError.message);
      res.status(200).json({ success: true, degraded: true, clinics: [] });
    }
  }
});

// Get nearby dispensaries/pharmacies only
router.get('/nearby-dispensaries', async (req, res) => {
  const { lat, lng, radius } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  const delta = radius ? parseFloat(radius) / 111 : 0.05;
  const query = buildOverpassQuery(lat, lng, ['pharmacy'], delta);

  try {
    const overpassData = await fetchFromOverpass(query);
    const elements = processElements(overpassData.elements || [], 'Unnamed Dispensary');

    res.json({ success: true, dispensaries: elements });
  } catch (err) {
    console.error("Overpass API error:", err.message);
    try {
      const dispensaries = await fetchFromNominatim(lat, lng, radius, ['pharmacy']);
      res.json({ success: true, degraded: true, dispensaries });
    } catch (fallbackError) {
      console.error("Nominatim fallback error:", fallbackError.message);
      res.status(200).json({ success: true, degraded: true, dispensaries: [] });
    }
  }
});

export default router;