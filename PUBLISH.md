# Publishing the viewer and checking it on a Quest 3S

The site is plain static files at the top of this repository: `index.html`, `style.css`, `src/`
and `data/`. There is nothing to build. All addresses inside it are relative, so it works from a
sub-folder address such as `https://NAME.github.io/TeamMarsRed/`.

Nothing has been pushed. The work is on the local branch `jezero-delta-terrain`.

What was checked before writing this (on a Mac, not on a headset):

- A copy of exactly the files git would publish was served from a `/TeamMarsRed/` sub-folder and
  opened in headless Chromium four ways (default, `?site=jezero`, `?site=jezero_delta`,
  `?debug=1`). Each load made 19 requests (17 to the site, 2 to jsDelivr for Three.js); all 19
  answered "200 OK", with no missing files and no errors.
- Size: 94 MB in 2,938 files once this step's files are committed (measured over the files git
  tracks or would add). GitHub's limits are 100 MB per file and 1 GB per site, so it fits. 2,825
  of those files are the small photo tiles in `data/walk/*/tiles/`, which the viewer no longer
  loads (it uses one stitched photo per patch); they were left in place. The largest file is 5.5 MB.
- An empty file named `.nojekyll` is at the top of the repository. It tells GitHub to publish the
  files as they are.

VR has only been tried in a headset emulator. The checklist at the end is the first real test.

## Part 1: publish with GitHub Pages

The repository's remote is `https://github.com/ShashwathD/TeamMarsRed`. Two things were not
checked from here and decide who does these steps: you need permission to push to that repository,
and only someone with admin rights on it (its owner) can switch GitHub Pages on. On a free GitHub
account, Pages also needs the repository to be public.

1. In a terminal, go to the folder and look at what will be sent:

   ```sh
   cd /Users/tript/TeamMarsRed
   git status
   git log --oneline -8
   ```

   `git status` should say "nothing to commit". If it lists changed files, commit them first.

2. Send the branch to GitHub:

   ```sh
   git push -u origin jezero-delta-terrain
   ```

3. On github.com, open the repository, then **Settings**, then **Pages** (left column).

4. Under **Build and deployment**, set **Source** to **Deploy from a branch**. Choose the branch
   `jezero-delta-terrain` and the folder `/ (root)`. Press **Save**.

   If you would rather publish from `main`, merge the branch into `main` first and choose `main`
   here instead.

5. Wait one to three minutes. The **Actions** tab shows a run called "pages build and deployment";
   wait for the green tick. The Pages settings screen then shows the address, which for this
   repository will be:

   `https://shashwathd.github.io/TeamMarsRed/`

6. Open that address on a computer first. You should see the Jezero delta, tinted orange, under a
   tan sky within a few seconds. Click the page, walk with `W` `A` `S` `D`, press `F` for the frame
   time. If the page only says "Could not load the terrain", stop and fix that before trying the
   headset.

If you cannot use that repository: create a new public repository under your own account, add it
as a second remote (`git remote add mine https://github.com/YOUR-NAME/TeamMarsRed.git`), push the
branch there (`git push -u mine jezero-delta-terrain`) and do steps 3 to 6 on it. The address is
then `https://YOUR-NAME.github.io/TeamMarsRed/`.

The page needs the internet every time it loads: the 3D library (Three.js 0.170.0) comes from
jsDelivr, not from this repository. The first load fetches about 6 MB (2 MB terrain, 3 MB photo,
0.7 MB distant terrain, the rest code).

## Part 2: open it on the Quest 3S

1. Put the headset on and make sure it is on Wi-Fi.
2. Clear a space to stand in and confirm the boundary when the headset asks.
3. Press the Meta button, open **Browser** (Meta Quest Browser).
4. Point at the address bar, press the trigger, type the address from Part 1, step 5. Press Enter.
5. The page shows the terrain as a flat window with a button at the bottom, **ENTER VR**. If it
   says "WEBXR NOT AVAILABLE", you are not in Meta Quest Browser; if it says "WEBXR NEEDS HTTPS",
   the address does not start with `https://`.
