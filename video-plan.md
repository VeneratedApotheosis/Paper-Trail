# PaperTrail — Demo Video Plan (OpenScreen)

Plan for producing the ~2 minute demo video and still images for Devpost, using
[OpenScreen](https://getopenscreen.com/) as the primary tool.

OpenScreen is a free, open-source, MIT-licensed screen recorder **and** editor for Windows,
macOS and Linux. One tool covers capture, auto-zoom, cursor styling, backgrounds, sensitive-data
blur, local captions, transcript editing and MP4/GIF export. Nothing is uploaded; recording,
transcription and rendering run on your machine. No watermark, no account.

This replaces the earlier OBS + Kdenlive + Audacity stack. Keep a couple of small open-source
tools only for the pieces OpenScreen does not do: Audacity for a clean voiceover and Inkscape/GIMP
for the Paper cover and thumbnails.

## 1. Tools

| Job | Tool | Notes |
|---|---|---|
| Record + edit + export | **OpenScreen** | Auto-zoom on clicks, cursor packs, backgrounds, blur regions, captions, transcript edit, MP4/GIF |
| Clean voiceover (optional) | **Audacity** | Noise reduction, normalize. OpenScreen records mic, but Audacity gives a cleaner track |
| Animated intro/outro + pipeline explainer (optional) | **Motion Canvas** | Code-driven motion graphics; render to video, drop into OpenScreen as a clip |
| Cover image, thumbnails, screenshots polish | **Inkscape / GIMP** | Paper exports the cover; these add captions and the "synthetic" label |
| Auto-captions | built into OpenScreen (whisper.cpp) | Offline after first run, 264 MB model downloads once |

Install on Windows:
```powershell
winget install --source msstore OpenScreen
# or download the .exe from https://github.com/getopenscreen/openscreen/releases (SmartScreen: More info > Run anyway)
winget install Audacity.Audacity Inkscape.Inkscape
# optional motion graphics:
npm create @motion-canvas@latest
```

First launch: grant screen capture permission. On Windows this uses Windows Graphics Capture and
captures system audio out of the box. The cursor is recorded as data, not burned into pixels, so
you can restyle its size/smoothing/click-bounce after the take.

## 2. Two ways to drive OpenScreen

### Option A — manual (full control, recommended for the final cut)
Record and edit by hand in the OpenScreen app. Use this for the hero demo.

### Option B — agent-driven (fast first draft)
OpenScreen ships an MCP server and a coding-agent skill. An agent can record the app, edit with
the editor's tools, export the MP4 and check it frame by frame.
```
npx skills add getopenscreen/openscreen --skill openscreen-demo -a claude-code
```
Any MCP client works (Codex, Cursor, pi via the `mcp` tool). Agent editing needs a provider key you
supply and is off until you connect one; every edit is undoable. Use this to generate a rough cut
or short clips, then finish by hand.

## 3. Pre-production

1. **Lock the script** to the `plan.md` demo beats with timings:
   - Hook, the problem (0:00-0:12).
   - Connect Gmail, read-only consent screen (0:12-0:27).
   - Receipts stream into the ledger with parsed fields and source chips (0:27-0:57).
   - Hero "You're owed $X" with evidence quote + confidence (0:57-1:30).
   - Approve one drafted claim, copy / `mailto:` (1:30-1:50).
   - Trust page "delete everything" live, ledger empties (1:50-2:10).
   - Close: team + "what it will NOT do" (2:10-2:30).
2. **Use the deterministic path.** Run `npm run dev`, then **Try demo data** (synthetic seed, no live
   API calls, no token flakiness). Same numbers every take. Keep a separate 60s real-Gmail clip as
   optional B-roll proof.
3. **Decide the on-screen owed total** and which findings appear (one overdue refund, one closing
   return window, one price drop), so narration matches the pixels.
4. **Clean environment.** 1920x1080 display. Chrome with a neutral profile, no bookmarks bar, no
   extensions visible. Content area around 1280x720 or 1600x900 so text stays large.
5. **Record the voiceover first** in Audacity (short sentences, one section per take). Edit visuals
   to the audio.

## 4. Record in OpenScreen

1. New recording: pick the browser window or Display 1. Confirm system audio, 1920x1080, 60 fps.
2. Record each beat as its own short take. Short takes are easy to redo.
3. Move the cursor slowly and **click deliberately** on key elements. OpenScreen auto-zooms on each
   click, so a click on the owed number becomes a zoom on the owed number.
4. Linger ~1s on: the read-only consent scope, a finding's evidence quote + confidence chip, the
   claim draft, and the "delete everything" action. Record the delete action twice.
5. Capture 10-15s of idle ledger scrolling for cutaways.

## 5. Edit in OpenScreen

1. **Frame:** keep the default finished look (wallpaper, padding, shadow, rounded corners) or swap
   the background to match PaperTrail's palette. Keep it calm and editorial to fit the Paper entry.
2. **Zooms:** every take opens already zoomed on your clicks. Adjust or add zoom pills on the
   timeline. Push in on the "You're owed $X" number and the evidence chips.
3. **Cursor:** pick one cursor pack, enable click bounce and smoothing so each move reads.
4. **Speed ramps:** speed up slow stretches (sync, loading) with a speed pill so the demo feels fast.
5. **Transcript edit:** delete filler words and silences from the voiceover; the cut lands on the
   timeline, non-destructive.
6. **Blur regions (required):** mask anything sensitive in any frame, email addresses, keys, tokens,
   the OAuth account, URL bar secrets. Use rectangle/oval/freehand, mosaic or smooth. This protects
   the hard product rules and avoids leaking real data.
7. **Captions:** generate with the built-in whisper.cpp, then set typeface, size, color and position.
   Burn them in for silent autoplay and accessibility.
8. **Titles / labels:** add on-screen text for the rule names (R1 refund, R2 return window, R3 price
   drop) and a visible **"synthetic data"** label wherever seed data shows, plus **"simulated"** on the
   price feed. These are product hard rules and score for Visa Trust & Responsibility.
9. **Optional intro/outro:** drop the Motion Canvas title card ("PaperTrail, your inbox already knows
   what you're owed") and an 6-8s pipeline explainer (email > classify > redact > extract > rules >
   owed) to sell the "not a wrapper" story.
10. **Webcam (optional):** add a picture-in-picture narrator for the hook and close; use background
    blur (runs locally, no green screen).

## 6. Export and deliverables

- **Main video:** export MP4, H.264, 1080p, 30 or 60 fps. Keep it under Devpost's 3 minute limit;
  aim 2:00-2:30. Upload to YouTube unlisted and link on Devpost.
- **Aspect ratios:** export a 16:9 for Devpost and, if useful, a 9:16 vertical cut for social from the
  same take.
- **GIF:** export a 6-8s loop of the owed number appearing for the README top.
- **Backup:** keep the project file and the exported MP4 locally (plan.md requires a recorded fallback).
- **Stills for the Devpost gallery:** export frames or screenshot the hero owed card, a finding with
  evidence, the claim draft, the trust/delete page, the consent screen. Add captions and the
  synthetic-data label in GIMP/Inkscape.
- **Cover image:** design in **Paper** (you are applying for the Paper award, so the cover and
  screenshots should be made there), export at 1200x675.

## 7. Compliance checks before publishing

- Every seed/demo moment shows a **"synthetic"** label; the price feed shows **"simulated"** (hard rule 8).
- The consent screen shows the **read-only scope**; include the **"what it will NOT do"** list (Visa
  Trust & Responsibility, and your hard rules 1-2).
- No real personal email, OAuth account, tokens, keys or `.env` content visible, use blur regions to
  be sure. Scrub the URL bar and any devtools.
- Credit any music or assets in the README. If you add background music, keep it under the voice.

## 8. First actions

1. `winget install --source msstore OpenScreen`; grant capture permission; do one throwaway recording
   to learn auto-zoom and blur.
2. Run `npm run dev` + **Try demo data**; finalize the on-screen numbers and script timing.
3. Record the voiceover in Audacity, then capture the screen beats to match.
4. Optionally install the OpenScreen agent skill to generate a rough cut, then finish by hand.
