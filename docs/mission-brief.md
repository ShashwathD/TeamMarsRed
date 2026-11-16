# Jezero Marswalk mission brief (as given by the team)

```text
NEXT PART: build the Jezero Marswalk mission on top of the working viewer. Do not rebuild anything that
already works. FIRST check which patch is loaded (data/walk/jezero = landing area, or data/walk/jezero_delta)
and tell me. This mission is written for the delta patch; if the viewer uses the landing patch, switch to
the delta patch (fallback at the end).

RULES FOR THIS CONTENT
1. Use only facts in this prompt or in the data. Never invent numbers, names or science.
2. Values in {braces} are computed at runtime from the data, never hard-coded.
3. Every info card ends with a one-line source. Assumptions are labelled ASSUMPTION.
4. HUD suit telemetry (oxygen, battery, temperature) is cosmetic and tagged "SIM".
5. Sample positions are approximate (the rover's waypoint at that sol). Say so.
6. Plain language, max ~55 words per card but ok to go a bit over if needed. 
7. Cabin, tablet and all UI are procedural; hide the terrain while in the cabin and the cabin while outside.

FACT BANK
F1 Perseverance landed in Jezero crater on 18 Feb 2021 (Octavia E. Butler Landing site). Team Protikriti
   data-sources.md.
F2 The delta is a massive fan-shaped collection of rocks and sediment on the crater's western edge, built
   where a river met a crater lake billions of years ago; it rises about 40 m (130 ft) above the crater
   floor. JPL news, 19 Apr 2022.
F3 Scientists think fine-grained sediment at the delta's base was once mud on the bottom of Lake Jezero;
   higher up are sand and rock fragments carried from upstream. JPL calls it one of the best places on Mars
   to look for signs of ancient microbial life. JPL 2022.
F4 Crater-floor rocks are igneous: Séítah is coarsely crystalline, olivine-rich rock formed at the base of a
   magma body; Máaz is lava flows or the chemical counterpart. Water altered them. Cores are stored aboard
   Perseverance for potential return to Earth. Farley et al. 2022, Science 377, eabo2196.
F5 At the delta front the team found sandstones, siltstones and boulder-rich conglomerates, interpreted as
   deposited underwater by density currents in a distal deltaic setting; boulder-rich conglomerates are
   consistent with high-energy floods. Williams et al., LPSC 2023 abstract (NTRS 20230000588).
F6 One sol = 24 h 39 min 35 s (NASA says about 24.6 h). NASA GISS Mars24 / NASA Science.
F7 EVA precedent: NASA's Artemis EVA concept of operations (EVA-EXP-0075, 2020) is quoted in Team Protikriti
   docs as up to 8 h, up to 2 km from the lander, terrain up to 20 degrees (Moon). Original not opened.
   Our 8 h EVA, 1 h reserve, 15 degree slope limit, 3.3 km/h pace and 20 min per stop are ASSUMPTIONS.
F8 Astronauts can make connections, solve problems quickly and apply context in real time. Space Apps
   challenge text.
F9 Photo: MRO HiRISE, 25 cm per pixel. Terrain: USGS HiRISE stereo model, 1 m (shown at 2 m).

THE MISSION (delta patch). Coordinates come from data/activities.json and data/pano; convert to local
metres and snap to terrain. START: a low-slope spot within ~300 m of the patch centre.

S1 BRIEFING (cabin hologram)
 Card: "Today's Marswalk: Jezero crater delta. Perseverance landed here on 18 February 2021. The delta is a
 fan of rock and sediment built where a river met a crater lake billions of years ago. Plan: {route_km} km,
 {station_count} stops, back before the clock runs out."
 Action: review the route on the hologram, press DEPART. Source: F1, F2.

S2 READ THE GROUND (first leg where the straight line to the next station is steeper than 15 degrees; if
 none exists in the patch, use the steepest line and show the honest numbers)
 Card: "Slope matters. We assume suited explorers avoid ground steeper than 15 degrees (ASSUMPTION; NASA's
 Artemis plan cites up to 20 degrees for the Moon). Turn on the slope layer: amber 10-15, red above 15.
 The straight line reaches {direct_max_slope} degrees; the planned route stays under 15 and takes
 {extra_min} more minutes."
 Action: toggle the slope layer, then point at "Direct" or "Planned". Choosing steep triggers an amber or
 red HUD caution and the time cost, no game over. Source: F7, F9.

S3 FOLLOW THE ROVER (where the route meets the traverse line)
 Card: "The orange line is Perseverance's real path. Inside this patch it drove between sols {sol_min}
 and {sol_max} (a sol is a Mars day, 24 h 39 min). Rovers scout; people can look, decide and adapt on the
 spot: astronauts solve problems quickly and apply context in real time."
 Action: A to scan; the traverse pulses toward the next station. Source: NASA/JPL MMGIS traverse, F6, F8.

S4 BEREA: FIRST CORE (sample #19 Melyn, near the patch centre)
 Card: "Berea. Sample #19, Melyn, sealed on sol 749 (30 March 2023). NASA classes it a sedimentary rock
 core, 6.04 cm (2.38 in) long. NASA's list showed it aboard the rover (retrieved 2026-09-29). Position is
 approximate (rover waypoint, sol 736). Coring here is simulated."
 Action: grip pulls a sample tube, trigger at the marked rock to core. Log: name, sol, size, type.
 HUD: "SAMPLE SEALED". Source: NASA Science, Mars Rock Samples.

S5 RIDGE LOOKOUT (Skinner Ridge + Wildcat Ridge, about 20 m apart, ~1.4 km from Berea)
 Panoramas: 26_1004 (sol 477, Skinner Ridge) and 26_1222 (sol 502, Wildcat Ridge); toggle between them.
 Card A: "Four cores were sealed here in 2022: Swift Run (sol 490, 6.69 cm), Skyland (495, 5.85 cm), Hazeltop
 (509, 5.97 cm), Bearwallow (516, 6.24 cm). NASA classes all four sedimentary. At the delta front the team
 found sandstones, siltstones and boulder-rich conglomerates laid down underwater." Add each core's
 location ({on rover} or {sample depot}) from the data with the "retrieved 2026-09-29" label.
 Card B (two columns, "Igneous vs sedimentary"): Igneous (crater floor): "Cooled from magma or lava.
 Séítah is olivine-rich; Máaz is lava flows or related. Near the landing area NASA classes {n_igneous}
 cores as igneous (sols {ig_min} to {ig_max})." Sedimentary (delta): "Laid down by water: sandstones,
 siltstones, conglomerates." Sources F3, F4, F5.
 Action: step into the panorama bubble, grip each tube to log it, then take the FIELD CHECK on the tablet.

FIELD CHECK (4 tap questions, 3 choices each; a wrong answer shows the right one plus its source; no penalty)
 Q1 Which kind of rock did Perseverance sample on Jezero's crater floor? Igneous (F4)
 Q2 Which kind did it sample at the delta? Sedimentary (data, F5)
 Q3 What does the delta suggest once existed here? A river flowing into a lake (F2)
 Q4 Where do scientists most hope to find signs of ancient microbial life? Fine-grained sediment at the
    delta's base (F3)

DEBRIEF (cabin console, after returning to the airlock)
 Shows EVA time used, distance walked, stations done, cores logged ({n}/5), slope warnings, Field Check
 score, and a route replay on the hologram. No fail state.

SYSTEMS
EVA CLOCK: 8 h total, 1 h reserve; pace = Tobler hiking function x 0.8, capped at 3.3 km/h; 20 min per
 station (all ASSUMPTION). Tablet teleport costs the walking time of the route distance. HUD shows time
 left, time to walk home and margin. Amber when margin < 1 h; red when walk-home time exceeds time left
 minus reserve. Never game over; the airlock marker always works.
ROUTE: A* over the 2 m terrain, never crossing ground above 15 degrees, through the stations in order,
 drawn as a blue ribbon with moving chevrons draped on the terrain. A dotted preview shows on the cabin
 hologram.
TABLET (left forearm; toggle with Y or by looking down at the forearm): tabs MAP (the whole route like a
 map, you-are-here, station pins; tap a pin to teleport with a time-cost confirm), LOG (field notebook),
 LAYERS (toggles and credits), HELP (controls). Station info appears as a hologram card above the tablet.
HUD (a soft strip that trails behind head turns, plus peripheral flashes; nothing locked to the head):
 real {heading, slope underfoot, distance to next station, time to walk home, EVA clock}; cosmetic tagged
 SIM {suit O2 %, battery %, suit temp}. Reactions: steep ground "SLOPE CAUTION", scan "SCAN", sampling
 "SAMPLE SEALED", low margin "RETURN".
CABIN (static, no movement): a control console with decorative, non-interactive buttons and a joystick; a
 front glass window; a hologram table in front of the window (route preview + DEPART); a mission-log panel
 that fills from the walk; an airlock door behind the player with a red light in transit and green on
 arrival. DEPART plays a ~6 s hyperspeed starfield outside the window; the cabin never moves. Open the door
 with point + trigger, or B. A "return to rover" marker outside brings the player back for the debrief.
LAYERS (each chip shows mission, instrument, source): Photo (MRO HiRISE 25 cm); Terrain and slope hazard
 (USGS HiRISE terrain model; slope derived by us; 15 degrees is an ASSUMPTION); Rover traverse (Mars 2020,
 NASA/JPL MMGIS); Sample sites (NASA Mars Rock Samples, approximate); Surface panoramas (Mars 2020 Navcam);
 Backdrop terrain (MRO CTX, 20 m). Missions covered: MRO and Mars 2020 Perseverance.
CONTROLS (Quest): right trigger select/confirm/teleport; right grip hold tube; A scan; B airlock door; left
 Y tablet; right thumbstick snap turn.

LANDING-PATCH FALLBACK (only if the delta patch cannot be used): 8 igneous cores in four spots: Rochette
 (Montdenier, Montagnac), Brac (Salette, Coulettes), Issole (Robine, Malay), Sid (Ha'ahóni, Atsá), sols
 194-377; panorama 3_110 (sol 14) at the landing site. Reuse S1-S4; S5 uses the igneous cores.

OPEN ITEMS: if reachable, open NASA's Mars Rock Samples page and the EVA-EXP-0075 PDF and recheck what is
 flagged unverified. Note any mismatch in DECISIONS.md.

BUILD ORDER (small wins). Do ONE step at a time. After each: test in headless Chromium, fix console errors,
commit, and move on
B1 Mission data file: create data/mission/jezero_delta.json from this prompt (stations with real coordinates
   snapped to terrain, every {computed} value calculated). Pick the start spot. Print a table of each
   station's position, height, slope and distance from the start. Do not change the viewer.
B2 Route and beacons: compute the slope-limited route; draw the blue ribbon and labelled beacons.
B3 EVA clock and HUD, as specified.
B4 Forearm tablet with MAP, LOG, LAYERS, HELP, layer toggles, and pin teleport with time cost.
B5 Station framework (beacon, hologram card above the tablet, action, log entry) and S2.
B6 S3 and S4, including the simulated coring.
B7 S5: panoramas, the igneous vs sedimentary card, and the Field Check.
B8 Cabin, DEPART transition, airlock door, return marker, debrief.
B9 End-to-end run, fixes, credits screen, and a Quest 3S checklist.
```