6. Point at **ENTER VR** and press the trigger. If the browser asks to allow immersive mode, allow
   it.
7. To leave VR, press the Meta button on the right controller and choose to quit or resume.

Controls in VR:

- Teleport: hold the trigger on either controller, aim the arc at the ground, let go.
- Turn: push either thumbstick left or right. Each push turns 45 degrees.
- Frame time: press A, B, X or Y. A small panel appears on the left controller. Press again to hide.

There is no smooth walking in VR, on purpose.

Useful addresses:

- `.../TeamMarsRed/` is the Jezero delta (default).
- `.../TeamMarsRed/?site=jezero` is the Perseverance landing site.
- `.../TeamMarsRed/?frametime=1` starts with the frame-time panel showing.
- `.../TeamMarsRed/?debug=1` adds a red pole with an "N" sign 60 m due north of the start.

## Part 3: what to check on the headset

Do these in order, standing up, on the default delta page. Write down what you see for each one,
including the frame-time numbers.

### 1. Enters VR

- How to check: press **ENTER VR**. Look all the way around, and up and down.
- Pass: the browser window disappears and Mars is all around you, in 3D, following your head with
  no delay. Two thin white sticks show where your controllers are.
- Failure looks like: the button says "WEBXR NOT AVAILABLE", "WEBXR NEEDS HTTPS" or "VR NOT SUPPORTED"; nothing happens when pressed; a black or
  frozen view; the picture stays a flat window; the world moves with your head instead of staying
  still.

### 2. Floor height is right

- How to check: look straight down at your feet, then crouch and touch a controller to the real
  floor while watching its white stick.
- Pass: the Mars ground is at your real floor. The stick meets the ground just as the controller
  touches the floor. You feel your normal height.
- Failure looks like: you float above the ground or stand sunk into it; the ground is at knee or
  chest height; you feel like a giant or a child. If it is off by a constant amount, redo the floor
  level in the headset (Settings, then the boundary settings) and try again before reporting it.
- Also take two real steps in any direction: the ground should stay at your feet, including on a
  slope.

### 3. Teleport lands on the ground

- How to check: hold the trigger and aim at ground 5 to 20 m away. A curved line and a ring should
  appear on the ground. Let go. Do this at least six times: near, far, uphill, downhill, and once
  onto the steep scarp.
- Pass: you arrive where the ring was, standing on the ground, every time. Aiming at the sky or
  past the edge of the photo-covered square turns the line red, shows no ring, and letting go does
  not move you.
- Failure looks like: you land above or below the surface; you land somewhere other than the ring;
  you can teleport onto the plain-coloured distant terrain or into the sky; the ring is missing or
  too small to see (it was hard to see in testing, say so if it is); a visible stutter or a
  flash of missing ground right after a long jump.

### 4. Photo is sharp

- How to check: look at ground 20 to 200 m away, then at ground near your feet, then at the far
  hills.
- Pass: from about 20 m outwards you can make out ripples, rock edges and light and dark patches
  with crisp outlines. Near your feet it is soft and blurred: that is expected, one photo pixel is
  about 0.6 m of ground.
- Failure looks like: the whole ground is one flat colour with no pattern (the photo did not
  load); everything is blurred even at 50 m; the pattern looks blocky, like big squares; the photo
  looks mirrored or does not line up with the hills (a dark shadow sitting on a flat area instead
  of on a slope).

### 5. Frame time under 14 ms

- How to check: press A, B, X or Y so the panel shows on the left controller. It gives two
  numbers, the average and the worst frame of the last 144 frames, in milliseconds. Read it while
  standing still, then while turning your head quickly, then right after a teleport. Do this at
  the start point and at one spot near the edge of the square.
