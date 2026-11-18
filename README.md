# MarsWalk by Team Mars Red

MarsWalk is an interactive 3D experience for exploring a real terrain patch in Jezero crater. It
combines Mars imagery, terrain, rover data, and mineral observations in a walkable mission. Users
can plan routes, explore science targets, and experience the landscape from a desktop or VR headset.
We hope this experience can make Mars exploration and science easier to understand and plan, helping people imagine
how a future surface mission might be carried out.

## Open and play in a browser

Open the project at [shashwathd.github.io/TeamMarsRed](https://shashwathd.github.io/TeamMarsRed/).
It works in a desktop browser; use the **ENTER VR** button in a compatible headset browser to enter
immersive mode. The headset must be online, and the page must use HTTPS for WebXR.

In VR, use the left stick to walk and the right stick to turn/pan. Hold the either trigger to aim a
teleport and release to jump. Point and press the trigger to select; use `Y` for the tablet, `A` to
scan, and the right grip to take or stow a sample tube.

On desktop, click the view to capture your cursor and turn/pan with the mousepad, move with `W`, `A`, `S`, `D`, 
and hold `Shift` to sprint. Hold `T` or the right mouse button to aim a teleport and release to jump. Use `Tab` 
for the tablet.

## Run locally

Open Terminal and start a local web server from the project folder:

```sh
cd /Users/shashwathdinesh/TeamMarsRed
python3 -m http.server 8000
```

Then open [localhost:8000](http://localhost:8000) in a desktop browser. Keep the Terminal window
open while playing; press `Ctrl+C` there to stop the server. Localhost is for the computer's
browser. For headset play, use the HTTPS browser link above.
