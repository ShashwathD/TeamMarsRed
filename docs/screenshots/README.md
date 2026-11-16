# Screenshots of the Jezero delta patch

Taken on 2026-11-15 from the page itself (default site, `jezero_delta`), served from a
`/TeamMarsRed/` sub-folder and drawn by headless Chromium with software graphics at 1600 x 900.
The status text and the VR button were hidden for the pictures; nothing else was changed. The
camera is always 1.7 m above the ground, 70 degree field of view, true scale.

Positions are in the viewer's local frame: x = metres east and z = metres south of the patch
centre. Heading is degrees clockwise from north. Pitch is degrees up (negative looks down).

| File | x, z (m) | Longitude E, latitude N | Ground height | Heading | Pitch |
|---|---|---|---|---|---|
| `1_steepest_spot.png` | -625, 821 | 77.37918, 18.45835 | -2468.52 m | 241 | -10 |
| `2_flattest_spot.png` | 369, 799 | 77.39686, 18.45872 | -2462.50 m | 0 | -5 |
| `3_toward_crater_rim.png` | -789, -227 | 77.37627, 18.47603 | -2412.20 m | 273 | 0 |
| `4_ground_level.png` | 0, 0 | 77.39030, 18.47220 | -2452.08 m | 0 | -4 |

How each spot was chosen (measured from `data/walk/jezero_delta/dem.bin`, slope by central
differences on the 2 m grid):

1. **Steepest spot.** The 10 m x 10 m window with the highest average slope: 51.8 degrees, centred
   on row 910, column 187. The single steepest sample in the patch (61.1 degrees) is the next
   sample north. It is a scarp at the edge of a flat-topped block, facing south-south-east
   (downhill bearing 151 degrees): the ground drops 33 m over 45 m. The camera stands on the spot
   and looks along the scarp to the west-south-west, so the slope fills the right of the picture.
2. **Flattest spot.** The 30 m x 30 m window with the lowest average slope: 0.73 degrees (steepest
   sample inside it 2.6 degrees), centred on row 899, column 684. Looking north.
3. **Toward the crater rim.** From the coarse 20 m grid (`data/sites/jezero/grid.bin`): the ground
   climbs toward the west all along the grid's west edge, which is the inner wall of Jezero's
   western rim. The nearest ground at least 100 m above the patch centre is 3.24 km away on a
   bearing of 273 degrees (just north of due west). The grid stops 3.4 km west of the patch centre
   and is still climbing there (about 18 m over its last 200 m), so the rim crest itself is beyond
   the data and is not in the picture. What you see on the horizon is the wall up to the edge of
   the grid. The camera stands on the highest ground in the western middle of the patch for a clear
   view, looking on that bearing.
4. **Ground level.** The start point at the patch centre, looking north, the first thing a visitor
   sees.

Things to know when looking at them:

- Ground within about 20 m of the camera is blurred. The photo has one pixel per 0.6 m of ground.
- Beyond the 2 km square there is no photo, so the distant terrain is one plain colour.
- Colour, sky and haze are cosmetic (see `DECISIONS.md`).

## Minerals (added 2026-11-15)

Two more pictures, taken the same way (headless Chromium, software graphics, 1600 x 900, status
text and VR button hidden) but not from the 1.7 m walking camera:

| File | What it shows | Camera |
|---|---|---|
| `5_cabin_wall_map.png` | The rover cabin's right-hand wall: the mineral map of the delta patch with the stations, the ten candidate deposits, three of them picked (D3, D4, D6), the planned route and its distance and EVA clock cost. | Standing at the cabin start spot, looking at the wall map. |
| `6_delta_minerals_high_view.png` | The delta patch from above with the Minerals layer on (and the slope layer off). Green: Carbonate. Purple: Clay. Yellow-green: Olivine + clay. Pink: Volcanic. Paler: medium confidence. No colour: no known spectral class. The thin blue line is the stored station route. | 900 m above the height of the patch centre, at x = 150 m, z = 1500 m (south of the patch), looking north at x = 0, z = -150. 55 degree field of view. Drawn off-screen with the haze switched off so the far side is not washed out; the ground outside the 2 km square has no photo and no mineral data. |

The mineral colours are best spectral matches from orbit in 36 m pixels (Parente, Saranathan and
Itoh 2021, doi:10.5281/zenodo.5575824, CC BY 4.0, from MRO CRISM data). The layer shows which
minerals are probably there. It is not a hazard map.