- Pass: the average stays under 14 ms (about 13.9 ms is exactly 72 pictures a second). The worst
  number may jump briefly right after a teleport and should settle within two seconds.
- Failure looks like: an average of 14 ms or more; numbers near 27.8 (the headset has dropped to
  half speed); the world judders or doubles when you turn your head. Write down both numbers and
  where you were standing.

### 6. No flicker

- How to check: stand still and look slowly along the horizon, at the line where the photo-covered
  square meets the plain distant terrain (1 km away), and at steep slopes. Then turn your head
  slowly left and right. Then teleport a few times and watch the middle distance.
- Pass: every surface is steady.
- Failure looks like: shimmering or crawling on distant ground; thin bright or sky-coloured lines
  that flash along the edge of the square or between patches of ground; ground that pops or
  changes shape as you move; black triangles; one eye showing something the other does not.

### If something fails

Note which item, what you saw, where you were (start point, or roughly which way you teleported),
and the frame-time numbers. A photo or recording from the headset (Meta button plus trigger takes
a picture) helps. Do not change settings to make a check pass.

## Known and not yet fixed

These are from earlier steps and are listed so you are not surprised:

- After leaving VR, the desktop view stays wide-angle until the page is reloaded.
- The teleport ring is small at long range.
- A long teleport rebuilds a lot of ground in one frame, which may show as a single hitch.
- Nothing here has run on a real headset yet.

## Part 4: Quest 3S checklist for the Jezero Marswalk mission

Written on 2026-11-15 from the mission brief (`docs/mission-brief.md`) and from the code that
existed on this branch: route, beacons, EVA clock, HUD strip and forearm tablet (mission steps B1
to B4). The stations, coring, panoramas, Field Check, cabin, door and debrief (steps B5 to B8) were
being built on other branches at the same time, so items 1 to 3 and 9 to 14 describe what the
brief asks for. If the built thing differs in a detail (a button's label, where a panel sits),
judge by the brief's intent and write down the difference.

None of this has run on a real headset. Everything was checked only in a desktop browser and in a
headset emulator, which cannot judge size, comfort, legibility or frame rate.

Do Part 3 first. Then do these in order, standing, on the default page. With the mission loaded
the buttons are: right trigger = select, confirm and teleport; right grip = hold a tube; `A` =
scan; `B` = airlock door; left `Y` = tablet; left `X` = frame-time readout (not A, B or Y as in
Part 3); right thumbstick = snap turn. To skip the cabin while re-checking outdoor items, add
`?skipcabin=1` to the address (planned with the cabin step; if it does nothing, go through the
cabin each time).

For each item write down pass or fail, what you saw, and both frame-time numbers.

### 1. Cabin scale and floor

- How to check: enter VR. You should start inside the rover cabin. Look down, crouch and touch a
  controller to the real floor. Reach out towards the console and the hologram table. Look at the
  window, then behind you at the airlock door.
- Pass: the cabin floor is at your real floor. The console and table are at about waist height
  and within a step or an arm's reach, like furniture. The door is person-sized. No Mars terrain is
  visible inside the cabin, only the window view. The cabin never moves.
- Failure looks like: the floor at knee or chest height; a dollhouse or a hangar (everything too
  small or too big); your head through the ceiling; terrain poking through the floor or walls; the
  blue route or beacons visible inside the cabin; the HUD strip or EVA clock running while you are
  still inside.

### 2. Briefing and DEPART

- How to check: read the briefing card and look at the route preview on the hologram table. Point
  the right controller at DEPART and press the trigger.
- Pass: the card is readable without leaning in and ends with a source line. Its route length and
  number of stops are filled in (numbers, not `{braces}`). DEPART starts a starfield rushing past
  outside the window for about 6 seconds while the cabin stays perfectly still, and the light over
  the airlock door is red during it and green after.
- Failure looks like: `{route_km}` or another placeholder shown as text; DEPART cannot be hit
  with the ray, or pressing the trigger teleports you instead; the cabin itself appears to move or
  shake (this causes nausea: stop and report it); the stars are on only one eye; the light never
  turns green.

### 3. Airlock door

- How to check: after the light is green, point at the door and press the trigger. Reload and try
  again with `B` instead.
- Pass: both ways open the door and put you outside on the ground near the start marker, facing
  along the blue route. Once outside, the cabin is gone and the terrain, route and HUD strip are
  there. The EVA clock starts at 8:00.
- Failure looks like: the door opens before the light is green; you arrive floating, buried, or
  inside the start marker's pillar; the cabin is still visible outside (walls or floor hanging
  in the landscape); a long black pause; the clock has already lost time.

