# Jezero Marswalk mission brief

## Purpose

Marswalk turns a 2 km × 2 km area of Jezero crater's delta into an interactive surface mission. It
brings orbital imagery and terrain together with Perseverance observations so a user can plan a
route, visit science stops, and investigate possible mineral targets. This is a prototype for
exploration and learning, not an operational astronaut navigation system.

## Mission flow

1. Start in the rover cabin and review the mission briefing and route map.
2. Choose three candidate mineral deposits from the CRISM-derived map. The route is recalculated to
   visit the chosen deposits and mission stations.
3. Depart through the airlock and explore using desktop controls or a VR headset.
4. Visit the terrain and rover-traverse stops, inspect sample and panorama locations, and collect
   simulated samples.
5. Return to the rover for the log, Field Check, and route debrief.

The tablet provides a route map, mission log, layer toggles, and control help. The helmet-style HUD
shows heading, slope, next-stop distance, estimated time to walk home, and mission-time margin.

## Route and timing model

The route planner searches the 2 m terrain grid with A* and plans around slopes above 15 degrees.
The slope cutoff, an 8-hour EVA, a 1-hour reserve, a 3.3 km/h pace cap, and 20 minutes per stop are
project assumptions. The EVA clock charges modeled walking time for distance and time for stops; it
does not run in real time. Suit oxygen, battery, and temperature displays are decorative simulated
values.

## Data and attribution

The mission uses USGS products made from NASA MRO HiRISE and CTX imagery, NASA/JPL MMGIS
Perseverance traverse and waypoint data, NASA sample facts, Perseverance Navcam panoramas, and a
CRISM-based mineral classification. Some sample positions are approximate rover waypoints; sample
collection is simulated. Mineral labels are closest spectral matches at 36 m resolution, not hazard
ratings.

See [data sources](data-sources.md) and [credits](../CREDITS.md) for citations and detailed notes.
