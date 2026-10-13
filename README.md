# Soil Spectral Library Atlas

An interactive web map of soil spectral libraries (SSLs) identified in a systematic review. It is a static site (HTML, CSS, JavaScript and JSON), so GitHub Pages can host it with no server or build service.

**Features**

- A choropleth of countries, shaded either by the largest library scale (national, sub-national, multi-country) or by the number of libraries.
- Library locations drawn as proportional symbols, sized by sample count and coloured by spectral range (vis-NIR, NIR, MIR, LWIR).
- Live filters: library scale, spectral range, continent, minimum sample count, and whether the introducing paper is in the review.
- Basemap switcher (CARTO light/dark, OpenStreetMap, Esri satellite, none), a place-label overlay, an adjustable shading opacity, a scale bar, a cursor-coordinate readout and a zoom-to-extent button.
- Click a country or a library to see its details and the linked papers, with DOI links.
- Search for countries and libraries.
- Sortable tables of libraries and of all screened papers (filter by screening decision or paper role, or search the text).
- Export of the filtered data as GeoJSON (library points, country polygons) or CSV, ready to load into QGIS or ArcGIS.
- Shareable links to a view or a selection, e.g. `#map/library/BR-BSSL` or `#papers`.

## Repository layout

```
index.html                 app shell
css/style.css              styles (light and dark themes)
js/app.js                  map, filters, tables, export
data/libraries.json        generated: one record per library
data/papers.json           generated: every screened paper
data/countries.geojson     generated: country polygons with coverage attributes
data/meta.json             generated: counts and build date
data/source/               inputs: the review workbook and Natural Earth boundaries
scripts/build_data.py      rebuilds data/*.json from the workbook
.nojekyll                  tells GitHub Pages to serve files as-is
```

## Publish on GitHub Pages

1. Create a new repository on GitHub, for example `ssl-atlas`.
2. Upload the contents of this folder to it. Either drag and drop them in the GitHub web interface, or run:
   ```bash
   cd ssl-atlas
   git init
   git add .
   git commit -m "Soil Spectral Library Atlas"
   git branch -M main
   git remote add origin https://github.com/<your-user>/ssl-atlas.git
   git push -u origin main
   ```
3. In the repository, go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, then branch `main` and folder `/ (root)`. Save.
4. After a minute or two the site is live at `https://<your-user>.github.io/ssl-atlas/`.

## Update the data

The workbook `data/source/soil_spectral_libraries_structured.xlsx` is the single source of truth.

1. Edit the workbook:
   - **Papers:** the yellow coding columns (C1–C3, duplicate, role, library IDs).
   - **Libraries:** one row per library. *Map longitude/latitude (approx.)* places a library at its study region; leave them blank to use the country centroid.
   - **Library countries:** one row per library–country pair.
2. Rebuild the JSON files:
   ```bash
   pip install openpyxl
   python scripts/build_data.py
   ```
   The script recomputes each screening decision from the coded columns, so you don't need to recalculate the formulas in Excel first. If a country name doesn't match the boundary file, the script stops and names the country. Add it to `ALIAS` in the script.
3. Commit and push. GitHub Pages republishes automatically.

## Preview locally

Browsers block `fetch()` from `file://`, so serve the folder rather than double-clicking `index.html`:

```bash
python -m http.server 8000
# open http://localhost:8000
```

## Credits and licences

- Mapping library: [Leaflet](https://leafletjs.com) 1.9.4 (BSD-2), loaded from unpkg.
- Boundaries: [Natural Earth](https://www.naturalearthdata.com) 1:50m (public domain), via world-atlas.
- Basemaps: © OpenStreetMap contributors, © CARTO, © Esri. The tile providers' usage policies apply. CARTO basemaps are free for non-commercial use with attribution.
- Library point locations are approximate and indicative only.