### 4. Teleport and snap turn outside

- How to check: as Part 3 item 3, but along the blue route. Teleport about ten times along it,
  including across the place where the route doubles back near stop 5. Snap turn a few times.
- Pass: you land on the ground each time. The blue ribbon lies on the ground with chevrons moving
  the way you should walk. Each jump takes a little time off EVA LEFT on the HUD strip (walking
  time for that distance); a snap turn or moving your head takes none.
- Failure looks like: the ribbon floating well above the ground or cutting under it; ribbon and
  ground flickering against each other; chevrons pointing against the route; the clock not
  changing after a jump, or changing when you only turn your head.

### 5. Tablet legibility on the forearm

- How to check: hold your left forearm across your chest as if reading a watch and look down at
  it. Then press `Y` on the left controller. Read every tab: MAP, LOG, LAYERS (all pages, including
  the CREDITS pages after the layer chips), HELP. Point the right controller at buttons and press
  the trigger.
- Pass: the slate sits on the forearm, not inside your wrist or floating away from it, and its
  screen faces your eyes when the arm is in a natural reading pose. Looking down lights it after a
  moment and it goes dark when you look away; `Y` keeps it lit. All text is readable at arm's
  length without bringing it to your face (the smallest text is designed to be about 11 mm tall).
  The ray shows a dot on the screen and lights the button under it. Tapping a tablet button never
  starts a teleport.
- Failure looks like: the screen facing away from you or upside down; you must twist your wrist
  uncomfortably; small text shimmers or cannot be read; it lights up when you did not look at it,
  or stays dark when you do; the dot is offset from where you point; a tap on a button also
  teleports you; a visible hitch each time you tap (write down the worst frame time).
- Also check: the frame-time readout (`X`) also sits on the left controller. If it covers the
  tablet, report it.

### 6. HUD strip comfort

- How to check: stand and look ahead, then slightly down. Turn your head slowly left and right,
  then turn your body a half turn. Walk two real steps. Keep it in view for a full minute.
- Pass: a soft strip floats in front of and below your view, about a metre away. It stays still
  for small head turns and drifts round to follow after a large turn. It shows EVA LEFT, WALK HOME,
  MARGIN, heading, slope, distance to the next stop, and three values marked SIM (oxygen, battery,
  temperature). Nothing is stuck to your face except a short message when something happens.
- Failure looks like: the strip is glued to your head and moves with every twitch; it lags far
  behind or jumps; it sits in the middle of your view or so low you must bow to read it; its text
  is too small or shimmers; it is cut through by the ground or by the tablet; the SIM values lack
  the SIM tag; it makes you queasy (stop and report).

### 7. Map pin teleport with time cost

- How to check: open the tablet, MAP tab. Find the you-are-here arrow. Tap the pin for stop 3 (or
  its entry in the list at the side). Read the box that appears, press CANCEL, then do it again
  and press GO. Note EVA LEFT before and after.
- Pass: the map shows the whole route, a pin per stop, the rover's path in orange and your arrow
  where you are, pointing the way you face. The box names the stop and the walking time and
  distance. CANCEL changes nothing. GO puts you on the route a few metres short of the stop,
  facing it, and EVA LEFT drops by exactly the time the box showed (from the start, stop 3 cost
  about 8 min 41 s in the emulator). The clock is charged once.
