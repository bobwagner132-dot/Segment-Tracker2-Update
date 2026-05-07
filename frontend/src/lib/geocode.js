// Best-effort Nominatim reverse geocoding. Runs entirely in the browser
// and silently returns null if offline or rate-limited, so the app degrades
// gracefully: rides get a fallback name derived from the filename instead.

export async function reverseGeocode(lat, lon) {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    const url =
      `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}` +
      `&lon=${encodeURIComponent(lon)}&format=json&zoom=14`;
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { "Accept-Language": "en" },
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    const addr = data.address || {};
    return (
      addr.suburb ||
      addr.neighbourhood ||
      addr.village ||
      addr.hamlet ||
      addr.town ||
      addr.city_district ||
      addr.city ||
      addr.county ||
      addr.state ||
      null
    );
  } catch {
    return null;
  }
}