## Added by the team on 2026-11-15, after the brief above: art style (binding for every step)

```text
LOW-POLY LOOK. All procedural objects (cabin and its console, joystick, window frame, hologram table,
airlock door, the forearm tablet body, HUD frame, beacons, markers, sample tubes, the coring rock, tube
holder, return marker) must have a deliberately low-poly, charming style:
- chunky simple shapes with few faces (boxes, 5-8 sided cylinders, low-segment cones, icosahedra with
  detail 0-1); visible facets, flatShading: true; no smooth high-segment spheres or rounded bevels
- a small flat colour palette (warm Mars oranges, off-white, dark slate, one teal/blue accent, amber and
  red for warnings); solid colours or vertex colours rather than detailed textures
- slightly oversized, friendly proportions; readable silhouettes
- text panels (cards, tablet screen, HUD strip) stay crisp canvas text for legibility, but their frames
  and housings are low-poly
- the real terrain, photo, panoramas and data layers are NOT stylised: they stay true to the data
Any step that touches an object built by an earlier step should bring it into this style. B9 must check
every object against this section and fix what does not match.
```

## Added by the team on 2026-11-15, after the brief above: tablet layer behaviour (binding; overrides the shorter LAYERS line above where they differ)

```text
LAYER BEHAVIOUR (tablet LAYERS tab; one chip per layer; point + trigger toggles; each chip shows an eye icon
for on/off, the mission, the instrument and the source; tapping the "i" shows a 1-line explanation)
1 Photo (MRO HiRISE 25 cm): ON by default. It is the terrain texture. Off = plain shaded relief.
2 Terrain and slope hazard (USGS HiRISE terrain model): OFF by default. A translucent overlay on the
  ground: amber 10-15 degrees, red above 15, clear below 10. Legend on the chip. 15 degrees = ASSUMPTION.
3 Rover traverse (Mars 2020, NASA/JPL MMGIS): ON by default in the tablet MAP, OFF in the world until S3.
  Orange line draped on the ground, with small dots at rover stops inside the patch.
4 Sample sites (NASA Mars Rock Samples): ON in the tablet MAP; in the world, a small marker only at stations
  S4 and S5. Labelled "approximate position".
5 Surface panoramas (Mars 2020 Navcam): ON in the MAP as camera icons at S5; the 360 view opens only there.
6 Backdrop terrain (MRO CTX, 20 m): always ON, no chip, credited in the LAYERS tab.
Route (blue ribbon) is not a layer: always visible in the world and the MAP.
The LAYERS tab also lists the missions covered (MRO, Mars 2020 Perseverance) and the full credits.
Performance: overlays are textures or lines on the existing terrain, no extra geometry beyond markers.

Note for whichever step is running when this was added: the tablet may already have been built to the
shorter description. The reviewer of that step, and every later step that touches layers, must bring the
LAYERS tab, the MAP and the in-world defaults into line with this section (including: traverse off in
the world until S3 turns it on; backdrop terrain has no chip; "i" one-line explanations; eye icons).
```