- Failure looks like: no box (an instant jump); the clock unchanged, or charged twice; you land
  inside the beacon, off the route, in the air or underground; the arrow on the map is somewhere
  you are not, or the map is mirrored (east and west swapped); the pins are too small to hit with
  the ray.

### 8. Slope layer

- How to check: tablet, LAYERS tab. Tap the eye on "Terrain and slope hazard". Look at the ground
  around you, especially the scarp. Tap the "i". Turn the layer off again. Also tap the eye on
  "Photo" off and on.
- Pass: a see-through wash appears on the ground: amber on moderately steep ground (10 to 15
  degrees), red on steep ground (above 15), nothing on gentle ground. The photo is still visible
  through it. The chip shows the legend and says the 15 degree limit is an ASSUMPTION. The blue
  route never crosses red. Walking onto amber or red ground shows SLOPE CAUTION.
- Failure looks like: no change on the ground; the whole ground one colour; colours that do not
  follow the hills (red on flat ground); the overlay flickering or swimming as you move; a clear
  drop in frame rate with it on (compare the numbers); the route running through red.

### 9. Stations: cards and scan

- How to check: go to stop 2, then stop 3 (teleport along the route or use the map). At each,
  read the card that appears above the tablet and do what it asks. At stop 2: turn on the slope
  layer, then point at "Direct" and at "Planned". At stop 3: press `A` to scan.
- Pass: arriving at a stop shows its card as a hologram above the tablet, readable, ending in a
  source line, with numbers filled in. Stop 2: choosing the steep direct line gives an amber or
  red caution on the HUD and a time cost, and nothing ends. Stop 3: `A` shows SCAN, the rover's
  orange path appears on the ground with small dots at its stops and pulses towards the next stop.
  Each finished stop adds an entry to the tablet's LOG and takes 20 minutes off the clock, once.
- Failure looks like: no card, or the card behind the tablet or inside your arm; `{placeholder}`
  text; `A` does nothing; the orange path was already on the ground before stop 3; the 20 minutes
  charged again each time you re-enter the stop; the scan pulse stuttering.

### 10. Coring at Berea (stop 4)

- How to check: at stop 4 read the card. Squeeze the right grip to take a sample tube. Point at
  the marked rock and press the trigger. Open the tablet LOG.
- Pass: the tube appears in your right hand and stays there while you hold the grip, at a
  believable size. The trigger on the marked rock cores it; the HUD shows SAMPLE SEALED; the LOG
  gains an entry with the core's name (Melyn), sol, size and rock type. The card says the position
  is approximate and that coring here is simulated. The sample marker nearby carries an
  "APPROXIMATE POSITION" sign.
- Failure looks like: the tube stuck in the air, at your feet, or huge; the trigger teleports you
  instead of coring; coring works from anywhere without the tube; the log entry missing or
  repeated; no "approximate" or "simulated" wording.

### 11. Panorama bubble at the ridge (stop 5)

- How to check: at stop 5 step (teleport) into the panorama bubble. Look all the way round, up
  and down. Switch to the other panorama. Step out again. Grip each of the four tubes.
- Pass: inside the bubble you are surrounded by a real rover photo; the horizon is level and at
  eye height, and the hills in the photo roughly line up with the same hills in the terrain when
  you step out. Parts of the sphere the rover did not photograph are plainly filled in, not
  presented as photo. The toggle swaps between the two panoramas (sol 477, Skinner Ridge and
  sol 502, Wildcat Ridge). Stepping out returns the terrain. Each of the four tubes can be gripped
  once and is logged (Swift Run, Skyland, Hazeltop, Bearwallow), with where it is now and the
  "retrieved 2026-09-29" label.
