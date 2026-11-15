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