- Failure looks like: the photo tilted, upside down, mirrored, or turned so its hills point the
  wrong way (the compass direction of the panoramas was an open question, so check this one
  carefully and report which way it is off); a visible seam or a pinched knot straight ahead; the
  photo blurred into blocks; the terrain showing through; the bubble opening when you are nowhere
  near stop 5; a long freeze when the photo loads (note the worst frame time).

### 12. Field Check

- How to check: after the tubes, open the Field Check on the tablet. Answer one question wrong on
  purpose, the rest right.
- Pass: four questions, three choices each, tapped with the ray. A wrong answer shows the right
  one and its source, with no penalty and no lost time. The score at the end matches what you did
  (3 of 4).
- Failure looks like: choices too small to hit; a tap registering twice and skipping a question;
  no source shown; text cut off; the score wrong.

### 13. Return and debrief

- How to check: go back to the start marker ("return to rover") and use it. In the cabin, read the
  debrief console and watch the hologram.
- Pass: the marker takes you back into the cabin at any time, even if the clock has run out
  (there is no game over). Outside things disappear and the cabin returns at the right height.
  The debrief shows EVA time used, distance walked, stations done, cores logged out of 5, slope
  warnings and the Field Check score, and they match what you did. The hologram replays your
  route. The mission-log panel has filled in.
- Failure looks like: the marker does nothing; you arrive in the cabin floor or facing a wall
  with no idea where the console is; numbers that are plainly wrong (0 stations after doing all,
  6 of 5 cores); the clock still running inside; terrain visible inside the cabin.
- To see the amber and red clock states you would have to walk far off the route for a long time:
  the planned walk uses about 2 h 24 min of the 8 h. If you do see MARGIN turn amber or red, a
  RETURN message should flash and you should still be able to move.

### 14. Frame time under about 14 ms at 72 Hz

- How to check: press `X` (left controller) for the frame-time readout, or add `?frametime=1`. It
  shows the average and the worst frame of the last 144 frames. Read both numbers in each of
  these places: in the cabin; during the DEPART starfield; at the start outside; with the tablet
  lit; right after tapping a tablet button; with the slope layer on; right after a map teleport;
  at stop 3 with the rover path showing; inside the panorama bubble; at the debrief.
- Pass: judge by the worst figure, not the average. The worst stays under about 14 ms while you
  stand, look around and read. A single spike right after a teleport, a tablet tap or a panorama
  loading is acceptable if it settles within two seconds.
- Failure looks like: a worst figure that stays above 14 ms; an average of 14 ms or more
  anywhere; numbers near 27.8 (the headset has dropped to half rate); judder or doubled edges when
  you turn your head; a hitch on every tablet tap. Write down where it happened and both numbers.
  The emulator showed about 300,000 triangles drawn per frame over both eyes at the start, which
  is at the limit set for this project, so the outdoor start is the place most likely to fail.

### 15. No flicker

- How to check: as Part 3 item 6, and also look at: the blue ribbon and the orange rover path
  where they lie on the ground and where they cross each other; the slope overlay; the HUD strip
  against the ground; the tablet screen and the card above it; beacon labels far away; the
  panorama bubble's edge; the cabin window.
- Pass: every surface and every piece of text is steady in both eyes.
- Failure looks like: a ribbon and the ground fighting (stripes flashing); the two ribbons
  flashing where they cross; shimmering text; the card and the tablet flashing through each other;
  something shown in one eye only; a beacon label popping between two heights.

### Low-poly look (while you are there)

All built objects (cabin, console, joystick, window frame, hologram table, door, tablet body, HUD
frame, beacons, markers, tubes, the coring rock, the return marker) should look chunky and
faceted, in a small palette of Mars oranges, off-white, dark slate, one teal/blue accent, amber
and red. Report anything smooth, glossy or finely detailed that looks out of place. The terrain,
the photo and the panoramas are real data and should not look stylised.
